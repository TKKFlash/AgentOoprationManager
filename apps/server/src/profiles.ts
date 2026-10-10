import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import type { AgentAdapter, AgentProfile } from "@aom/shared";
import { CodexCliAgentAdapter, MockAgentAdapter } from "@aom/agent-adapters";

/**
 * 内置参与者。模拟参与者不调用任何模型；只有 codex-readonly 会启动本机 codex，
 * 且须由用户在具体任务中显式选择，系统不会自动加入。
 */
export const BUILT_IN_PROFILES: readonly AgentProfile[] = [
  {
    id: "analyst",
    name: "分析员",
    role: "拆解问题，独立给出分析与结论",
    adapterId: "mock",
    description: "模拟参与者，不调用任何模型。",
  },
  {
    id: "reviewer",
    name: "复核员",
    role: "检查结论的依据、遗漏与风险",
    adapterId: "mock",
    description: "模拟参与者，不调用任何模型。",
  },
  {
    id: "summarizer",
    name: "整理员",
    role: "归纳要点，形成结构化结论",
    adapterId: "mock",
    description: "模拟参与者，不调用任何模型。",
  },
  {
    id: "codex-readonly",
    name: "Codex（只读）",
    role: "在只读沙箱中分析工作目录内容",
    adapterId: "codex-cli",
    description: "调用本机 codex CLI，只读沙箱；每次调用启动一个本机进程，需显式选择。",
  },
];

export function createAdapters(codexScratchDirectory: string): Map<string, AgentAdapter> {
  return new Map<string, AgentAdapter>([
    ["mock", new MockAgentAdapter()],
    ["codex-cli", new CodexCliAgentAdapter({ defaultWorkingDirectory: codexScratchDirectory })],
  ]);
}

/**
 * codex 默认工作目录：数据库旁的专用空目录。
 *
 * 不使用项目目录，避免未经选择就把仓库内容暴露给上游。
 */
export function codexScratchDirectoryFor(databasePath: string): string {
  return databasePath === ":memory:"
    ? join(tmpdir(), "aom-codex-scratch")
    : join(dirname(databasePath), "codex-scratch");
}
