import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app.js";

let app: Awaited<ReturnType<typeof buildApp>>;
let address: AddressInfo;
let baseUrl: string;

before(async () => {
  app = await buildApp({ databasePath: ":memory:", logger: false, development: false });
  await app.listen({ host: "127.0.0.1", port: 0 });
  address = app.server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});
after(async () => app.close());

describe("local service foundation", () => {
  it("binds only to loopback and reports SQLite readiness", async () => {
    assert.equal(address.address, "127.0.0.1");
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"), true);
    assert.deepEqual(await response.json(), {
      status: "ready", service: "agent-operations-manager", storage: "sqlite", storageStatus: "ready", schemaVersion: 1,
    });
  });
  it("rejects non-loopback host headers", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health", headers: { host: `localhost:${address.port}` } });
    assert.equal(response.statusCode, 421);
  });
  it("rejects state changes with foreign or missing origin", async () => {
    const foreign = await fetch(`${baseUrl}/api/health`, { method: "POST", headers: { origin: "https://example.invalid" } });
    const missing = await fetch(`${baseUrl}/api/health`, { method: "POST" });
    assert.equal(foreign.status, 403);
    assert.equal(missing.status, 403);
  });
  it("serves the built-in local page when the production bundle exists", async () => {
    const response = await fetch(baseUrl);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Agent Operations Manager/);
  });
});
