import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { MockAgentAdapter } from "@aom/agent-adapters";
import { DEFAULT_BUDGET, type AgentProfile, type Task } from "@aom/shared";
import { openDatabase } from "../src/database.js";
import { Orchestrator } from "../src/orchestrator.js";
import { TaskRepository } from "../src/repository.js";
import { createDraftV2Database } from "./fixtures/draft-database.js";

// 回归测试：复现 2026-10-12 的故障。草稿库的 steps 表缺少 output_body，创建任务必定失败。
const PROFILES: AgentProfile[] = [
  { id: "analyst", name: "分析员", role: "拆解问题，独立给出分析与结论", adapterId: "mock", description: "" },
  { id: "reviewer", name: "复核员", role: "检查结论的依据、遗漏与风险", adapterId: "mock", description: "" },
];

async function waitForTerminal(repository: TaskRepository, taskId: string): Promise<Task> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const task = repository.getTask(taskId);
    if (task && ["completed", "cancelled", "failed"].includes(task.status)) return task;
    if (Date.now() > deadline) throw new Error("task did not finish in time");
    await delay(5);
  }
}

describe("task creation on a repaired v2 draft database", () => {
  it("creates a coordinator task and runs it to completion", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aom-draft-run-"));
    const path = join(dir, "draft.sqlite");
    createDraftV2Database(path);
    const database = openDatabase(path);
    const repository = new TaskRepository(database.raw);
    const orchestrator = new Orchestrator({
      repository,
      profiles: PROFILES,
      adapters: new Map([["mock", new MockAgentAdapter()]]),
    });
    try {
      const task = orchestrator.createTask({
        goal: "草稿库自检：比较两个方案",
        acceptanceCriteria: ["给出结论"],
        mode: "coordinator",
        participantIds: ["analyst", "reviewer"],
        budget: { ...DEFAULT_BUDGET },
      });
      const done = await waitForTerminal(repository, task.id);
      assert.equal(done.status, "completed");
      const snapshot = orchestrator.getSnapshot(task.id);
      assert.ok(snapshot);
      assert.equal(snapshot.steps.length, 3, "coordinator with one worker plans brief, dispatch and synthesis");
      assert.ok(snapshot.steps.every((step) => step.status === "succeeded"));
      assert.equal(snapshot.artifacts.length, 1);
    } finally {
      await orchestrator.shutdown();
      database.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
