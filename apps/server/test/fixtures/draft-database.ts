import { DatabaseSync } from "node:sqlite";

/**
 * 复刻开发期 v2 草稿在本机建出的数据库（仅供测试）。
 *
 * 草稿的 steps 表缺少 output_body、note，保留了 output_summary、error_message 两列，
 * steps_task_ordinal 为普通索引，tasks 上没有 tasks_created 索引；
 * artifacts 没有指向 steps 的外键。v3 迁移应补齐前两项，其余差异保持不变。
 */
export function createDraftV2Database(path: string): void {
  const draft = new DatabaseSync(path);
  try {
    draft.exec(`
      CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      INSERT INTO app_meta (key, value) VALUES ('schema_version', '2'), ('last_started_at', '2026-10-10T00:00:00.000Z');
      CREATE TABLE tasks (
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
      CREATE TABLE steps (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        participant_id TEXT,
        status TEXT NOT NULL,
        input_summary TEXT NOT NULL,
        output_summary TEXT,
        round INTEGER,
        error_message TEXT,
        started_at TEXT,
        finished_at TEXT,
        duration_ms INTEGER
      ) STRICT;
      CREATE INDEX steps_task_ordinal ON steps(task_id, ordinal);
      CREATE TABLE artifacts (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        step_id TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX artifacts_task ON artifacts(task_id);
      CREATE TABLE events (
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
      CREATE UNIQUE INDEX events_task_seq ON events(task_id, seq);
    `);
  } finally {
    draft.close();
  }
}
