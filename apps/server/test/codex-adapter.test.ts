import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CodexCliAgentAdapter, buildPrompt, extractAgentMessage, parseCodexJsonl } from "@aom/agent-adapters";
import { AdapterError, type AdapterInvokeRequest, type HandoffPacket } from "@aom/shared";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// 用替身脚本代替真实 codex：验证 stdin、JSONL 投影、取消与退出码路径，不调用任何模型。
const FAKE_CODEX = fileURLToPath(new URL("./fixtures/fake-codex.mjs", import.meta.url));

function packetWith(assignment: string): HandoffPacket {
  return {
    taskGoal: "评估方案风险",
    assignment,
    participantRole: "复核员",
    constraints: ["仅基于本简报作答"],
    confirmedFacts: [],
    evidence: [],
    digest: [],
    deliverableFormat: "分点列出",
  };
}

function adapterWithStub(): CodexCliAgentAdapter {
  return new CodexCliAgentAdapter({
    executable: process.execPath,
    launcherArgs: [FAKE_CODEX],
    defaultWorkingDirectory: tmpdir(),
  });
}

function invocation(assignment: string, signal = new AbortController().signal): AdapterInvokeRequest {
  return { packet: packetWith(assignment), signal };
}

describe("codex-cli adapter against a stub upstream", () => {
  it("returns only the agent message, never tool output", async () => {
    const result = await adapterWithStub().invoke(invocation("检查方案 A"));
    assert.ok(result.output.startsWith("FAKE:"));
    assert.ok(!result.output.includes("TOOL OUTPUT"));
    assert.equal(result.upstreamEventCount, 6);
    assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 3 });
  });

  it("reports a non-zero exit as a failure with the exit code only", async () => {
    await assert.rejects(adapterWithStub().invoke(invocation("FAIL")), (error: unknown) => {
      assert.ok(error instanceof AdapterError);
      assert.equal(error.kind, "failed");
      assert.match(error.message, /退出码 2/);
      return true;
    });
  });

  it("terminates the child and rejects as cancelled when the signal aborts", async () => {
    const controller = new AbortController();
    const startedAt = Date.now();
    const pending = adapterWithStub().invoke(invocation("SLEEP", controller.signal));
    setTimeout(() => controller.abort(), 300);
    await assert.rejects(pending, (error: unknown) => {
      assert.ok(error instanceof AdapterError);
      assert.equal(error.kind, "cancelled");
      return true;
    });
    assert.ok(Date.now() - startedAt < 5_000, "the child must not run to completion");
  });

  it("refuses to start without a working directory", async () => {
    const bare = new CodexCliAgentAdapter({ executable: process.execPath, launcherArgs: [FAKE_CODEX] });
    await assert.rejects(
      bare.invoke(invocation("检查")),
      (error: unknown) => error instanceof AdapterError && error.kind === "failed",
    );
  });

  it("builds the prompt from the packet alone", () => {
    const prompt = buildPrompt({
      ...packetWith("检查方案 A"),
      digest: [{ participantName: "分析员", round: 1, excerpt: "结论 X" }],
    });
    assert.match(prompt, /任务目标：评估方案风险/);
    assert.match(prompt, /- 分析员（第 1 轮）：结论 X/);
    assert.match(prompt, /不要修改任何文件/);
    assert.ok(!/历史|会话/.test(prompt));
  });
});

describe("codex JSONL projection", () => {
  it("skips malformed lines and keeps well-formed events", () => {
    const events = parseCodexJsonl([
      '{"type":"thread.started","thread_id":"t"}',
      "not json at all",
      '{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}',
      "",
    ].join("\n"));
    assert.equal(events.length, 2);
    assert.equal(extractAgentMessage(events), "ok");
  });

  it("joins agent messages in order and ignores command output", () => {
    const events = parseCodexJsonl([
      '{"type":"item.completed","item":{"type":"command_execution","aggregated_output":"SECRET LISTING"}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"第一段"}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"第二段"}}',
    ].join("\n"));
    assert.equal(extractAgentMessage(events), "第一段\n\n第二段");
  });
});
