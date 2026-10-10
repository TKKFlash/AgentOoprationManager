import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { resolve } from "node:path";

let child: ChildProcess;
let stderr = "";
let port: number;
const entry = resolve("dist/index.js");

async function waitForReady(): Promise<void> {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`server exited early: ${stderr}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await delay(100);
  }
  throw new Error(`server did not become ready: ${stderr}`);
}

before(async () => {
  const probeScript = "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})";
  const probe = spawn(process.execPath, ["-e", probeScript], { stdio: ["ignore", "pipe", "pipe"] });
  let probeOut = "";
  probe.stdout.setEncoding("utf8").on("data", (chunk: string) => { probeOut += chunk; });
  await new Promise<void>((resolveProbe, rejectProbe) => {
    probe.once("error", rejectProbe);
    probe.once("exit", (code) => code === 0 ? resolveProbe() : rejectProbe(new Error("port probe failed")));
  });
  port = Number(probeOut.trim());
  child = spawn(process.execPath, [entry], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), AOM_DATABASE_PATH: ":memory:", NODE_ENV: "production" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  await waitForReady();
});
after(async () => {
  if (child && child.exitCode === null && child.signalCode === null) child.kill();
});

describe("server process lifecycle", () => {
  it("starts on loopback and serves the health endpoint", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "ready");
  });
});
