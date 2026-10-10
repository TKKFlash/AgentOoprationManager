import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const DATABASE_SCHEMA_VERSION = 1;

export interface AppDatabase {
  checkReady(): void;
  close(): void;
}

export function defaultDatabasePath(): string {
  const explicitPath = process.env.AOM_DATABASE_PATH;
  if (explicitPath) return explicitPath;
  const dataDir = process.env.AOM_DATA_DIR;
  if (dataDir) return resolve(dataDir, "agent-operations-manager.sqlite");
  const localAppData = process.env.LOCALAPPDATA;
  if (process.platform === "win32" && localAppData) {
    return resolve(localAppData, "AgentOperationsManager", "agent-operations-manager.sqlite");
  }
  const xdgData = process.env.XDG_DATA_HOME;
  if (xdgData) return resolve(xdgData, "agent-operations-manager", "agent-operations-manager.sqlite");
  return resolve(process.env.HOME ?? process.cwd(), ".local", "share", "agent-operations-manager", "agent-operations-manager.sqlite");
}

export function openDatabase(databasePath = defaultDatabasePath()): AppDatabase {
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  try {
    database.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
    if (databasePath !== ":memory:") database.exec("PRAGMA journal_mode = WAL;");
    database.exec("CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;");
    const read = database.prepare("SELECT value FROM app_meta WHERE key = ?");
    const write = database.prepare(`INSERT INTO app_meta (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`);

    database.exec("BEGIN IMMEDIATE;");
    try {
      const current = read.get("schema_version") as { value: string } | undefined;
      if (current && Number(current.value) !== DATABASE_SCHEMA_VERSION) {
        throw new Error(`Unsupported database schema version: ${current.value}`);
      }
      write.run("schema_version", String(DATABASE_SCHEMA_VERSION));
      write.run("last_started_at", new Date().toISOString());
      const version = read.get("schema_version") as { value: string } | undefined;
      const startedAt = read.get("last_started_at") as { value: string } | undefined;
      if (version?.value !== String(DATABASE_SCHEMA_VERSION) || !startedAt?.value) {
        throw new Error("SQLite read/write self-check failed");
      }
      database.exec("COMMIT;");
    } catch (error) {
      database.exec("ROLLBACK;");
      throw error;
    }

    return {
      checkReady() {
        database.prepare("SELECT 1").get();
        const version = database.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string } | undefined;
        if (version?.value !== String(DATABASE_SCHEMA_VERSION)) throw new Error("SQLite is not ready");
      },
      close: () => database.close(),
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
