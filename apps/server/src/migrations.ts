import type { DatabaseSync } from "node:sqlite";

interface Migration {
  version: number;
  name: string;
  sql: string;
}

const migrations: Migration[] = [
  {
    version: 1,
    name: "initial_control_plane_schema",
    sql: `
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        default_repo_url TEXT,
        default_workspace_root TEXT,
        default_cwd TEXT,
        default_branch TEXT,
        default_codex_options_json TEXT CHECK (
          default_codex_options_json IS NULL OR json_valid(default_codex_options_json)
        ),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        source_type TEXT NOT NULL CHECK (source_type IN ('git', 'local')),
        repo_url TEXT,
        path TEXT NOT NULL,
        cwd TEXT NOT NULL,
        branch TEXT,
        commit_sha TEXT,
        status TEXT NOT NULL CHECK (status IN ('creating', 'ready', 'error', 'archived', 'deleted')),
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX idx_workspaces_project_id ON workspaces(project_id);
      CREATE INDEX idx_workspaces_status ON workspaces(status);

      CREATE TABLE worker_sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (
          status IN ('starting', 'running', 'awaiting_input', 'completed', 'failed', 'stopped')
        ),
        codex_thread_id TEXT,
        codex_turn_id TEXT,
        codex_session_key TEXT,
        process_pid TEXT,
        last_agent_message_item_id TEXT,
        last_agent_message TEXT,
        last_agent_message_at TEXT,
        last_item_sequence INTEGER NOT NULL DEFAULT 0,
        failure_reason TEXT,
        started_at TEXT,
        ended_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX idx_worker_sessions_project_id ON worker_sessions(project_id);
      CREATE INDEX idx_worker_sessions_workspace_id ON worker_sessions(workspace_id);
      CREATE INDEX idx_worker_sessions_status ON worker_sessions(status);

      CREATE TABLE items (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES worker_sessions(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL CHECK (
          type IN ('agentmessage', 'toolcall', 'toolresult', 'error', 'state', 'reasoning', 'raw')
        ),
        codex_method TEXT,
        codex_item_id TEXT,
        codex_item_type TEXT,
        created_at TEXT NOT NULL,
        raw_payload_json TEXT NOT NULL CHECK (json_valid(raw_payload_json)),
        text_excerpt TEXT,
        UNIQUE (session_id, sequence)
      ) STRICT;

      CREATE INDEX idx_items_session_id_sequence ON items(session_id, sequence);
      CREATE INDEX idx_items_session_id_type_sequence ON items(session_id, type, sequence);
      CREATE INDEX idx_items_codex_item_id ON items(codex_item_id);

      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES worker_sessions(id) ON DELETE CASCADE,
        mode TEXT NOT NULL CHECK (mode IN ('initial', 'steer', 'continue')),
        content TEXT NOT NULL,
        sender_type TEXT NOT NULL CHECK (sender_type IN ('manager_agent', 'human', 'system')),
        sender_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'failed')),
        codex_request_id TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        sent_at TEXT
      ) STRICT;

      CREATE INDEX idx_messages_session_id_created_at ON messages(session_id, created_at, id);
      CREATE INDEX idx_messages_status ON messages(status);
    `,
  },
  {
    version: 2,
    name: "review_gate_status",
    sql: `
      CREATE TABLE review_gate_statuses (
        session_id TEXT PRIMARY KEY REFERENCES worker_sessions(id) ON DELETE CASCADE,
        implementation_done INTEGER NOT NULL DEFAULT 0 CHECK (implementation_done IN (0, 1)),
        self_validation_done INTEGER NOT NULL DEFAULT 0 CHECK (self_validation_done IN (0, 1)),
        review_requested INTEGER NOT NULL DEFAULT 0 CHECK (review_requested IN (0, 1)),
        review_addressed INTEGER NOT NULL DEFAULT 0 CHECK (review_addressed IN (0, 1)),
        ready_for_human_review INTEGER NOT NULL DEFAULT 0 CHECK (ready_for_human_review IN (0, 1)),
        note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
    `,
  },
  {
    version: 3,
    name: "session_task_specs",
    sql: `
      CREATE TABLE session_task_specs (
        session_id TEXT PRIMARY KEY REFERENCES worker_sessions(id) ON DELETE CASCADE,
        ref TEXT,
        title TEXT,
        intent TEXT,
        scope TEXT,
        acceptance_criteria TEXT,
        raw TEXT,
        created_at TEXT NOT NULL
      ) STRICT;
    `,
  },
  {
    version: 4,
    name: "run_groups",
    sql: `
      CREATE TABLE run_groups (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        purpose TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX idx_run_groups_project_id ON run_groups(project_id);

      CREATE TABLE run_group_sessions (
        run_group_id TEXT NOT NULL REFERENCES run_groups(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL REFERENCES worker_sessions(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (run_group_id, session_id)
      ) STRICT;

      CREATE INDEX idx_run_group_sessions_session_id ON run_group_sessions(session_id);
    `,
  },
  {
    version: 5,
    name: "worker_session_followups",
    sql: `
      ALTER TABLE worker_sessions
        ADD COLUMN previous_session_id TEXT REFERENCES worker_sessions(id) ON DELETE SET NULL;

      CREATE INDEX idx_worker_sessions_previous_session_id
        ON worker_sessions(previous_session_id);
    `,
  },
];

export function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const applied = new Set(
    db
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((row) => Number(row["version"])),
  );

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;

    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      db.prepare(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
      ).run(migration.version, migration.name, new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
