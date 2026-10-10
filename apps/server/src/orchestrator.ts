import { randomUUID } from "node:crypto";
import {
  AdapterError,
  TERMINAL_TASK_STATUSES,
  type AdapterInvokeResult,
  type AgentAdapter,
  type AgentProfile,
  type Artifact,
  type CallBudget,
  type CollaborationMode,
  type DigestEntry,
  type EventType,
  type HandoffPacket,
  type Step,
  type StepKind,
  type Task,
  type TaskStatus,
  type TaskSnapshot,
  type TaskSummary,
  type TerminalStepStatus,
} from "@aom/shared";
import type { EventInput, StepFinish, TaskRepository } from "./repository.js";

export const ENGINE_VERSION = "phase-3";

/** 交给下游的发言摘录上限。只带摘要，不带完整输出。 */
export const EXCERPT_LIMIT = 800;

/** 非最终步骤必须为综合/收敛调用保留的预算，保证结论总能产出。 */
const FINAL_CALL_RESERVE = 1;

const FINAL_TITLE = "最终结论";
const FIXED_CONSTRAINT = "仅基于本简报作答，不要假设未提供的历史或文件内容";

const BRIEF_FORMAT = "仅输出分工行，每位工作参与者一行";
const WORKER_FORMAT = "分点给出结论与依据，尽量简洁";
const DISCUSS_FORMAT = "分点给出当前立场与依据，并说明与其他摘录的异同";
const FINAL_FORMAT = "面向用户的最终结论，分点列出，并注明仍存在的分歧或不确定性";

const SYNTHESIS_INSTRUCTION = "综合以下参与者的结论，给出面向用户的最终答复；存在分歧或不确定时明确指出";
const ROUND_ONE_INSTRUCTION = "独立给出你对任务目标的分析与结论";
const ROUND_FOLLOW_INSTRUCTION = "阅读其他参与者的摘录，说明同意或不同意之处，并修正或保留你的结论";
const CONVERGE_INSTRUCTION = "综合各参与者的最终立场，给出最终结论，并列出未解决的分歧";

export class TaskNotFoundError extends Error {}
export class TaskStateError extends Error {}

export interface NewTask {
  goal: string;
  acceptanceCriteria: string[];
  mode: CollaborationMode;
  participantIds: string[];
  budget: CallBudget;
  workingDirectory?: string;
}

export interface OrchestratorDeps {
  repository: TaskRepository;
  profiles: readonly AgentProfile[];
  adapters: ReadonlyMap<string, AgentAdapter>;
  log?: { error: (fields: object, message: string) => void };
  now?: () => string;
}

type StopReason = "user" | "shutdown";

/** 单个任务运行期的控制器：暂停门闩与中止信号。 */
class RunControl {
  readonly abort = new AbortController();
  private pausedFlag = false;
  private wake: (() => void) | null = null;
  private reason: StopReason | null = null;

  get paused(): boolean {
    return this.pausedFlag;
  }

  get aborted(): boolean {
    return this.abort.signal.aborted;
  }

  get stopReason(): StopReason | null {
    return this.reason;
  }

  pause(): void {
    this.pausedFlag = true;
  }

  resume(): void {
    this.pausedFlag = false;
    this.release();
  }

  stop(reason: StopReason): void {
    this.reason ??= reason;
    this.abort.abort();
    this.release();
  }

  /** 暂停只在步骤边界生效；正在进行的调用不被打断。 */
  waitWhilePaused(): Promise<void> {
    if (!this.pausedFlag || this.aborted) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.wake = resolve;
    });
  }

  private release(): void {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }
}

interface RunContext {
  taskId: string;
  goal: string;
  acceptanceCriteria: string[];
  budget: CallBudget;
  workingDirectory?: string;
  control: RunControl;
  degraded: boolean;
  budgetNoticed: boolean;
}

interface PlannedStep {
  kind: StepKind;
  title: string;
  participant: AgentProfile;
  inputSummary: string;
  round?: number;
}

interface PacketInput {
  role: string;
  assignment: string;
  format: string;
  digest: DigestEntry[];
  round?: number;
}

interface StepRequest {
  packet: HandoffPacket;
  reserve: number;
  artifactTitle?: string;
}

export type StepResult =
  | { status: "succeeded"; output: string }
  | { status: Exclude<TerminalStepStatus, "succeeded"> };

export type Settled = { ok: true; result: AdapterInvokeResult } | { ok: false; error: unknown };

const STEP_VERB: Record<TerminalStepStatus, string> = {
  succeeded: "完成",
  failed: "失败",
  timed_out: "超时",
  cancelled: "已取消",
  skipped: "跳过",
};

const STEP_EVENT: Partial<Record<TerminalStepStatus, EventType>> = {
  succeeded: "step.succeeded",
  failed: "step.failed",
  timed_out: "step.timed_out",
  cancelled: "step.cancelled",
};

/**
 * 生成计划步骤。计划在任务创建时完整落库，UI 因此能从第一刻起显示完整时间线。
 */
export function planSteps(
  mode: CollaborationMode,
  participants: readonly AgentProfile[],
  maxRounds: number,
): PlannedStep[] {
  if (mode === "coordinator") {
    const [coordinator, ...workers] = participants;
    return [
      { kind: "brief", title: "拆解分工", participant: coordinator, inputSummary: "由协调者根据任务目标拆解分工" },
      ...workers.map((worker): PlannedStep => ({
        kind: "dispatch",
        title: `分工 · ${worker.name}`,
        participant: worker,
        inputSummary: "等待协调者分工",
      })),
      { kind: "synthesize", title: "综合结论", participant: coordinator, inputSummary: "汇总各工作参与者的结论" },
    ];
  }

  const [moderator] = participants;
  const plan: PlannedStep[] = [];
  for (let round = 1; round <= maxRounds; round += 1) {
    for (const participant of participants) {
      plan.push({
        kind: "discuss",
        title: `第 ${round} 轮 · ${participant.name}`,
        participant,
        inputSummary: round === 1 ? "独立发言" : "阅读其他参与者摘录后发言",
        round,
      });
    }
  }
  plan.push({ kind: "converge", title: "收敛结论", participant: moderator, inputSummary: "汇总各参与者的最终立场" });
  return plan;
}

/**
 * 解析协调者输出的分工行，格式为「- 参与者名：分工内容」。
 * 无法匹配的行被忽略；缺失的参与者由调用方改用默认分工。
 */
export function parseAssignments(output: string, workers: readonly AgentProfile[]): Map<string, string> {
  const workerByName = new Map(workers.map((worker) => [worker.name, worker.id]));
  const assignments = new Map<string, string>();
  const pattern = /^\s*[-*•·]\s*([^：:]+?)\s*[：:]\s*(.+?)\s*$/;
  for (const line of output.split(/\r?\n/)) {
    const match = pattern.exec(line);
    if (!match) continue;
    const workerId = workerByName.get(match[1].trim());
    if (workerId && !assignments.has(workerId)) assignments.set(workerId, match[2].trim());
  }
  return assignments;
}

/** 把一次调用的结果映射为步骤状态。纯函数，便于单独验证。 */
export function classifyCall(input: {
  settled: Settled;
  timedOut: boolean;
  stopped: boolean;
  stopReason: StopReason | null;
  timeoutSeconds: number;
}): StepResult & { note?: string } {
  if (input.timedOut) {
    return { status: "timed_out", note: `超过 ${input.timeoutSeconds} 秒未完成，已停止调用` };
  }
  if (!input.settled.ok) {
    const error = input.settled.error;
    const cancelledByUs = input.stopped && (!(error instanceof AdapterError) || error.kind === "cancelled");
    if (cancelledByUs) {
      return input.stopReason === "shutdown"
        ? { status: "failed", note: "服务停止，调用未完成" }
        : { status: "cancelled", note: "用户取消，调用已停止" };
    }
    if (error instanceof AdapterError) {
      return { status: error.kind === "timed_out" ? "timed_out" : "failed", note: error.message };
    }
    return { status: "failed", note: "内部错误，调用未完成" };
  }
  const output = input.settled.result.output.trim();
  if (output.length === 0) return { status: "failed", note: "上游返回内容为空" };
  return { status: "succeeded", output };
}

/** 发言摘录：超过上限时截断，避免把完整输出交给其他参与者。 */
export function excerpt(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > EXCERPT_LIMIT ? `${trimmed.slice(0, EXCERPT_LIMIT)}…` : trimmed;
}

function buildPacket(ctx: RunContext, input: PacketInput): HandoffPacket {
  return {
    taskGoal: ctx.goal,
    assignment: input.assignment,
    participantRole: input.role,
    constraints: [FIXED_CONSTRAINT, ...ctx.acceptanceCriteria.map((item) => `验收标准：${item}`)],
    confirmedFacts: [],
    evidence: [],
    digest: input.digest,
    round: input.round,
    deliverableFormat: input.format,
  };
}

function briefInstruction(workers: readonly AgentProfile[]): string {
  const names = workers.map((worker) => worker.name).join("、");
  return `将任务目标拆解为分工。每位工作参与者各写一行，严格使用「- 参与者名：分工内容」格式，参与者名只能从下列名称中选择：${names}。`;
}

function defaultAssignment(worker: AgentProfile): string {
  return `从「${worker.role}」的角度独立完成对任务目标的分析，给出结论与依据`;
}

function requireStep(step: Step | undefined): Step {
  if (!step) throw new Error("计划步骤缺失");
  return step;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

export class Orchestrator {
  private readonly repository: TaskRepository;
  private readonly profiles: Map<string, AgentProfile>;
  private readonly adapters: ReadonlyMap<string, AgentAdapter>;
  private readonly runs = new Map<string, RunControl>();
  private readonly loops = new Map<string, Promise<void>>();
  private readonly now: () => string;

  constructor(private readonly deps: OrchestratorDeps) {
    this.repository = deps.repository;
    this.profiles = new Map(deps.profiles.map((profile) => [profile.id, profile]));
    this.adapters = deps.adapters;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  listProfiles(): AgentProfile[] {
    return [...this.profiles.values()];
  }

  listTasks(): TaskSummary[] {
    return this.repository.listTasks();
  }

  getSnapshot(taskId: string, afterSeq = 0): TaskSnapshot | null {
    const data = this.repository.getSnapshotData(taskId, afterSeq);
    if (!data) return null;
    const participants = data.task.participantIds
      .map((id) => this.profiles.get(id))
      .filter((profile): profile is AgentProfile => profile !== undefined);
    return { ...data, participants };
  }

  createTask(input: NewTask): Task {
    const participants = input.participantIds.map((id) => this.requireProfile(id));
    const now = this.now();
    const task: Task = {
      id: randomUUID(),
      goal: input.goal,
      acceptanceCriteria: input.acceptanceCriteria,
      mode: input.mode,
      status: "queued",
      participantIds: input.participantIds,
      budget: input.budget,
      workingDirectory: input.workingDirectory,
      configSnapshot: {
        engine: ENGINE_VERSION,
        mode: input.mode,
        participants: participants.map((profile) => `${profile.id}->${profile.adapterId}`).join(", "),
        maxTotalCalls: String(input.budget.maxTotalCalls),
        maxRounds: String(input.budget.maxRounds),
        perCallTimeoutMs: String(input.budget.perCallTimeoutMs),
      },
      degraded: false,
      callsUsed: 0,
      createdAt: now,
      updatedAt: now,
    };
    const plan = planSteps(input.mode, participants, input.budget.maxRounds);

    this.repository.transaction(() => {
      this.repository.createTask(task);
      plan.forEach((planned, ordinal) => {
        this.repository.createStep({
          id: randomUUID(),
          taskId: task.id,
          ordinal,
          kind: planned.kind,
          title: planned.title,
          participantId: planned.participant.id,
          status: "pending",
          inputSummary: planned.inputSummary,
          round: planned.round,
        });
      });
      this.repository.appendEvents(task.id, [{ type: "task.created", message: `任务已创建，计划 ${plan.length} 个步骤` }], now);
    });

    this.start(task.id);
    return this.requireTask(task.id);
  }

  pause(taskId: string): Task {
    const task = this.requireTask(taskId);
    const control = this.runs.get(taskId);
    if (task.status !== "running" || !control) throw new TaskStateError("只有运行中的任务可以暂停");
    const at = this.now();
    this.repository.transaction(() => {
      this.repository.updateTaskStatus(taskId, "paused", at);
      this.repository.appendEvents(taskId, [{ type: "task.paused", message: "已暂停：正在进行的调用结束后，不再开始新步骤" }], at);
    });
    control.pause();
    return this.requireTask(taskId);
  }

  resume(taskId: string): Task {
    const task = this.requireTask(taskId);
    const control = this.runs.get(taskId);
    if (task.status !== "paused" || !control) throw new TaskStateError("只有已暂停的任务可以继续");
    const at = this.now();
    this.repository.transaction(() => {
      this.repository.updateTaskStatus(taskId, "running", at);
      this.repository.appendEvents(taskId, [{ type: "task.resumed", message: "继续执行" }], at);
    });
    control.resume();
    return this.requireTask(taskId);
  }

  /** 请求取消。终态由运行循环在中止后统一写入，因此返回时状态可能仍为进行中。 */
  cancel(taskId: string): Task {
    const task = this.requireTask(taskId);
    const control = this.runs.get(taskId);
    if ((task.status !== "running" && task.status !== "paused") || !control) {
      throw new TaskStateError("只有进行中的任务可以取消");
    }
    control.stop("user");
    return this.requireTask(taskId);
  }

  /** 服务关闭：中止所有运行中的任务，并等待其写入终态后返回。 */
  async shutdown(): Promise<void> {
    for (const control of [...this.runs.values()]) control.stop("shutdown");
    await Promise.allSettled([...this.loops.values()]);
  }

  /**
   * 启动时调用：上一次进程未正常结束的任务无法续跑，统一标记为失败，避免界面永远显示“运行中”。
   */
  recoverInterrupted(): number {
    const interrupted = this.repository.listTasksByStatus(["queued", "running", "paused"]);
    for (const task of interrupted) this.abandon(task.id, "服务重启导致任务中断");
    return interrupted.length;
  }

  // -- 运行循环 -----------------------------------------------------------

  private start(taskId: string): void {
    const control = new RunControl();
    this.runs.set(taskId, control);
    const at = this.now();
    this.repository.transaction(() => {
      this.repository.updateTaskStatus(taskId, "running", at);
      this.repository.appendEvents(taskId, [{ type: "task.started", message: "开始执行" }], at);
    });
    const loop = this.execute(taskId, control)
      .catch((error: unknown) => {
        this.deps.log?.error({ errorName: errorName(error) }, "Task run crashed");
        try {
          this.abandon(taskId, "内部错误，任务已停止");
        } catch (cause) {
          this.deps.log?.error({ errorName: errorName(cause) }, "Failed to record task failure");
        }
      })
      .finally(() => {
        this.runs.delete(taskId);
        this.loops.delete(taskId);
      });
    this.loops.set(taskId, loop);
  }

  private async execute(taskId: string, control: RunControl): Promise<void> {
    const task = this.requireTask(taskId);
    const participants = task.participantIds.map((id) => this.requireProfile(id));
    const steps = this.repository.listSteps(taskId);
    const ctx: RunContext = {
      taskId,
      goal: task.goal,
      acceptanceCriteria: task.acceptanceCriteria,
      budget: task.budget,
      workingDirectory: task.workingDirectory,
      control,
      degraded: false,
      budgetNoticed: false,
    };
    if (task.mode === "coordinator") await this.runCoordinator(ctx, participants, steps);
    else await this.runDiscussion(ctx, participants, steps);
    this.finalize(ctx);
  }

  /** 协调者模式：第一位参与者拆解分工 → 工作参与者各自完成 → 协调者综合。 */
  private async runCoordinator(ctx: RunContext, participants: AgentProfile[], steps: Step[]): Promise<void> {
    const [coordinator, ...workers] = participants;
    const brief = requireStep(steps.find((step) => step.kind === "brief"));
    const dispatches = steps.filter((step) => step.kind === "dispatch");
    const synthesis = requireStep(steps.find((step) => step.kind === "synthesize"));

    const briefResult = await this.executeStep(ctx, brief, coordinator, {
      reserve: FINAL_CALL_RESERVE,
      packet: buildPacket(ctx, { role: coordinator.role, assignment: briefInstruction(workers), format: BRIEF_FORMAT, digest: [] }),
    });
    if (briefResult.status === "cancelled") return;

    let assignments = new Map<string, string>();
    if (briefResult.status === "succeeded") {
      assignments = parseAssignments(briefResult.output, workers);
      if (assignments.size === 0) this.recordPlanAdjusted(ctx, "分工格式无法识别，已改用默认分工");
    } else {
      this.recordPlanAdjusted(ctx, "分工步骤未产生结果，已改用默认分工");
    }

    const contributions: DigestEntry[] = [];
    for (const [index, worker] of workers.entries()) {
      const dispatch = requireStep(dispatches[index]);
      const assignment = assignments.get(worker.id) ?? defaultAssignment(worker);
      this.repository.setStepInput(dispatch.id, excerpt(assignment));
      const result = await this.executeStep(ctx, dispatch, worker, {
        reserve: FINAL_CALL_RESERVE,
        packet: buildPacket(ctx, { role: worker.role, assignment, format: WORKER_FORMAT, digest: [] }),
      });
      if (result.status === "cancelled") return;
      if (result.status === "succeeded") {
        contributions.push({ participantName: worker.name, round: 1, excerpt: excerpt(result.output) });
      }
    }

    if (contributions.length === 0) {
      this.skipNow(ctx, synthesis, "没有可综合的成功输出，未执行");
      return;
    }
    await this.executeStep(ctx, synthesis, coordinator, {
      reserve: 0,
      artifactTitle: FINAL_TITLE,
      packet: buildPacket(ctx, { role: coordinator.role, assignment: SYNTHESIS_INSTRUCTION, format: FINAL_FORMAT, digest: contributions }),
    });
  }

  /**
   * 讨论模式：按轮次依次发言，每位只看到其他参与者的最新摘录；
   * 轮数或预算用尽后，由第一位参与者收敛。
   */
  private async runDiscussion(ctx: RunContext, participants: AgentProfile[], steps: Step[]): Promise<void> {
    const [moderator] = participants;
    const latest = new Map<string, DigestEntry>();

    for (let round = 1; round <= ctx.budget.maxRounds; round += 1) {
      for (const participant of participants) {
        const step = requireStep(steps.find((item) => item.kind === "discuss" && item.round === round && item.participantId === participant.id));
        const digest = [...latest]
          .filter(([id]) => id !== participant.id)
          .map(([, entry]) => entry);
        const result = await this.executeStep(ctx, step, participant, {
          reserve: FINAL_CALL_RESERVE,
          packet: buildPacket(ctx, {
            role: participant.role,
            assignment: round === 1 ? ROUND_ONE_INSTRUCTION : ROUND_FOLLOW_INSTRUCTION,
            format: DISCUSS_FORMAT,
            digest,
            round,
          }),
        });
        if (result.status === "cancelled") return;
        if (result.status === "succeeded") {
          latest.set(participant.id, { participantName: participant.name, round, excerpt: excerpt(result.output) });
        }
      }
    }

    const converge = requireStep(steps.find((item) => item.kind === "converge"));
    if (latest.size === 0) {
      this.skipNow(ctx, converge, "没有可收敛的成功发言，未执行");
      return;
    }
    await this.executeStep(ctx, converge, moderator, {
      reserve: 0,
      artifactTitle: FINAL_TITLE,
      packet: buildPacket(ctx, {
        role: moderator.role,
        assignment: CONVERGE_INSTRUCTION,
        format: FINAL_FORMAT,
        digest: [...latest.values()],
      }),
    });
  }

  /**
   * 执行单个步骤：暂停检查 → 预算检查 → 计数并标记开始 → 带超时与取消的调用 → 落库结果。
   * 每一次状态变更都与对应事件在同一事务中写入。
   */
  private async executeStep(
    ctx: RunContext,
    step: Step,
    participant: AgentProfile,
    request: StepRequest,
  ): Promise<StepResult> {
    await ctx.control.waitWhilePaused();
    if (ctx.control.aborted) return { status: "cancelled" };

    const task = this.requireTask(ctx.taskId);
    if (task.callsUsed >= task.budget.maxTotalCalls - request.reserve) {
      this.skipForBudget(ctx, step, task.callsUsed, task.budget.maxTotalCalls);
      return { status: "skipped" };
    }

    const adapter = this.adapters.get(participant.adapterId);
    if (!adapter) {
      this.finishStep(ctx, step, participant, { status: "failed", finishedAt: this.now(), note: "适配器未注册，调用未发起" });
      return { status: "failed" };
    }

    const startedAt = this.now();
    this.repository.transaction(() => {
      this.repository.startStep(step.id, startedAt);
      const callsUsed = this.repository.incrementCallsUsed(ctx.taskId, startedAt);
      this.repository.appendEvents(ctx.taskId, [{
        type: "step.started",
        message: `${participant.name} 开始：${step.title}`,
        stepId: step.id,
        participantId: participant.id,
        detail: { callsUsed, maxTotalCalls: task.budget.maxTotalCalls },
      }], startedAt);
    });

    const { timedOut, settled } = await this.invoke(ctx, adapter, request.packet, task.budget.perCallTimeoutMs);
    const finishedAt = this.now();
    const outcome = classifyCall({
      settled,
      timedOut,
      stopped: ctx.control.aborted,
      stopReason: ctx.control.stopReason,
      timeoutSeconds: Math.round(task.budget.perCallTimeoutMs / 1000),
    });
    const durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));

    if (outcome.status === "succeeded") {
      this.finishStep(ctx, step, participant, { status: "succeeded", finishedAt, durationMs, output: outcome.output }, request.artifactTitle);
      return { status: "succeeded", output: outcome.output };
    }
    this.finishStep(ctx, step, participant, { status: outcome.status, finishedAt, durationMs, note: outcome.note });
    return { status: outcome.status };
  }

  /**
   * 调用 adapter。超时与用户取消都通过同一个 AbortSignal 传递；
   * 调用方据此区分两者，adapter 只需遵守信号。
   */
  private async invoke(
    ctx: RunContext,
    adapter: AgentAdapter,
    packet: HandoffPacket,
    timeoutMs: number,
  ): Promise<{ timedOut: boolean; settled: Settled }> {
    const callAbort = new AbortController();
    const forwardStop = (): void => callAbort.abort();
    let timedOut = false;
    ctx.control.abort.signal.addEventListener("abort", forwardStop, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      callAbort.abort();
    }, timeoutMs);
    try {
      const result = await adapter.invoke({ packet, signal: callAbort.signal, workingDirectory: ctx.workingDirectory });
      return { timedOut, settled: { ok: true, result } };
    } catch (error) {
      if (!(error instanceof AdapterError)) {
        this.deps.log?.error({ errorName: errorName(error) }, "Adapter invocation failed unexpectedly");
      }
      return { timedOut, settled: { ok: false, error } };
    } finally {
      clearTimeout(timer);
      ctx.control.abort.signal.removeEventListener("abort", forwardStop);
    }
  }

  private finishStep(
    ctx: RunContext,
    step: Step,
    participant: AgentProfile,
    finish: StepFinish,
    artifactTitle?: string,
  ): void {
    this.repository.transaction(() => {
      this.repository.finishStep(step.id, finish);
      if (finish.status === "succeeded" && artifactTitle && finish.output !== undefined) {
        const artifactId = randomUUID();
        this.repository.createArtifact({
          id: artifactId,
          taskId: ctx.taskId,
          stepId: step.id,
          title: artifactTitle,
          body: finish.output,
          createdAt: finish.finishedAt,
        } satisfies Artifact);
        this.repository.appendEvents(ctx.taskId, [{
          type: "artifact.created",
          message: `已生成产物：${artifactTitle}`,
          stepId: step.id,
          participantId: participant.id,
        }], finish.finishedAt);
      }
      const eventType = STEP_EVENT[finish.status];
      if (eventType) {
        const base = `${participant.name} ${STEP_VERB[finish.status]}：${step.title}`;
        const message = finish.note ? `${base}（${finish.note}）` : base;
        this.repository.appendEvents(ctx.taskId, [{
          type: eventType,
          message,
          stepId: step.id,
          participantId: participant.id,
          detail: finish.durationMs !== undefined ? { durationMs: finish.durationMs } : undefined,
        } satisfies EventInput], finish.finishedAt);
      }
    });
    if (finish.status === "failed" || finish.status === "timed_out") ctx.degraded = true;
  }

  private skipForBudget(ctx: RunContext, step: Step, used: number, max: number): void {
    const at = this.now();
    this.repository.transaction(() => {
      this.repository.finishStep(step.id, { status: "skipped", finishedAt: at, note: "调用预算不足，未执行" });
      if (!ctx.budgetNoticed) {
        ctx.budgetNoticed = true;
        this.repository.appendEvents(ctx.taskId, [{
          type: "budget.exhausted",
          message: `调用预算已用尽（${used}/${max}），剩余步骤将被跳过`,
          stepId: step.id,
        }], at);
      }
    });
    ctx.degraded = true;
  }

  private skipNow(ctx: RunContext, step: Step, note: string): void {
    this.repository.finishStep(step.id, { status: "skipped", finishedAt: this.now(), note });
    ctx.degraded = true;
  }

  private recordPlanAdjusted(ctx: RunContext, message: string): void {
    this.repository.transaction(() => {
      this.repository.appendEvents(ctx.taskId, [{ type: "plan.adjusted", message }], this.now());
    });
  }

  /** 运行结束：把未执行的步骤收尾，并写入任务终态。 */
  private finalize(ctx: RunContext): void {
    const at = this.now();
    const hasConclusion = this.repository.listArtifacts(ctx.taskId).length > 0;
    let status: "completed" | "cancelled" | "failed";
    let stopReason: string | null = null;
    if (ctx.control.stopReason === "shutdown") {
      status = "failed";
      stopReason = "服务停止，任务未完成";
    } else if (ctx.control.aborted) {
      status = "cancelled";
      stopReason = "用户取消";
    } else if (hasConclusion) {
      status = "completed";
    } else {
      status = "failed";
      stopReason = "没有产生最终结论";
    }

    const leftover: { status: TerminalStepStatus; note: string } = status === "cancelled"
      ? { status: "cancelled", note: "任务已取消，未执行" }
      : { status: "skipped", note: ctx.control.stopReason === "shutdown" ? "服务停止，未执行" : "前序步骤未能继续，未执行" };

    this.repository.transaction(() => {
      for (const step of this.repository.listSteps(ctx.taskId)) {
        if (step.status === "pending") {
          this.repository.finishStep(step.id, { status: leftover.status, finishedAt: at, note: leftover.note });
        }
      }
      this.repository.updateTaskStatus(ctx.taskId, status, at, { degraded: ctx.degraded, stopReason });
      this.repository.appendEvents(ctx.taskId, [endEvent(status, stopReason, ctx.degraded)], at);
    });
  }

  /** 异常或恢复路径：把进行中与未执行的步骤收尾，并标记任务失败。 */
  private abandon(taskId: string, reason: string): void {
    const task = this.repository.getTask(taskId);
    if (!task || TERMINAL_TASK_STATUSES.includes(task.status)) return;
    const at = this.now();
    this.repository.transaction(() => {
      for (const step of this.repository.listSteps(taskId)) {
        if (step.status === "running") {
          this.repository.finishStep(step.id, { status: "failed", finishedAt: at, note: `${reason}，调用未完成` });
        } else if (step.status === "pending") {
          this.repository.finishStep(step.id, { status: "skipped", finishedAt: at, note: `${reason}，未执行` });
        }
      }
      this.repository.updateTaskStatus(taskId, "failed", at, { stopReason: reason });
      this.repository.appendEvents(taskId, [{ type: "task.failed", message: `任务未完成：${reason}` }], at);
    });
  }

  private requireTask(taskId: string): Task {
    const task = this.repository.getTask(taskId);
    if (!task) throw new TaskNotFoundError("任务不存在");
    return task;
  }

  private requireProfile(id: string): AgentProfile {
    const profile = this.profiles.get(id);
    if (!profile) throw new Error(`未知参与者：${id}`);
    return profile;
  }
}

function endEvent(
  status: "completed" | "cancelled" | "failed",
  stopReason: string | null,
  degraded: boolean,
): EventInput {
  if (status === "completed") {
    return {
      type: "task.completed",
      message: degraded ? "任务完成，结论不完整：部分步骤未成功或被跳过" : "任务完成",
    };
  }
  if (status === "cancelled") return { type: "task.cancelled", message: "任务已取消" };
  return { type: "task.failed", message: `任务未完成：${stopReason ?? "未知原因"}` };
}
