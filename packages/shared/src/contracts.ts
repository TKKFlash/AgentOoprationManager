/**
 * 工作台领域契约（第 3、4 期）。
 *
 * 上游 agent 的原始 wire schema（如 Codex JSONL）不作为公共 API：
 * 所有上游输出先投影为这里的类型，再写入数据库或返回前端。
 */

// ---------------------------------------------------------------------------
// 协作模式
// ---------------------------------------------------------------------------

export const COLLABORATION_MODES = ["coordinator", "discussion"] as const;
export type CollaborationMode = (typeof COLLABORATION_MODES)[number];

export const MODE_LABELS: Record<CollaborationMode, string> = {
  coordinator: "协调者分工",
  discussion: "多轮讨论",
};

export const MODE_DESCRIPTIONS: Record<CollaborationMode, string> = {
  coordinator: "第一位参与者担任协调者：先拆解分工，其余参与者各自完成后，由协调者综合为最终结论。",
  discussion: "参与者按轮次依次发言，每位只看到其他参与者的摘录；达到轮数或预算上限后，由第一位参与者收敛为最终结论。",
};

// ---------------------------------------------------------------------------
// 状态
// ---------------------------------------------------------------------------

export const TASK_STATUSES = ["queued", "running", "paused", "completed", "cancelled", "failed"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** 终态任务不再推进；前端据此停止轮询。 */
export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = ["completed", "cancelled", "failed"];

export const STEP_STATUSES = ["pending", "running", "succeeded", "failed", "timed_out", "cancelled", "skipped"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];
export type TerminalStepStatus = Exclude<StepStatus, "pending" | "running">;

export const STEP_KINDS = ["brief", "dispatch", "discuss", "synthesize", "converge"] as const;
export type StepKind = (typeof STEP_KINDS)[number];

// ---------------------------------------------------------------------------
// 参与者与 adapter
// ---------------------------------------------------------------------------

/**
 * adapter 能力声明。未实测为真的能力一律为 false，避免界面夸大 provider 能力。
 */
export interface AdapterCapabilities {
  /** in-process 为内置模拟；subprocess-stdio 为本机子进程。 */
  transport: "in-process" | "subprocess-stdio";
  supportsStreaming: boolean;
  supportsPersistentSession: boolean;
  supportsCancel: boolean;
  supportsWorkingDirectory: boolean;
  supportsSandboxModes: boolean;
  /** 需要外部审批桥接；本工作台尚未实现，为 true 的 adapter 不得启用。 */
  requiresApprovalBridge: boolean;
  requiresInstalledOptionalDependencies: boolean;
  /** 只能由本机受信控制器以 stdio 启动，禁止网络暴露。 */
  trustedControllerOnly: boolean;
}

/** 可对外展示的参与者档案。不含凭据或端点密钥。 */
export interface AgentProfile {
  id: string;
  name: string;
  /** 角色用途说明，帮助用户选择参与者；不自动决定分工。 */
  role: string;
  /** 指向已注册 adapter 的标识。 */
  adapterId: string;
  description: string;
}

/** 其他参与者发言的裁剪摘录；不含完整输出。 */
export interface DigestEntry {
  participantName: string;
  round: number;
  excerpt: string;
}

/**
 * 交给单次调用的最小简报。
 *
 * 不含完整对话历史，也不含其他参与者的完整输出；需要的只是裁剪后的摘录。
 */
export interface HandoffPacket {
  taskGoal: string;
  /** 本次调用被要求完成的事。 */
  assignment: string;
  participantRole: string;
  constraints: string[];
  /** 用户确认过的背景事实；本期尚无入口，始终为空。 */
  confirmedFacts: string[];
  /** 按需证据；本期尚无入口，始终为空。 */
  evidence: string[];
  digest: DigestEntry[];
  round?: number;
  deliverableFormat: string;
}

export interface AdapterInvokeRequest {
  packet: HandoffPacket;
  /**
   * 取消信号。引擎在用户取消或单次调用超时时触发；
   * adapter 必须尽快停止工作并以 AdapterError 结束，并负责回收其子进程。
   */
  signal: AbortSignal;
  workingDirectory?: string;
}

export interface AdapterInvokeResult {
  output: string;
  upstreamEventCount?: number;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export type AdapterErrorKind = "failed" | "timed_out" | "cancelled";

/** adapter 抛出的规范化错误；引擎据此映射步骤状态。 */
export class AdapterError extends Error {
  readonly kind: AdapterErrorKind;

  constructor(kind: AdapterErrorKind, message: string) {
    super(message);
    this.name = "AdapterError";
    this.kind = kind;
  }
}

export interface AgentAdapter {
  readonly id: string;
  readonly capabilities: AdapterCapabilities;
  invoke(request: AdapterInvokeRequest): Promise<AdapterInvokeResult>;
}

// ---------------------------------------------------------------------------
// 预算与限制
// ---------------------------------------------------------------------------

export interface CallBudget {
  /** 整个任务允许的 adapter 调用总次数（含失败与超时的调用）。 */
  maxTotalCalls: number;
  /** 讨论模式的发言轮数上限。 */
  maxRounds: number;
  /** 单次调用超时，超时即停止该调用。 */
  perCallTimeoutMs: number;
}

export const DEFAULT_BUDGET: CallBudget = {
  maxTotalCalls: 12,
  maxRounds: 3,
  perCallTimeoutMs: 120_000,
};

/**
 * 预算下限的依据：协调者模式至少需要 简报 + 一位工作参与者 + 综合，共 3 次调用。
 */
export const BUDGET_LIMITS = {
  maxTotalCalls: { min: 3, max: 50 },
  maxRounds: { min: 1, max: 10 },
  perCallTimeoutMs: { min: 5_000, max: 600_000 },
} as const;

export const PARTICIPANT_LIMITS = { min: 2, max: 6 } as const;

export const TEXT_LIMITS = {
  goal: 4_000,
  acceptanceCriterion: 500,
  acceptanceCriteria: 12,
} as const;

// ---------------------------------------------------------------------------
// 任务、步骤、产物
// ---------------------------------------------------------------------------

export interface Task {
  id: string;
  goal: string;
  acceptanceCriteria: string[];
  mode: CollaborationMode;
  status: TaskStatus;
  /** 参与者 id，顺序即发言顺序；第一位在协调者模式中担任协调者。 */
  participantIds: string[];
  budget: CallBudget;
  /** 只读工作目录；未设置时由 adapter 使用其默认目录。 */
  workingDirectory?: string;
  /** 创建时固定的配置摘要，用于事后审计。 */
  configSnapshot: Record<string, string>;
  /** 有步骤失败、超时或因预算跳过；结论可能不完整。 */
  degraded: boolean;
  /** 任务未正常完成时的用户可见原因。 */
  stopReason?: string;
  callsUsed: number;
  createdAt: string;
  updatedAt: string;
}

export interface Step {
  id: string;
  taskId: string;
  /** 从 0 递增的展示顺序。 */
  ordinal: number;
  kind: StepKind;
  title: string;
  participantId: string;
  status: StepStatus;
  /** 本步骤输入的裁剪摘要，用于时间线展示。 */
  inputSummary: string;
  /** 参与者的完整输出（讨论室中展示）。 */
  output?: string;
  /** 失败、超时、取消或跳过的用户可见说明。 */
  note?: string;
  round?: number;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
}

/** 最终交付物。讨论过程的发言保存在步骤输出中，不作为产物。 */
export interface Artifact {
  id: string;
  taskId: string;
  stepId: string;
  title: string;
  body: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// 事件
// ---------------------------------------------------------------------------

export const EVENT_TYPES = [
  "task.created",
  "task.started",
  "task.paused",
  "task.resumed",
  "task.completed",
  "task.cancelled",
  "task.failed",
  "plan.adjusted",
  "step.started",
  "step.succeeded",
  "step.failed",
  "step.timed_out",
  "step.cancelled",
  "budget.exhausted",
  "artifact.created",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/**
 * 投影后的工作台事件。
 *
 * `seq` 由服务端按任务单调递增分配。客户端断线或刷新后，只需带上最后收到的 seq 增量拉取。
 */
export interface TaskEvent {
  id: string;
  taskId: string;
  seq: number;
  type: EventType;
  at: string;
  /** 面向用户的简短说明，不含提示词正文或凭据。 */
  message: string;
  stepId?: string;
  participantId?: string;
  detail?: Record<string, string | number | boolean>;
}

// ---------------------------------------------------------------------------
// 对外读取模型
// ---------------------------------------------------------------------------

export interface TaskSnapshot {
  task: Task;
  participants: AgentProfile[];
  steps: Step[];
  artifacts: Artifact[];
  events: TaskEvent[];
}

export interface TaskSummary {
  id: string;
  goal: string;
  mode: CollaborationMode;
  status: TaskStatus;
  degraded: boolean;
  callsUsed: number;
  maxTotalCalls: number;
  stepCount: number;
  completedStepCount: number;
  createdAt: string;
  updatedAt: string;
}
