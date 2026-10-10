import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { MockAgentAdapter } from "@aom/agent-adapters";
import {
  DEFAULT_BUDGET,
  type AdapterInvokeResult,
  type AgentAdapter,
  type AgentProfile,
  type HandoffPacket,
  type Task,
  type TaskEvent,
} from "@aom/shared";
import { openDatabase } from "../src/database.js";
import {
  EXCERPT_LIMIT,
  Orchestrator,
  TaskStateError,
  classifyCall,
  excerpt,
  parseAssignments,
  planSteps,
  type NewTask,
} from "../src/orchestrator.js";
import { TaskRepository } from "../src/repository.js";

const PROFILES: AgentProfile[] = [
  { id: "analyst", name: "分析员", role: "拆解问题，独立给出分析与结论", adapterId: "mock", description: "" },
  { id: "reviewer", name: "复核员", role: "检查结论的依据、遗漏与风险", adapterId: "mock", description: "" },
  { id: "summarizer", name: "整理员", role: "归纳要点，形成结构化结论", adapterId: "mock", description: "" },
];

const TERMINAL = new Set(["completed", "cancelled", "failed"]);

async function until<T>(probe: () => T | undefined, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("condition was not met in time");
    await delay(5);
  }
}

function waitForTerminal(repository: TaskRepository, taskId: string): Promise<Task> {
  return until(() => {
    const task = repository.getTask(taskId);
    return task && TERMINAL.has(task.status) ? task : undefined;
  });
}

function harness(adapter: AgentAdapter) {
  const database = openDatabase(":memory:");
  const repository = new TaskRepository(database.raw);
  const orchestrator = new Orchestrator({ repository, profiles: PROFILES, adapters: new Map([["mock", adapter]]) });
  return { repository, orchestrator, close: () => database.close() };
}

function newTask(overrides: Partial<NewTask> = {}): NewTask {
  return {
    goal: "评估方案 A 与方案 B 的风险",
    acceptanceCriteria: ["给出明确结论", "列出依据"],
    mode: "coordinator",
    participantIds: ["analyst", "reviewer", "summarizer"],
    budget: { ...DEFAULT_BUDGET },
    ...overrides,
  };
}

function assertSequential(events: readonly TaskEvent[]): void {
  events.forEach((event, index) => assert.equal(event.seq, index + 1));
}

describe("orchestrator: coordinator mode", () => {
  it("runs assignments, synthesizes one artifact, and keeps workers isolated", async () => {
    const packets: HandoffPacket[] = [];
    const adapter = new MockAgentAdapter({
      renderOutput: (request) => {
        packets.push(request.packet);
        if (request.packet.assignment.startsWith("将任务目标拆解")) {
          return "- 复核员：检查方案风险\n- 整理员：归纳成本差异";
        }
        if (request.packet.assignment.startsWith("综合以下参与者")) return "最终结论：优先方案 A";
        return `${request.packet.participantRole} 的独立分析`;
      },
    });
    const h = harness(adapter);
    try {
      const task = h.orchestrator.createTask(newTask());
      const done = await waitForTerminal(h.repository, task.id);
      assert.equal(done.status, "completed");
      assert.equal(done.degraded, false);
      assert.equal(done.callsUsed, 4);

      const snapshot = h.orchestrator.getSnapshot(task.id)!;
      assert.deepEqual(snapshot.steps.map((step) => step.kind), ["brief", "dispatch", "dispatch", "synthesize"]);
      assert.ok(snapshot.steps.every((step) => step.status === "succeeded"));
      assert.equal(snapshot.steps[1].inputSummary, "检查方案风险");
      assert.equal(snapshot.steps[2].inputSummary, "归纳成本差异");
      assert.equal(snapshot.artifacts.length, 1);
      assert.equal(snapshot.artifacts[0].body, "最终结论：优先方案 A");
      assert.equal(snapshot.participants.length, 3);
      assert.equal(snapshot.events.at(-1)?.type, "task.completed");
      assertSequential(snapshot.events);

      // 工作参与者互不可见彼此的发言。
      const [, reviewerPacket, summarizerPacket, synthesisPacket] = packets;
      assert.equal(reviewerPacket.digest.length, 0);
      assert.equal(summarizerPacket.digest.length, 0);
      // 综合时只获得两位工作参与者的摘录，不含协调者自己的分工输出。
      assert.deepEqual(synthesisPacket.digest.map((entry) => entry.participantName), ["复核员", "整理员"]);

      assert.throws(() => h.orchestrator.pause(task.id), TaskStateError);
    } finally {
      await h.orchestrator.shutdown();
      h.close();
    }
  });

  it("falls back to default assignments when the brief cannot be parsed", async () => {
    const adapter = new MockAgentAdapter({
      renderOutput: (request) => (request.packet.assignment.startsWith("将任务目标拆解")
        ? "我无法拆解这个任务"
        : `${request.packet.participantRole} 的结论`),
    });
    const h = harness(adapter);
    try {
      const task = h.orchestrator.createTask(newTask());
      const done = await waitForTerminal(h.repository, task.id);
      assert.equal(done.status, "completed");
      const snapshot = h.orchestrator.getSnapshot(task.id)!;
      assert.match(snapshot.steps[1].inputSummary, /检查结论的依据/);
      assert.ok(snapshot.events.some((event) => event.type === "plan.adjusted" && event.message.includes("默认分工")));
    } finally {
      await h.orchestrator.shutdown();
      h.close();
    }
  });

  it("skips dispatches that would consume the reserved synthesis call", async () => {
    const adapter = new MockAgentAdapter();
    const h = harness(adapter);
    try {
      const task = h.orchestrator.createTask(newTask({ budget: { ...DEFAULT_BUDGET, maxTotalCalls: 3 } }));
      const done = await waitForTerminal(h.repository, task.id);
      assert.equal(done.status, "completed");
      assert.equal(done.degraded, true);
      assert.equal(done.callsUsed, 3);
      assert.equal(adapter.callCount, 3);
      const snapshot = h.orchestrator.getSnapshot(task.id)!;
      assert.deepEqual(snapshot.steps.map((step) => step.status), ["succeeded", "succeeded", "skipped", "succeeded"]);
      assert.equal(snapshot.events.filter((event) => event.type === "budget.exhausted").length, 1);
      assertSequential(snapshot.events);
    } finally {
      await h.orchestrator.shutdown();
      h.close();
    }
  });

  it("records a failed worker and keeps the task running", async () => {
    const adapter = new MockAgentAdapter({
      failOnCall: (index) => (index === 1 ? { kind: "failed", message: "模拟失败" } : null),
    });
    const h = harness(adapter);
    try {
      const task = h.orchestrator.createTask(newTask());
      const done = await waitForTerminal(h.repository, task.id);
      assert.equal(done.status, "completed");
      assert.equal(done.degraded, true);
      const snapshot = h.orchestrator.getSnapshot(task.id)!;
      assert.deepEqual(snapshot.steps.map((step) => step.status), ["succeeded", "failed", "succeeded", "succeeded"]);
      assert.equal(snapshot.steps[1].note, "模拟失败");
      assert.ok(snapshot.events.some((event) => event.type === "step.failed" && event.message.includes("模拟失败")));
    } finally {
      await h.orchestrator.shutdown();
      h.close();
    }
  });

  it("times out a slow call without blocking later steps", async () => {
    const adapter = new MockAgentAdapter({ latencyMs: (index) => (index === 1 ? 500 : 0) });
    const h = harness(adapter);
    try {
      const task = h.orchestrator.createTask(newTask({ budget: { ...DEFAULT_BUDGET, perCallTimeoutMs: 50 } }));
      const done = await waitForTerminal(h.repository, task.id);
      assert.equal(done.status, "completed");
      assert.equal(done.degraded, true);
      const snapshot = h.orchestrator.getSnapshot(task.id)!;
      assert.deepEqual(snapshot.steps.map((step) => step.status), ["succeeded", "timed_out", "succeeded", "succeeded"]);
      assert.match(snapshot.steps[1].note ?? "", /未完成/);
    } finally {
      await h.orchestrator.shutdown();
      h.close();
    }
  });

  it("cancels the in-flight call and marks the remaining steps cancelled", async () => {
    const adapter = new MockAgentAdapter({ latencyMs: 2_000 });
    const h = harness(adapter);
    try {
      const task = h.orchestrator.createTask(newTask());
      await until(() => (adapter.callCount >= 1 ? true : undefined));
      const requestedAt = Date.now();
      h.orchestrator.cancel(task.id);
      const done = await waitForTerminal(h.repository, task.id);
      assert.ok(Date.now() - requestedAt < 1_000, "cancellation should take effect promptly");
      assert.equal(done.status, "cancelled");
      assert.equal(done.stopReason, "用户取消");
      assert.equal(adapter.callCount, 1);
      const snapshot = h.orchestrator.getSnapshot(task.id)!;
      assert.deepEqual(snapshot.steps.map((step) => step.status), ["cancelled", "cancelled", "cancelled", "cancelled"]);
      assertSequential(snapshot.events);
    } finally {
      await h.orchestrator.shutdown();
      h.close();
    }
  });

  it("marks in-flight work failed when the service stops", async () => {
    const adapter = new MockAgentAdapter({ latencyMs: 2_000 });
    const h = harness(adapter);
    const task = h.orchestrator.createTask(newTask());
    await until(() => (adapter.callCount >= 1 ? true : undefined));
    await h.orchestrator.shutdown();
    const done = h.repository.getTask(task.id)!;
    assert.equal(done.status, "failed");
    assert.equal(done.stopReason, "服务停止，任务未完成");
    h.close();
  });

  it("treats unexpected adapter exceptions as failed steps without leaking their message", async () => {
    class ThrowingAdapter extends MockAgentAdapter {
      override async invoke(): Promise<AdapterInvokeResult> {
        throw new TypeError("boom");
      }
    }
    const h = harness(new ThrowingAdapter());
    try {
      const task = h.orchestrator.createTask(newTask());
      const done = await waitForTerminal(h.repository, task.id);
      assert.equal(done.status, "failed");
      assert.equal(done.stopReason, "没有产生最终结论");
      const snapshot = h.orchestrator.getSnapshot(task.id)!;
      assert.equal(snapshot.steps[0].note, "内部错误，调用未完成");
      assert.ok(!snapshot.events.some((event) => event.message.includes("boom")));
    } finally {
      await h.orchestrator.shutdown();
      h.close();
    }
  });
});

describe("orchestrator: discussion mode", () => {
  it("shares only bounded excerpts between rounds and converges once", async () => {
    const packets: HandoffPacket[] = [];
    const adapter = new MockAgentAdapter({
      renderOutput: (request) => {
        packets.push(request.packet);
        return request.packet.assignment.startsWith("综合各参与者") ? "收敛结论" : "x".repeat(2_000);
      },
    });
    const h = harness(adapter);
    try {
      const task = h.orchestrator.createTask(newTask({
        mode: "discussion",
        participantIds: ["analyst", "reviewer"],
        budget: { ...DEFAULT_BUDGET, maxRounds: 2 },
      }));
      const done = await waitForTerminal(h.repository, task.id);
      assert.equal(done.status, "completed");
      assert.equal(done.callsUsed, 5);
      const snapshot = h.orchestrator.getSnapshot(task.id)!;
      assert.deepEqual(snapshot.steps.map((step) => step.title), [
        "第 1 轮 · 分析员", "第 1 轮 · 复核员", "第 2 轮 · 分析员", "第 2 轮 · 复核员", "收敛结论",
      ]);
      assert.equal(snapshot.artifacts[0].body, "收敛结论");

      const [first, second, third, fourth, converge] = packets;
      assert.equal(first.digest.length, 0);
      assert.equal(second.digest.length, 1);
      assert.equal(second.digest[0].participantName, "分析员");
      assert.ok(second.digest[0].excerpt.length <= EXCERPT_LIMIT + 1, "excerpts must be truncated");
      assert.equal(third.round, 2);
      assert.equal(third.digest.length, 1, "a speaker sees only the other participant's latest excerpt");
      assert.equal(fourth.digest[0].participantName, "分析员");
      assert.equal(converge.digest.length, 2);
      assertSequential(snapshot.events);
    } finally {
      await h.orchestrator.shutdown();
      h.close();
    }
  });

  it("stops at the budget and still converges with what it has", async () => {
    const adapter = new MockAgentAdapter();
    const h = harness(adapter);
    try {
      const task = h.orchestrator.createTask(newTask({
        mode: "discussion",
        participantIds: ["analyst", "reviewer"],
        budget: { ...DEFAULT_BUDGET, maxTotalCalls: 3, maxRounds: 3 },
      }));
      const done = await waitForTerminal(h.repository, task.id);
      assert.equal(done.status, "completed");
      assert.equal(done.degraded, true);
      assert.equal(done.callsUsed, 3);
      const snapshot = h.orchestrator.getSnapshot(task.id)!;
      assert.deepEqual(snapshot.steps.map((step) => step.status), [
        "succeeded", "succeeded", "skipped", "skipped", "skipped", "skipped", "succeeded",
      ]);
      assert.equal(snapshot.events.filter((event) => event.type === "budget.exhausted").length, 1);
    } finally {
      await h.orchestrator.shutdown();
      h.close();
    }
  });

  it("pauses at the next step boundary and resumes to completion", async () => {
    const adapter = new MockAgentAdapter({ latencyMs: 80 });
    const h = harness(adapter);
    try {
      const task = h.orchestrator.createTask(newTask({
        mode: "discussion",
        participantIds: ["analyst", "reviewer"],
        budget: { ...DEFAULT_BUDGET, maxRounds: 2 },
      }));
      await until(() => (adapter.callCount >= 1 ? true : undefined));
      h.orchestrator.pause(task.id);
      await delay(300);
      const frozen = adapter.callCount;
      await delay(200);
      assert.equal(adapter.callCount, frozen, "no new calls may start while paused");
      assert.equal(h.repository.getTask(task.id)?.status, "paused");

      h.orchestrator.resume(task.id);
      const done = await waitForTerminal(h.repository, task.id);
      assert.equal(done.status, "completed");
      assert.equal(adapter.callCount, 5);
      const snapshot = h.orchestrator.getSnapshot(task.id)!;
      assert.ok(snapshot.events.some((event) => event.type === "task.paused"));
      assert.ok(snapshot.events.some((event) => event.type === "task.resumed"));
      assertSequential(snapshot.events);
    } finally {
      await h.orchestrator.shutdown();
      h.close();
    }
  });
  it("cancels a paused run without starting any new call", async () => {
    const adapter = new MockAgentAdapter({ latencyMs: 80 });
    const h = harness(adapter);
    try {
      const task = h.orchestrator.createTask(newTask({
        mode: "discussion",
        participantIds: ["analyst", "reviewer"],
        budget: { ...DEFAULT_BUDGET, maxRounds: 2 },
      }));
      await until(() => (adapter.callCount >= 1 ? true : undefined));
      h.orchestrator.pause(task.id);
      await delay(200);
      const frozen = adapter.callCount;
      h.orchestrator.cancel(task.id);
      const done = await waitForTerminal(h.repository, task.id);
      assert.equal(done.status, "cancelled");
      assert.equal(adapter.callCount, frozen, "cancelling must not start a new call");
      const snapshot = h.orchestrator.getSnapshot(task.id)!;
      assert.ok(snapshot.steps.every((step) => step.status === "succeeded" || step.status === "cancelled"));
    } finally {
      await h.orchestrator.shutdown();
      h.close();
    }
  });
});

describe("orchestrator: recovery", () => {
  it("marks tasks interrupted by a restart as failed after reopening the database", () => {
    const dir = mkdtempSync(join(tmpdir(), "aom-recovery-"));
    const databasePath = join(dir, "recovery.sqlite");
    try {
      const first = openDatabase(databasePath);
      const writer = new TaskRepository(first.raw);
      const taskId = "task-interrupted";
      writer.createTask({
        id: taskId,
        goal: "中断的任务",
        acceptanceCriteria: [],
        mode: "coordinator",
        status: "running",
        participantIds: ["analyst", "reviewer"],
        budget: { ...DEFAULT_BUDGET },
        configSnapshot: {},
        degraded: false,
        callsUsed: 1,
        createdAt: "2026-10-10T00:00:00.000Z",
        updatedAt: "2026-10-10T00:00:00.000Z",
      });
      writer.createStep({
        id: "step-running", taskId, ordinal: 0, kind: "brief", title: "拆解分工", participantId: "analyst",
        status: "running", inputSummary: "", startedAt: "2026-10-10T00:00:01.000Z",
      });
      writer.createStep({
        id: "step-pending", taskId, ordinal: 1, kind: "synthesize", title: "综合结论", participantId: "analyst",
        status: "pending", inputSummary: "",
      });
      first.close();

      const second = openDatabase(databasePath);
      try {
        const orchestrator = new Orchestrator({
          repository: new TaskRepository(second.raw),
          profiles: PROFILES,
          adapters: new Map(),
        });
        assert.equal(orchestrator.recoverInterrupted(), 1);
        const snapshot = orchestrator.getSnapshot(taskId)!;
        assert.equal(snapshot.task.status, "failed");
        assert.equal(snapshot.task.stopReason, "服务重启导致任务中断");
        assert.deepEqual(snapshot.steps.map((step) => step.status), ["failed", "skipped"]);
        assert.equal(orchestrator.recoverInterrupted(), 0, "recovery must be idempotent");
      } finally {
        second.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("engine helpers", () => {
  it("plans coordinator and discussion steps", () => {
    const coordinator = planSteps("coordinator", PROFILES, 3);
    assert.deepEqual(coordinator.map((step) => step.kind), ["brief", "dispatch", "dispatch", "synthesize"]);
    const discussion = planSteps("discussion", PROFILES.slice(0, 2), 2);
    assert.deepEqual(discussion.map((step) => step.round), [1, 1, 2, 2, undefined]);
    assert.equal(discussion.at(-1)?.kind, "converge");
  });

  it("parses assignment lines and ignores names outside the worker list", () => {
    const workers = PROFILES.slice(1);
    const assignments = parseAssignments(
      "- 复核员：检查依据\n* 整理员: 归纳要点\n- 陌生人：不应匹配\n- 复核员：第二行不应覆盖",
      workers,
    );
    assert.equal(assignments.get("reviewer"), "检查依据");
    assert.equal(assignments.get("summarizer"), "归纳要点");
    assert.equal(assignments.size, 2);
  });

  it("truncates long excerpts with an ellipsis", () => {
    assert.equal(excerpt("  短文本  "), "短文本");
    const long = excerpt("y".repeat(EXCERPT_LIMIT + 50));
    assert.equal(long.length, EXCERPT_LIMIT + 1);
    assert.ok(long.endsWith("…"));
  });

  it("classifies call outcomes by cause", () => {
    assert.equal(
      classifyCall({ settled: { ok: true, result: { output: "  好  " } }, timedOut: false, stopped: false, stopReason: null, timeoutSeconds: 1 }).status,
      "succeeded",
    );
    assert.deepEqual(
      classifyCall({ settled: { ok: true, result: { output: "   " } }, timedOut: false, stopped: false, stopReason: null, timeoutSeconds: 1 }),
      { status: "failed", note: "上游返回内容为空" },
    );
    assert.equal(
      classifyCall({ settled: { ok: false, error: new Error("x") }, timedOut: true, stopped: false, stopReason: null, timeoutSeconds: 30 }).status,
      "timed_out",
    );
    assert.equal(
      classifyCall({ settled: { ok: false, error: new Error("x") }, timedOut: false, stopped: true, stopReason: "user", timeoutSeconds: 30 }).status,
      "cancelled",
    );
    assert.equal(
      classifyCall({ settled: { ok: false, error: new Error("x") }, timedOut: false, stopped: true, stopReason: "shutdown", timeoutSeconds: 30 }).status,
      "failed",
    );
  });
});
