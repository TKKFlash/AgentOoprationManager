/**
 * Codex CLI 适配器（受控只读）。
 *
 * 依据 2026-10-10 本机实测（codex-cli 0.155.1，经用户已配置的网关）：
 * - `codex exec --json` 输出 JSONL：thread.started / turn.started / item.started /
 *   item.completed / turn.completed。最终答复取自 item.completed 中 type 为 agent_message 的条目。
 * - `-s read-only` 沙箱生效：模型发起的写入被拒绝，工作目录无残留。
 *
 * 约束：不经 shell 包装层；不使用绕过审批/沙箱的开关；沙箱固定为 read-only，
 * 调用方无法放宽；提示词经 stdin 传入。
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  AdapterError,
  type AdapterCapabilities,
  type AdapterInvokeRequest,
  type AdapterInvokeResult,
  type AgentAdapter,
  type HandoffPacket,
} from "@aom/shared";

export interface CodexCliAdapterOptions {
  /** 可执行文件；默认 PATH 上的 `codex`。 */
  executable?: string;
  /**
   * 请求未指定工作目录时使用。应为服务自有的空目录，
   * 避免默认把项目目录暴露给上游。
   */
  defaultWorkingDirectory?: string;
  /** 测试注入：放在 exec 之前的参数，用于以替身脚本代替真实 codex。 */
  launcherArgs?: readonly string[];
}

export interface CodexEvent {
  type: string;
  item?: { type?: string; text?: string };
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** 解析上游 JSONL。非 JSON 的诊断行被忽略，不影响其余事件。 */
export function parseCodexJsonl(text: string): CodexEvent[] {
  const events: CodexEvent[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as CodexEvent;
      if (typeof parsed.type === "string") events.push(parsed);
    } catch {
      // 上游可能混入非 JSON 文本，忽略即可。
    }
  }
  return events;
}

/**
 * 提取对协调者的答复。
 *
 * 只取 agent_message。命令执行条目的输出属于工具细节，混入会污染讨论室内容。
 */
export function extractAgentMessage(events: readonly CodexEvent[]): string {
  return events
    .filter((event) => event.type === "item.completed" && event.item?.type === "agent_message")
    .map((event) => event.item?.text ?? "")
    .filter((text) => text.length > 0)
    .join("\n\n")
    .trim();
}

/**
 * 构造交给上游的提示词。
 *
 * 只展开 handoff packet 的内容：不附加本机历史，也不附加其他任务的上下文。
 */
export function buildPrompt(packet: HandoffPacket): string {
  const lines: string[] = [];
  lines.push(`你的角色：${packet.participantRole}`);
  lines.push(`任务目标：${packet.taskGoal}`, `本次分工：${packet.assignment}`);
  if (packet.round !== undefined) lines.push(`讨论轮次：第 ${packet.round} 轮`);

  if (packet.confirmedFacts.length > 0) {
    lines.push("", "已确认的事实：", ...packet.confirmedFacts.map((fact) => `- ${fact}`));
  }
  if (packet.constraints.length > 0) {
    lines.push("", "约束条件：", ...packet.constraints.map((constraint) => `- ${constraint}`));
  }
  if (packet.evidence.length > 0) {
    lines.push("", "参考证据：", ...packet.evidence.map((item) => `- ${item}`));
  }
  if (packet.digest.length > 0) {
    lines.push("", "其他参与者的摘录：");
    for (const entry of packet.digest) {
      lines.push(`- ${entry.participantName}（第 ${entry.round} 轮）：${entry.excerpt}`);
    }
  }

  lines.push("", `交付格式：${packet.deliverableFormat}`, "", "直接给出结论与依据，不要修改任何文件。");
  return lines.join("\n");
}

/**
 * 结束整棵进程树。
 *
 * Windows 上 Node 的 kill() 只结束直接子进程。使用 taskkill /T 连同后代一起结束，
 * 避免上游工具子进程成为孤儿。
 */
export function terminateProcessTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  }
  child.kill();
}

export class CodexCliAgentAdapter implements AgentAdapter {
  readonly id = "codex-cli";

  readonly capabilities: AdapterCapabilities = {
    transport: "subprocess-stdio",
    supportsStreaming: false,
    supportsPersistentSession: false,
    supportsCancel: true,
    supportsWorkingDirectory: true,
    supportsSandboxModes: true,
    requiresApprovalBridge: false,
    requiresInstalledOptionalDependencies: false,
    // stdio 子进程边界；上游没有协议认证，禁止暴露为网络服务。
    trustedControllerOnly: true,
  };

  constructor(private readonly options: CodexCliAdapterOptions = {}) {}

  invoke(request: AdapterInvokeRequest): Promise<AdapterInvokeResult> {
    const cwd = request.workingDirectory ?? this.options.defaultWorkingDirectory;
    if (!cwd) return Promise.reject(new AdapterError("failed", "未配置 codex 工作目录"));
    if (request.signal.aborted) return Promise.reject(new AdapterError("cancelled", "调用已被取消"));

    const args = [
      ...(this.options.launcherArgs ?? []),
      "exec",
      "--json",
      // 固定只读，且不接受调用方覆盖：写入能力属于第 6 期，需逐任务授权。
      "-s", "read-only",
      "--skip-git-repo-check",
      "--ephemeral",
    ];

    return new Promise<AdapterInvokeResult>((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = spawn(this.options.executable ?? "codex", args, {
          cwd,
          shell: false,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch {
        reject(new AdapterError("failed", "无法启动 codex 进程"));
        return;
      }

      let stdout = "";
      let settled = false;
      const onAbort = (): void => terminateProcessTree(child);
      request.signal.addEventListener("abort", onAbort, { once: true });

      const settle = (finish: () => void): void => {
        if (settled) return;
        settled = true;
        request.signal.removeEventListener("abort", onAbort);
        finish();
      };

      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => { stdout += chunk; });
      // 不收集 stderr，避免上游诊断内容进入用户可见的错误信息；仍需排空管道防止阻塞。
      child.stderr?.resume();
      // codex 提前退出时写入 stdin 会得到 EPIPE，这里吞掉，由退出码统一判定结果。
      child.stdin?.on("error", () => {});

      child.on("error", () => {
        settle(() => reject(new AdapterError("failed", "无法启动 codex 进程")));
      });

      child.on("close", (code) => {
        settle(() => {
          if (request.signal.aborted) {
            reject(new AdapterError("cancelled", "调用已被取消"));
            return;
          }
          const events = parseCodexJsonl(stdout);
          const output = extractAgentMessage(events);
          if (code !== 0 || output.length === 0) {
            reject(new AdapterError(
              "failed",
              `codex 未返回答复（退出码 ${code ?? "未知"}，上游事件 ${events.length} 个）`,
            ));
            return;
          }
          const usage = events.filter((event) => event.type === "turn.completed").pop()?.usage;
          resolve({
            output,
            upstreamEventCount: events.length,
            usage: usage ? { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens } : undefined,
          });
        });
      });

      child.stdin?.end(buildPrompt(request.packet));
    });
  }
}
