/**
 * mock 适配器：不发起任何真实模型调用。
 *
 * 它是默认适配器，用于两种协作模式的自动化验收。用户未显式选择真实 provider 时，
 * 系统不得产生外部调用或费用。
 */
import {
  AdapterError,
  type AdapterCapabilities,
  type AdapterInvokeRequest,
  type AdapterInvokeResult,
  type AgentAdapter,
} from "@aom/shared";

export interface MockAdapterOptions {
  /** 模拟单次调用耗时，可按调用序号变化；用于验证暂停、取消与超时的真实时序。 */
  latencyMs?: number | ((callIndex: number) => number);
  /** 指定第 N 次调用失败；返回 null 表示该次正常完成。 */
  failOnCall?: (callIndex: number) => { kind: "failed" | "timed_out"; message: string } | null;
  /** 自定义输出；默认输出确定性文本，保证测试可重复。 */
  renderOutput?: (request: AdapterInvokeRequest, callIndex: number) => string;
}

export class MockAgentAdapter implements AgentAdapter {
  readonly id = "mock";

  readonly capabilities: AdapterCapabilities = {
    transport: "in-process",
    supportsStreaming: false,
    supportsPersistentSession: false,
    supportsCancel: true,
    supportsWorkingDirectory: false,
    supportsSandboxModes: false,
    requiresApprovalBridge: false,
    requiresInstalledOptionalDependencies: false,
    trustedControllerOnly: false,
  };

  private calls = 0;

  constructor(private readonly options: MockAdapterOptions = {}) {}

  /** 已发起的调用次数（含失败与被取消的调用）。 */
  get callCount(): number {
    return this.calls;
  }

  async invoke(request: AdapterInvokeRequest): Promise<AdapterInvokeResult> {
    const callIndex = this.calls;
    this.calls += 1;

    const latency = typeof this.options.latencyMs === "function"
      ? this.options.latencyMs(callIndex)
      : (this.options.latencyMs ?? 0);
    if (latency > 0) await this.waitFor(latency, request.signal);
    if (request.signal.aborted) throw new AdapterError("cancelled", "调用已被取消");

    const failure = this.options.failOnCall?.(callIndex);
    if (failure) throw new AdapterError(failure.kind, failure.message);

    const output = this.options.renderOutput?.(request, callIndex) ?? defaultOutput(request, callIndex);
    return { output, upstreamEventCount: 1, usage: { inputTokens: 0, outputTokens: output.length } };
  }

  /**
   * 可取消的等待。
   *
   * 必须在中止时清理定时器，否则被取消的调用会留下悬挂的 timer。
   */
  private waitFor(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(new AdapterError("cancelled", "调用已被取消"));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}

function defaultOutput(request: AdapterInvokeRequest, callIndex: number): string {
  const { packet } = request;
  const roundLabel = packet.round === undefined ? "" : `（第 ${packet.round} 轮）`;
  return [
    `[模拟输出 #${callIndex + 1}] ${packet.participantRole}${roundLabel}`,
    `任务目标：${packet.taskGoal}`,
    `本次分工：${packet.assignment}`,
    packet.digest.length > 0
      ? `已参考 ${packet.digest.length} 条其他参与者摘录`
      : "未收到其他参与者摘录",
  ].join("\n");
}
