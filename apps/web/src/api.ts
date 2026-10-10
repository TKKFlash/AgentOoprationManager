import type { AgentProfile, CallBudget, CollaborationMode, TaskSnapshot, TaskStatus, TaskSummary } from "@aom/shared";

export interface HealthResponse {
  status: "ready" | "not_ready";
  service?: string;
  storage: "sqlite";
  storageStatus: "ready" | "error";
  schemaVersion?: number;
}

export interface Limit {
  min: number;
  max: number;
}

export interface ProfilesResponse {
  profiles: AgentProfile[];
  modes: { id: CollaborationMode; label: string; description: string }[];
  budget: {
    defaults: CallBudget;
    limits: { maxTotalCalls: Limit; maxRounds: Limit; perCallTimeoutMs: Limit };
  };
  participantLimits: Limit;
  textLimits: { goal: number; acceptanceCriterion: number; acceptanceCriteria: number };
}

export interface NewTaskInput {
  goal: string;
  acceptanceCriteria: string[];
  mode: CollaborationMode;
  participantIds: string[];
  budget: CallBudget;
  workingDirectory?: string;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(path, { ...init, headers });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `本机服务响应异常（${response.status}）`);
  return payload as T;
}

export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return request<HealthResponse>("/api/health", { signal });
}

export const api = {
  profiles: () => request<ProfilesResponse>("/api/profiles"),
  listTasks: () => request<{ tasks: TaskSummary[] }>("/api/tasks"),
  createTask: (input: NewTaskInput) =>
    request<{ id: string; status: TaskStatus }>("/api/tasks", { method: "POST", body: JSON.stringify(input) }),
  snapshot: (id: string, afterSeq: number) =>
    request<TaskSnapshot>(`/api/tasks/${encodeURIComponent(id)}?afterSeq=${afterSeq}`),
  pause: (id: string) => request<{ id: string; status: TaskStatus }>(`/api/tasks/${encodeURIComponent(id)}/pause`, { method: "POST" }),
  resume: (id: string) => request<{ id: string; status: TaskStatus }>(`/api/tasks/${encodeURIComponent(id)}/resume`, { method: "POST" }),
  cancel: (id: string) => request<{ id: string; status: TaskStatus }>(`/api/tasks/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
};
