import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * 业务 schema 版本。
 *
 * v1：仅 app_meta（schema 版本与启动时间）。
 * v2：任务、步骤、产物与事件表（第 3、4 期）。
 */
export const DATABASE_SCHEMA_VERSION = 2;

export interface AppDatabase {
  checkReady(): void;
  close(): void;
  /** 仓库层使用的原始句柄；SQL 只应写在 repository 中。 */
  readonly raw: DatabaseSync;
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

/**
 * 迁移按版本号顺序执行。只做追加：不删除已有表或列，升级不丢失本机数据。
 */
const MIGRATIONS: readonly { version: number; apply: (database: DatabaseSync) => void }[] = [
  {
    version: 2,
    apply: (database) => {
      database.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          goal TEXT NOT NULL,
          acceptance_criteria TEXT NOT NULL,
          mode TEXT NOT NULL,
          status TEXT NOT NULL,
          participant_ids TEXT NOT NULL,
          budget_json TEXT NOT NULL,
          working_directory TEXT,
          config_snapshot_json TEXT NOT NULL,
          degraded INTEGER NOT NULL DEFAULT 0,
          stop_reason TEXT,
          calls_used INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;

        CREATE INDEX IF NOT EXISTS tasks_created ON tasks(created_at);

        CREATE TABLE IF NOT EXISTS steps (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          ordinal INTEGER NOT NULL,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          participant_id TEXT NOT NULL,
          status TEXT NOT NULL,
          input_summary TEXT NOT NULL,
          output_body TEXT,
          note TEXT,
          round INTEGER,
          started_at TEXT,
          finished_at TEXT,
          duration_ms INTEGER
        ) STRICT;
        CREATE UNIQUE INDEX IF NOT EXISTS steps_task_ordinal ON steps(task_id, ordinal);

        CREATE TABLE IF NOT EXISTS artifacts (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          step_id TEXT NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX IF NOT EXISTS artifacts_task ON artifacts(task_id);

        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          seq INTEGER NOT NULL,
          type TEXT NOT NULL,
          at TEXT NOT NULL,
          message TEXT NOT NULL,
          step_id TEXT,
          participant_id TEXT,
          detail_json TEXT
        ) STRICT;
        CREATE UNIQUE INDEX IF NOT EXISTS events_task_seq ON events(task_id, seq);
      `);
    },
  },
];

function migrate(database: DatabaseSync, fromVersion: number): void {
  for (const migration of MIGRATIONS) {
    if (migration.version > fromVersion) migration.apply(database);
  }
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
      const stored = read.get("schema_version") as { value: string } | undefined;
      const fromVersion = stored ? Number(stored.value) : 0;
      if (!Number.isInteger(fromVersion) || fromVersion < 0) {
        throw new Error(`Unsupported database schema version: ${stored?.value}`);
      }
      if (fromVersion > DATABASE_SCHEMA_VERSION) {
        throw new Error(`Database schema version ${fromVersion} is newer than this build supports (${DATABASE_SCHEMA_VERSION})`);
      }
      migrate(database, fromVersion);
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
      raw: database,
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
