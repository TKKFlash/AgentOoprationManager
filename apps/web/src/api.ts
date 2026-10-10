export interface HealthResponse {
  status: "ready" | "not_ready";
  service?: string;
  storage: "sqlite";
  storageStatus: "ready" | "error";
  schemaVersion?: number;
}

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch("/api/health", { signal, headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`本机服务响应异常（${response.status}）`);
  return (await response.json()) as HealthResponse;
}
