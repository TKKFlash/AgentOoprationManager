import assert from "node:assert/strict";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let origin: string;

interface Response {
  status: number;
  // 测试中按需取字段，不在此做结构校验。
  json: any;
}

function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const port = (app.server.address() as AddressInfo).port;
    const req = request({
      host: "127.0.0.1",
      port,
      method,
      path,
      headers: {
        ...(payload === undefined ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }),
        ...headers,
      },
    }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { data += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, json: data ? JSON.parse(data) : undefined }));
    });
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function validBody(): Record<string, unknown> {
  return {
    goal: "比较两个方案的风险",
    acceptanceCriteria: ["给出结论"],
    mode: "coordinator",
    participantIds: ["analyst", "reviewer", "summarizer"],
  };
}

async function pollUntilTerminal(id: string): Promise<any> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const response = await call("GET", `/api/tasks/${id}`);
    if (["completed", "cancelled", "failed"].includes(response.json.task.status)) return response.json;
    if (Date.now() > deadline) throw new Error("task did not reach a terminal state");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

before(async () => {
  app = await buildApp({ databasePath: ":memory:", logger: false, development: false });
  await app.listen({ host: "127.0.0.1", port: 0 });
  origin = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
after(async () => app.close());

describe("task API", () => {
  it("lists profiles, modes and budget limits", async () => {
    const response = await call("GET", "/api/profiles");
    assert.equal(response.status, 200);
    assert.ok(response.json.profiles.some((profile: { id: string }) => profile.id === "codex-readonly"));
    assert.deepEqual(response.json.modes.map((mode: { id: string }) => mode.id), ["coordinator", "discussion"]);
    assert.equal(response.json.budget.limits.maxTotalCalls.min, 3);
  });

  it("rejects state changes from a foreign origin", async () => {
    const response = await call("POST", "/api/tasks", validBody(), { origin: "https://example.invalid" });
    assert.equal(response.status, 403);
  });

  it("rejects invalid task requests with user-facing messages", async () => {
    const cases: [string, Record<string, unknown>, RegExp][] = [
      ["blank goal", { ...validBody(), goal: "   " }, /请填写任务目标/],
      ["overlong goal", { ...validBody(), goal: "x".repeat(4_001) }, /不能超过 4000/],
      ["unknown mode", { ...validBody(), mode: "mesh" }, /协作模式无效/],
      ["single participant", { ...validBody(), participantIds: ["analyst"] }, /请选择 2 到 6 位参与者/],
      ["duplicate participant", { ...validBody(), participantIds: ["analyst", "analyst"] }, /不能重复选择/],
      ["unknown participant", { ...validBody(), participantIds: ["analyst", "ghost"] }, /未知的参与者/],
      ["budget below floor", { ...validBody(), budget: { maxTotalCalls: 2 } }, /调用次数上限需为 3 到 50/],
      ["too many criteria", { ...validBody(), acceptanceCriteria: Array.from({ length: 13 }, (_, i) => `条目${i}`) }, /最多 12 条/],
      ["relative directory", { ...validBody(), workingDirectory: "relative/path" }, /绝对路径/],
      ["missing directory", { ...validBody(), workingDirectory: join(tmpdir(), "definitely-missing-aom-dir") }, /不存在/],
    ];
    for (const [label, body, message] of cases) {
      const response = await call("POST", "/api/tasks", body, { origin });
      assert.equal(response.status, 400, label);
      assert.match(response.json.error, message, label);
    }
  });

  it("creates a task, reaches a terminal state, and serves incremental events", async () => {
    const created = await call("POST", "/api/tasks", validBody(), { origin });
    assert.equal(created.status, 201);
    const finished = await pollUntilTerminal(created.json.id);
    assert.equal(finished.task.status, "completed");
    assert.equal(finished.steps.length, 4);
    assert.equal(finished.artifacts.length, 1);
    assert.equal(finished.participants.length, 3);

    const lastSeq = finished.events.at(-1).seq;
    const tail = await call("GET", `/api/tasks/${created.json.id}?afterSeq=${lastSeq - 2}`);
    assert.deepEqual(tail.json.events.map((event: { seq: number }) => event.seq), [lastSeq - 1, lastSeq]);
    const none = await call("GET", `/api/tasks/${created.json.id}?afterSeq=${lastSeq}`);
    assert.equal(none.json.events.length, 0);

    const list = await call("GET", "/api/tasks");
    assert.ok(list.json.tasks.some((task: { id: string; stepCount: number; completedStepCount: number }) =>
      task.id === created.json.id && task.stepCount === 4 && task.completedStepCount === 4));
  });

  it("accepts an absolute existing working directory", async () => {
    const response = await call("POST", "/api/tasks", { ...validBody(), workingDirectory: tmpdir() }, { origin });
    assert.equal(response.status, 201);
    await pollUntilTerminal(response.json.id);
  });

  it("answers unknown tasks and invalid transitions with the right status codes", async () => {
    assert.equal((await call("GET", "/api/tasks/missing")).status, 404);
    assert.equal((await call("POST", "/api/tasks/missing/cancel", undefined, { origin })).status, 404);

    const created = await call("POST", "/api/tasks", validBody(), { origin });
    await pollUntilTerminal(created.json.id);
    assert.equal((await call("POST", `/api/tasks/${created.json.id}/pause`, undefined, { origin })).status, 409);
    assert.equal((await call("POST", `/api/tasks/${created.json.id}/cancel`, undefined, { origin })).status, 409);
    assert.equal((await call("GET", `/api/tasks/${created.json.id}?afterSeq=-1`)).status, 400);
  });
});
