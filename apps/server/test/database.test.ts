import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DATABASE_SCHEMA_VERSION, defaultDatabasePath, openDatabase } from "../src/database.js";

describe("SQLite foundation", () => {
  it("initializes schema metadata and passes a read/write readiness check", () => {
    const database = openDatabase(":memory:");
    assert.doesNotThrow(() => database.checkReady());
    assert.equal(DATABASE_SCHEMA_VERSION, 1);
    database.close();
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
