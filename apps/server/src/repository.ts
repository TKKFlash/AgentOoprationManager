import type { DatabaseSync } from "node:sqlite";
import type {
  Artifact, CallBudget, CollaborationMode, Step, StepKind, StepStatus,
  TaskEvent, TaskStatus, TaskSummary, Task, TerminalStepStatus, EventType,
} from "@aom/shared";

interface TaskRow {
  id: string;
  goal: string;
  acceptance_criteria: string;
  mode: string;
  status: string;
  participant_ids: string;
  budget_json: string;
  working_directory: string | null;
  config_snapshot_json: string;
  degraded: number;
  stop_reason: string | null;
  calls_used: number;
  created_at: string;
  updated_at: string;
}

interface StepRow {
  id: string;
  task_id: string;
  ordinal: number;
  kind: string;
  title: string;
  participant_id: string;
  status: string;
  input_summary: string;
  output_body: string | null;
  note: string | null;
  round: number | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
}

interface ArtifactRow {
  id: string;
  task_id: string;
  step_id: string;
  title: string;
  body: string;
  created_at: string;
}

interface EventRow {
  id: string;
  task_id: string;
  seq: number;
  type: string;
  at: string;
  message: string;
  step_id: string | null;
  participant_id: string | null;
  detail_json: string | null;
}

export type EventInput = Omit<TaskEvent, "id" | "seq" | "taskId" | "at">;

export interface TaskSnapshotData {
  task: Task;
  steps: Step[];
  artifacts: Artifact[];
  events: TaskEvent[];
}

export interface StepFinish {
  status: TerminalStepStatus;
  finishedAt: string;
  durationMs?: number;
  output?: string;
  note?: string;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    goal: row.goal,
    acceptanceCriteria: parseJson<string[]>(row.acceptance_criteria, []),
    mode: row.mode as CollaborationMode,
    status: row.status as TaskStatus,
    participantIds: parseJson<string[]>(row.participant_ids, []),
    budget: parseJson<CallBudget>(row.budget_json, { maxTotalCalls: 0, maxRounds: 0, perCallTimeoutMs: 0 }),
    workingDirectory: row.working_directory ?? undefined,
    configSnapshot: parseJson<Record<string, string>>(row.config_snapshot_json, {}),
    degraded: row.degraded === 1,
    stopReason: row.stop_reason ?? undefined,
    callsUsed: row.calls_used,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toStep(row: StepRow): Step {
  return {
    id: row.id,
    taskId: row.task_id,
    ordinal: row.ordinal,
    kind: row.kind as StepKind,
    title: row.title,
    participantId: row.participant_id,
    status: row.status as StepStatus,
    inputSummary: row.input_summary,
    output: row.output_body ?? undefined,
    note: row.note ?? undefined,
    round: row.round ?? undefined,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    durationMs: row.duration_ms ?? undefined,
  };
}

function toArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    taskId: row.task_id,
    stepId: row.step_id,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
  };
}

function toEvent(row: EventRow): TaskEvent {
  const detail = row.detail_json
    ? parseJson<Record<string, string | number | boolean>>(row.detail_json, {})
    : {};
  return {
    id: row.id,
    taskId: row.task_id,
    seq: row.seq,
    type: row.type as EventType,
    at: row.at,
    message: row.message,
    stepId: row.step_id ?? undefined,
    participantId: row.participant_id ?? undefined,
    detail: Object.keys(detail).length > 0 ? detail : undefined,
  };
}

/**
 * 任务仓库：本模块是唯一拼接 SQL 的地方。
 *
 * 调用方负责用 transaction() 把一次状态变更与它的事件包在一起，
 * 保证刷新后时间线不会出现“有事件、无状态”或反过来的错位。
 * transaction() 不可嵌套。
 */
export class TaskRepository {
  constructor(private readonly database: DatabaseSync) {}

  transaction<T>(work: () => T): T {
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const result = work();
      this.database.exec("COMMIT;");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  // -- 任务 ---------------------------------------------------------------

  createTask(task: Task): void {
    this.database.prepare(`
      INSERT INTO tasks (id, goal, acceptance_criteria, mode, status, participant_ids,
        budget_json, working_directory, config_snapshot_json, degraded, stop_reason,
        calls_used, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id,
      task.goal,
      JSON.stringify(task.acceptanceCriteria),
      task.mode,
      task.status,
      JSON.stringify(task.participantIds),
      JSON.stringify(task.budget),
      task.workingDirectory ?? null,
      JSON.stringify(task.configSnapshot),
      task.degraded ? 1 : 0,
      task.stopReason ?? null,
      task.callsUsed,
      task.createdAt,
      task.updatedAt,
    );
  }

  getTask(id: string): Task | null {
    const row = this.database.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
    return row ? toTask(row) : null;
  }

  listTasks(limit = 100): TaskSummary[] {
    const rows = this.database.prepare(`
      SELECT t.*,
        (SELECT COUNT(*) FROM steps s WHERE s.task_id = t.id) AS step_count,
        (SELECT COUNT(*) FROM steps s WHERE s.task_id = t.id AND s.status = 'succeeded') AS completed_step_count
      FROM tasks t ORDER BY t.created_at DESC LIMIT ?
    `).all(limit) as unknown as (TaskRow & { step_count: number; completed_step_count: number })[];
    return rows.map((row) => {
      const task = toTask(row);
      return {
        id: task.id,
        goal: task.goal,
        mode: task.mode,
        status: task.status,
        degraded: task.degraded,
        callsUsed: task.callsUsed,
        maxTotalCalls: task.budget.maxTotalCalls,
        stepCount: row.step_count,
        completedStepCount: row.completed_step_count,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      };
    });
  }

  listTasksByStatus(statuses: readonly TaskStatus[]): Task[] {
    const placeholders = statuses.map(() => "?").join(", ");
    const rows = this.database.prepare(`SELECT * FROM tasks WHERE status IN (${placeholders})`)
      .all(...statuses) as unknown as TaskRow[];
    return rows.map(toTask);
  }

  updateTaskStatus(
    id: string,
    status: TaskStatus,
    at: string,
    extra: { degraded?: boolean; stopReason?: string | null } = {},
  ): void {
    const current = this.getTask(id);
    if (!current) throw new Error("任务不存在");
    this.database.prepare(
      "UPDATE tasks SET status = ?, degraded = ?, stop_reason = ?, updated_at = ? WHERE id = ?",
    ).run(
      status,
      (extra.degraded ?? current.degraded) ? 1 : 0,
      extra.stopReason === undefined ? (current.stopReason ?? null) : extra.stopReason,
      at,
      id,
    );
  }

  /** 登记一次真实发生的 adapter 调用，返回登记后的计数。调用开始时即计数，失败与超时同样占用预算。 */
  incrementCallsUsed(id: string, at: string): number {
    this.database.prepare("UPDATE tasks SET calls_used = calls_used + 1, updated_at = ? WHERE id = ?").run(at, id);
    const row = this.database.prepare("SELECT calls_used FROM tasks WHERE id = ?").get(id) as { calls_used: number } | undefined;
    return row?.calls_used ?? 0;
  }

  // -- 步骤 ---------------------------------------------------------------

  createStep(step: Step): void {
    this.database.prepare(`
      INSERT INTO steps (id, task_id, ordinal, kind, title, participant_id, status,
        input_summary, output_body, note, round, started_at, finished_at, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      step.id,
      step.taskId,
      step.ordinal,
      step.kind,
      step.title,
      step.participantId,
      step.status,
      step.inputSummary,
      step.output ?? null,
      step.note ?? null,
      step.round ?? null,
      step.startedAt ?? null,
      step.finishedAt ?? null,
      step.durationMs ?? null,
    );
  }

  listSteps(taskId: string): Step[] {
    const rows = this.database.prepare("SELECT * FROM steps WHERE task_id = ? ORDER BY ordinal")
      .all(taskId) as unknown as StepRow[];
    return rows.map(toStep);
  }

  startStep(id: string, startedAt: string): void {
    this.database.prepare("UPDATE steps SET status = 'running', started_at = ? WHERE id = ?").run(startedAt, id);
  }

  finishStep(id: string, finish: StepFinish): void {
    this.database.prepare(`
      UPDATE steps SET status = ?, finished_at = ?, duration_ms = ?,
        output_body = COALESCE(?, output_body), note = ?
      WHERE id = ?
    `).run(
      finish.status,
      finish.finishedAt,
      finish.durationMs ?? null,
      finish.output ?? null,
      finish.note ?? null,
      id,
    );
  }

  setStepInput(id: string, inputSummary: string): void {
    this.database.prepare("UPDATE steps SET input_summary = ? WHERE id = ?").run(inputSummary, id);
  }

  // -- 产物 ---------------------------------------------------------------

  createArtifact(artifact: Artifact): void {
    this.database.prepare(
      "INSERT INTO artifacts (id, task_id, step_id, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(artifact.id, artifact.taskId, artifact.stepId, artifact.title, artifact.body, artifact.createdAt);
  }

  listArtifacts(taskId: string): Artifact[] {
    const rows = this.database.prepare("SELECT * FROM artifacts WHERE task_id = ? ORDER BY created_at")
      .all(taskId) as unknown as ArtifactRow[];
    return rows.map(toArtifact);
  }

  // -- 事件 ---------------------------------------------------------------

  /**
   * 追加事件并分配 seq。seq 在任务内单调递增，必须在调用方的事务中执行，
   * 否则并发写入可能分配重复序号。
   */
  appendEvents(taskId: string, events: readonly EventInput[], at: string): TaskEvent[] {
    const current = this.database.prepare("SELECT COALESCE(MAX(seq), 0) AS max_seq FROM events WHERE task_id = ?")
      .get(taskId) as { max_seq: number };
    const insert = this.database.prepare(`
      INSERT INTO events (id, task_id, seq, type, at, message, step_id, participant_id, detail_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const written: TaskEvent[] = [];
    let seq = current.max_seq;
    for (const event of events) {
      seq += 1;
      const id = `${taskId}:${seq}`;
      const detail = event.detail && Object.keys(event.detail).length > 0 ? JSON.stringify(event.detail) : null;
      insert.run(id, taskId, seq, event.type, at, event.message, event.stepId ?? null, event.participantId ?? null, detail);
      written.push({ ...event, id, taskId, seq, at });
    }
    return written;
  }

  /** 返回 seq 严格大于 afterSeq 的事件，供断线或刷新后的增量补读。 */
  listEvents(taskId: string, afterSeq = 0): TaskEvent[] {
    const rows = this.database.prepare("SELECT * FROM events WHERE task_id = ? AND seq > ? ORDER BY seq")
      .all(taskId, afterSeq) as unknown as EventRow[];
    return rows.map(toEvent);
  }

  getSnapshotData(taskId: string, afterSeq = 0): TaskSnapshotData | null {
    const task = this.getTask(taskId);
    if (!task) return null;
    return {
      task,
      steps: this.listSteps(taskId),
      artifacts: this.listArtifacts(taskId),
      events: this.listEvents(taskId, afterSeq),
    };
  }
}
