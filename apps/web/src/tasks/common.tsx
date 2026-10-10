import type { StepStatus, TaskStatus } from "@aom/shared";

export const TERMINAL_STATUSES: readonly TaskStatus[] = ["completed", "cancelled", "failed"];

type Tone = "run" | "ok" | "warn" | "bad" | "idle";

const TASK_LABEL: Record<TaskStatus, string> = {
  queued: "排队中",
  running: "运行中",
  paused: "已暂停",
  completed: "已完成",
  cancelled: "已取消",
  failed: "未完成",
};

const STEP_LABEL: Record<StepStatus, string> = {
  pending: "待执行",
  running: "进行中",
  succeeded: "已完成",
  failed: "失败",
  timed_out: "超时",
  cancelled: "已取消",
  skipped: "已跳过",
};

const TASK_TONE: Record<TaskStatus, Tone> = {
  queued: "idle",
  running: "run",
  paused: "warn",
  completed: "ok",
  cancelled: "idle",
  failed: "bad",
};

const STEP_TONE: Record<StepStatus, Tone> = {
  pending: "idle",
  running: "run",
  succeeded: "ok",
  failed: "bad",
  timed_out: "bad",
  cancelled: "idle",
  skipped: "idle",
};

export function stepLabel(status: StepStatus): string {
  return STEP_LABEL[status];
}

export function stepTone(status: StepStatus): Tone {
  return STEP_TONE[status];
}

export function StatusChip({ status }: { status: TaskStatus }) {
  return <span className={`chip tone-${TASK_TONE[status]}`}>{TASK_LABEL[status]}</span>;
}

export function StepChip({ status }: { status: StepStatus }) {
  return <span className={`chip tone-${STEP_TONE[status]}`}>{STEP_LABEL[status]}</span>;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function formatDuration(ms: number | undefined): string | null {
  if (ms === undefined) return null;
  return ms < 1_000 ? `${ms} 毫秒` : `${(ms / 1_000).toFixed(1)} 秒`;
}

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "无法连接本机服务";
}
