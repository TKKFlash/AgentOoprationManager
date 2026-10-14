import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { DATABASE_SCHEMA_VERSION, defaultDatabasePath, openDatabase } from "../src/database.js";
import { createDraftV2Database } from "./fixtures/draft-database.js";

describe("SQLite foundation", () => {
  it("initializes schema metadata and passes a read/write readiness check", () => {
    const database = openDatabase(":memory:");
    assert.doesNotThrow(() => database.checkReady());
    assert.equal(DATABASE_SCHEMA_VERSION, 3);
    database.close();
  });

  it("creates the task, step, artifact and event tables", () => {
    const database = openDatabase(":memory:");
    const tables = database.raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => String(row.name));
    for (const name of ["artifacts", "events", "steps", "tasks"]) assert.ok(tables.includes(name), name);
    database.close();
  });

  it("upgrades a v1 database in place and keeps its metadata", () => {
    const dir = mkdtempSync(join(tmpdir(), "aom-upgrade-"));
    const path = join(dir, "v1.sqlite");
    try {
      const legacy = new DatabaseSync(path);
      legacy.exec("CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;");
      legacy.exec("INSERT INTO app_meta (key, value) VALUES ('schema_version', '1'), ('last_started_at', '2026-10-09T00:00:00.000Z');");
      legacy.close();

      const upgraded = openDatabase(path);
      try {
        upgraded.checkReady();
        const tables = upgraded.raw
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all()
          .map((row) => String(row.name));
        assert.ok(tables.includes("tasks") && tables.includes("steps") && tables.includes("events"));
        const startedAt = upgraded.raw.prepare("SELECT value FROM app_meta WHERE key = 'last_started_at'").get();
        assert.notEqual(startedAt?.value, "2026-10-09T00:00:00.000Z", "startup time should be refreshed");
      } finally {
        upgraded.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("repairs a v2 draft database whose steps table lacks output_body and note", () => {
    const dir = mkdtempSync(join(tmpdir(), "aom-draft-"));
    const path = join(dir, "draft.sqlite");
    try {
      createDraftV2Database(path);
      const repaired = openDatabase(path);
      try {
        const columns = repaired.raw.prepare("PRAGMA table_info(steps)").all().map((column) => String(column.name));
        assert.ok(columns.includes("output_body") && columns.includes("note"), "missing columns were added");
        assert.ok(columns.includes("output_summary"), "existing draft columns are kept");
        const indexes = repaired.raw.prepare("PRAGMA index_list(steps)").all();
        assert.equal(indexes.find((index) => index.name === "steps_task_ordinal")?.unique, 1, "ordinal index is unique");
        const version = repaired.raw.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get();
        assert.equal(version?.value, "3");
      } finally {
        repaired.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a database written by a newer build", () => {
    const dir = mkdtempSync(join(tmpdir(), "aom-future-"));
    const path = join(dir, "future.sqlite");
    try {
      const future = new DatabaseSync(path);
      future.exec("CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;");
      future.exec(`INSERT INTO app_meta (key, value) VALUES ('schema_version', '${DATABASE_SCHEMA_VERSION + 1}');`);
      future.close();
      assert.throws(() => openDatabase(path), /newer than this build supports/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("supports explicit per-user storage path configuration", () => {
    const previousDataDir = process.env.AOM_DATA_DIR;
    const previousDatabasePath = process.env.AOM_DATABASE_PATH;
    process.env.AOM_DATA_DIR = "C:\\private-data";
    delete process.env.AOM_DATABASE_PATH;
    assert.match(defaultDatabasePath(), /private-data[\\/]agent-operations-manager\.sqlite$/);
    if (previousDataDir === undefined) delete process.env.AOM_DATA_DIR;
    else process.env.AOM_DATA_DIR = previousDataDir;
    if (previousDatabasePath !== undefined) process.env.AOM_DATABASE_PATH = previousDatabasePath;
  });
});
