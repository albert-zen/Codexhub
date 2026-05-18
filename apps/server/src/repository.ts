import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  classifyCodexPayload,
  type Item,
  type ItemType,
  type MessageMode,
  type Project,
  type ReviewGateStatus,
  type RunGroup,
  type SenderType,
  type TaskSpecMetadata,
  type TranscriptEntry,
  type TranscriptPageOptions,
  type WorkerSession,
  type Workspace,
  buildTranscriptEntries,
  projectTranscriptEntries,
} from "@codexhub/core";

export interface CreateProjectInput {
  name: string;
  default_repo_url?: string | null;
  default_workspace_root?: string | null;
  default_cwd?: string | null;
  default_branch?: string | null;
  default_codex_options?: unknown | null;
}

export interface CreateWorkspaceInput {
  project_id: string;
  source_type: "git" | "local";
  repo_url?: string | null;
  path: string;
  cwd: string;
  branch?: string | null;
  commit_sha?: string | null;
  status?: Workspace["status"];
  last_error?: string | null;
}

export interface CreateRunGroupInput {
  name: string;
  project_id?: string | null;
  purpose?: string | null;
}

export interface CreateSessionInput {
  project_id: string;
  workspace_id: string;
}

export interface CreateTaskSpecInput {
  session_id: string;
  ref?: string | null;
  title?: string | null;
  intent?: string | null;
  scope?: string | null;
  acceptance_criteria?: string | null;
  raw?: string | null;
}

export interface CreateMessageInput {
  session_id: string;
  mode: MessageMode;
  content: string;
  sender_type: SenderType;
  sender_id?: string | null;
}

export interface UpdateReviewGateStatusInput {
  implementation_done?: boolean;
  self_validation_done?: boolean;
  review_requested?: boolean;
  review_addressed?: boolean;
  ready_for_human_review?: boolean;
  note?: string | null;
}

export interface ItemPageOptions {
  type?: ItemType | "all" | null;
  limit?: number;
  after?: number | null;
  before?: number | null;
  recent?: boolean;
}

export interface SessionListOptions {
  project_id?: string | null;
  workspace_id?: string | null;
  status?: WorkerSession["status"] | null;
  limit?: number;
  cursor?: string | null;
}

type TranscriptUnitSource = "message" | "agent" | "item";

interface RecentTranscriptUnit {
  unit_source: TranscriptUnitSource;
  entry_id: string;
  codex_item_id: string | null;
  source_id: string | null;
  transcript_sequence: number;
}

export type SessionResolution =
  | { status: "found"; session: WorkerSession }
  | { status: "not_found"; reference: string }
  | {
      status: "ambiguous";
      reference: string;
      matches: WorkerSession[];
    };

export class HubRepository {
  constructor(private readonly db: DatabaseSync) {}

  createProject(input: CreateProjectInput): Project {
    const now = isoNow();
    const project: Project = {
      id: id("proj"),
      name: input.name,
      default_repo_url: input.default_repo_url ?? null,
      default_workspace_root: input.default_workspace_root ?? null,
      default_cwd: input.default_cwd ?? null,
      default_branch: input.default_branch ?? null,
      default_codex_options: input.default_codex_options ?? null,
      created_at: now,
      updated_at: now,
    };

    this.db
      .prepare(
        `INSERT INTO projects (
          id, name, default_repo_url, default_workspace_root, default_cwd,
          default_branch, default_codex_options_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        project.id,
        project.name,
        project.default_repo_url,
        project.default_workspace_root,
        project.default_cwd,
        project.default_branch,
        encodeJson(project.default_codex_options),
        project.created_at,
        project.updated_at,
      );

    return project;
  }

  listProjects(): Project[] {
    return this.db
      .prepare(
        "SELECT * FROM projects ORDER BY updated_at DESC, created_at DESC",
      )
      .all()
      .map(projectFromRow);
  }

  getProject(idOrName: string): Project | null {
    const row = this.db
      .prepare("SELECT * FROM projects WHERE id = ? OR name = ? LIMIT 1")
      .get(idOrName, idOrName);
    return row ? projectFromRow(row) : null;
  }

  createRunGroup(input: CreateRunGroupInput): RunGroup {
    const now = isoNow();
    const runGroup: RunGroup = {
      id: id("run"),
      project_id: input.project_id ?? null,
      name: input.name,
      purpose: input.purpose ?? null,
      created_at: now,
      updated_at: now,
    };
    this.db
      .prepare(
        `INSERT INTO run_groups (
          id, project_id, name, purpose, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        runGroup.id,
        runGroup.project_id,
        runGroup.name,
        runGroup.purpose,
        runGroup.created_at,
        runGroup.updated_at,
      );
    return runGroup;
  }

  listRunGroups(projectId?: string | null): RunGroup[] {
    const sql = projectId
      ? "SELECT * FROM run_groups WHERE project_id = ? ORDER BY updated_at DESC"
      : "SELECT * FROM run_groups ORDER BY updated_at DESC";
    const rows = projectId
      ? this.db.prepare(sql).all(projectId)
      : this.db.prepare(sql).all();
    return rows.map(runGroupFromRow);
  }

  getRunGroup(id: string): RunGroup | null {
    const row = this.db
      .prepare("SELECT * FROM run_groups WHERE id = ? LIMIT 1")
      .get(id);
    return row ? runGroupFromRow(row) : null;
  }

  addSessionToRunGroup(runGroupId: string, sessionId: string): void {
    this.requireRunGroup(runGroupId);
    this.requireSession(sessionId);
    this.db
      .prepare(
        `INSERT OR IGNORE INTO run_group_sessions (
          run_group_id, session_id, created_at
        ) VALUES (?, ?, ?)`,
      )
      .run(runGroupId, sessionId, isoNow());
    this.db
      .prepare("UPDATE run_groups SET updated_at = ? WHERE id = ?")
      .run(isoNow(), runGroupId);
  }

  listRunGroupSessions(runGroupId: string): WorkerSession[] {
    this.requireRunGroup(runGroupId);
    return this.db
      .prepare(
        `SELECT worker_sessions.*
         FROM worker_sessions
         INNER JOIN run_group_sessions
           ON worker_sessions.id = run_group_sessions.session_id
         WHERE run_group_sessions.run_group_id = ?
         ORDER BY run_group_sessions.created_at ASC`,
      )
      .all(runGroupId)
      .map(sessionFromRow);
  }

  createWorkspace(input: CreateWorkspaceInput): Workspace {
    const now = isoNow();
    const workspace: Workspace = {
      id: id("work"),
      project_id: input.project_id,
      source_type: input.source_type,
      repo_url: input.repo_url ?? null,
      path: input.path,
      cwd: input.cwd,
      branch: input.branch ?? null,
      commit_sha: input.commit_sha ?? null,
      status: input.status ?? "ready",
      last_error: input.last_error ?? null,
      created_at: now,
      updated_at: now,
    };

    this.db
      .prepare(
        `INSERT INTO workspaces (
          id, project_id, source_type, repo_url, path, cwd, branch,
          commit_sha, status, last_error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        workspace.id,
        workspace.project_id,
        workspace.source_type,
        workspace.repo_url,
        workspace.path,
        workspace.cwd,
        workspace.branch,
        workspace.commit_sha,
        workspace.status,
        workspace.last_error,
        workspace.created_at,
        workspace.updated_at,
      );

    return workspace;
  }

  listWorkspaces(projectId?: string | null): Workspace[] {
    const sql = projectId
      ? "SELECT * FROM workspaces WHERE project_id = ? ORDER BY updated_at DESC"
      : "SELECT * FROM workspaces ORDER BY updated_at DESC";
    const rows = projectId
      ? this.db.prepare(sql).all(projectId)
      : this.db.prepare(sql).all();
    return rows.map(workspaceFromRow);
  }

  getWorkspace(id: string): Workspace | null {
    const row = this.db
      .prepare("SELECT * FROM workspaces WHERE id = ? LIMIT 1")
      .get(id);
    return row ? workspaceFromRow(row) : null;
  }

  updateWorkspace(
    id: string,
    fields: Partial<Pick<Workspace, "status" | "last_error">>,
  ): Workspace {
    const entries = Object.entries(fields).filter(
      ([, value]) => value !== undefined,
    );
    if (entries.length === 0) return this.requireWorkspace(id);

    const assignments = entries.map(([key]) => `${key} = ?`).join(", ");
    const values = entries.map(([, value]) => value);
    const updatedAt = isoNow();

    this.db
      .prepare(
        `UPDATE workspaces SET ${assignments}, updated_at = ? WHERE id = ?`,
      )
      .run(...values, updatedAt, id);
    return this.requireWorkspace(id);
  }

  createSession(input: CreateSessionInput): WorkerSession {
    const now = isoNow();
    const session: WorkerSession = {
      id: id("sess"),
      project_id: input.project_id,
      workspace_id: input.workspace_id,
      status: "starting",
      codex_thread_id: null,
      codex_turn_id: null,
      codex_session_key: null,
      process_pid: null,
      last_agent_message_item_id: null,
      last_agent_message: null,
      last_agent_message_at: null,
      last_item_sequence: 0,
      failure_reason: null,
      started_at: null,
      ended_at: null,
      created_at: now,
      updated_at: now,
    };

    this.db
      .prepare(
        `INSERT INTO worker_sessions (
          id, project_id, workspace_id, status, codex_thread_id, codex_turn_id,
          codex_session_key, process_pid, last_agent_message_item_id,
          last_agent_message, last_agent_message_at, last_item_sequence,
          failure_reason, started_at, ended_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.id,
        session.project_id,
        session.workspace_id,
        session.status,
        session.codex_thread_id,
        session.codex_turn_id,
        session.codex_session_key,
        session.process_pid,
        session.last_agent_message_item_id,
        session.last_agent_message,
        session.last_agent_message_at,
        session.last_item_sequence,
        session.failure_reason,
        session.started_at,
        session.ended_at,
        session.created_at,
        session.updated_at,
      );

    return session;
  }

  listSessions(options: SessionListOptions = {}): {
    items: WorkerSession[];
    next_cursor: string | null;
    limit: number;
  } {
    const limit = clampLimit(options.limit, 20, 100);
    const offset = parseCursor(options.cursor);
    const where: string[] = [];
    const values: Array<string | number> = [];

    if (options.project_id) {
      where.push("project_id = ?");
      values.push(options.project_id);
    }
    if (options.workspace_id) {
      where.push("workspace_id = ?");
      values.push(options.workspace_id);
    }
    if (options.status) {
      where.push("status = ?");
      values.push(options.status);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `SELECT * FROM worker_sessions ${whereSql}
         ORDER BY updated_at DESC, created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...values, limit + 1, offset)
      .map(sessionFromRow);

    const items = rows.slice(0, limit);
    return {
      items,
      limit,
      next_cursor: rows.length > limit ? String(offset + limit) : null,
    };
  }

  getSession(id: string): WorkerSession | null {
    const row = this.db
      .prepare("SELECT * FROM worker_sessions WHERE id = ? LIMIT 1")
      .get(id);
    return row ? sessionFromRow(row) : null;
  }

  resolveSession(reference: string): SessionResolution {
    const sessionReference = reference.trim();
    const exact = this.getSession(sessionReference);
    if (exact) return { status: "found", session: exact };

    const matches = this.db
      .prepare(
        `SELECT * FROM worker_sessions
         WHERE substr(id, 1, ?) = ?
         ORDER BY updated_at DESC, created_at DESC
         LIMIT 2`,
      )
      .all(sessionReference.length, sessionReference)
      .map(sessionFromRow);

    if (matches.length === 0) {
      return { status: "not_found", reference: sessionReference };
    }
    if (matches.length > 1) {
      return { status: "ambiguous", reference: sessionReference, matches };
    }
    const [session] = matches;
    if (!session) return { status: "not_found", reference: sessionReference };
    return { status: "found", session };
  }

  reconcileUnavailableTransientSessions(
    failureReason = "Server restarted without a live Codex app-server process; session cannot be continued in this server process. Start a follow-up session.",
  ): number {
    const now = isoNow();
    const result = this.db
      .prepare(
        `UPDATE worker_sessions
         SET status = 'failed', failure_reason = ?, process_pid = NULL,
             ended_at = ?, updated_at = ?
         WHERE status IN ('starting', 'running', 'awaiting_input')`,
      )
      .run(failureReason, now, now);
    return Number(result.changes);
  }

  updateSession(
    id: string,
    fields: Partial<
      Pick<
        WorkerSession,
        | "status"
        | "codex_thread_id"
        | "codex_turn_id"
        | "codex_session_key"
        | "process_pid"
        | "failure_reason"
        | "started_at"
        | "ended_at"
      >
    >,
  ): WorkerSession {
    const entries = Object.entries(fields).filter(
      ([, value]) => value !== undefined,
    );
    if (entries.length === 0) return this.requireSession(id);

    const assignments = entries.map(([key]) => `${key} = ?`).join(", ");
    const values = entries.map(([, value]) => value);
    const updatedAt = isoNow();

    this.db
      .prepare(
        `UPDATE worker_sessions SET ${assignments}, updated_at = ? WHERE id = ?`,
      )
      .run(...values, updatedAt, id);
    return this.requireSession(id);
  }

  createTaskSpec(input: CreateTaskSpecInput): TaskSpecMetadata {
    this.requireSession(input.session_id);
    const now = isoNow();
    this.db
      .prepare(
        `INSERT INTO session_task_specs (
          session_id, ref, title, intent, scope, acceptance_criteria, raw,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO NOTHING`,
      )
      .run(
        input.session_id,
        input.ref ?? null,
        input.title ?? null,
        input.intent ?? null,
        input.scope ?? null,
        input.acceptance_criteria ?? null,
        input.raw ?? null,
        now,
      );
    return this.requireTaskSpec(input.session_id);
  }

  getTaskSpec(sessionId: string): TaskSpecMetadata | null {
    const row = this.db
      .prepare("SELECT * FROM session_task_specs WHERE session_id = ?")
      .get(sessionId);
    return row ? taskSpecFromRow(row) : null;
  }

  createMessage(input: CreateMessageInput): import("@codexhub/core").Message {
    const now = isoNow();
    const message = {
      id: id("msg"),
      session_id: input.session_id,
      mode: input.mode,
      content: input.content,
      sender_type: input.sender_type,
      sender_id: input.sender_id ?? null,
      status: "queued" as const,
      codex_request_id: null,
      error: null,
      created_at: now,
      sent_at: null,
    };

    this.db
      .prepare(
        `INSERT INTO messages (
          id, session_id, mode, content, sender_type, sender_id, status,
          codex_request_id, error, created_at, sent_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.id,
        message.session_id,
        message.mode,
        message.content,
        message.sender_type,
        message.sender_id,
        message.status,
        message.codex_request_id,
        message.error,
        message.created_at,
        message.sent_at,
      );

    return message;
  }

  listMessages(sessionId: string): import("@codexhub/core").Message[] {
    return this.db
      .prepare(
        "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC, id ASC",
      )
      .all(sessionId)
      .map(messageFromRow);
  }

  markMessageSent(
    id: string,
    codexRequestId?: string | number | null,
  ): import("@codexhub/core").Message {
    this.db
      .prepare(
        "UPDATE messages SET status = 'sent', codex_request_id = ?, sent_at = ? WHERE id = ?",
      )
      .run(
        codexRequestId === undefined || codexRequestId === null
          ? null
          : String(codexRequestId),
        isoNow(),
        id,
      );
    return this.requireMessage(id);
  }

  markMessageFailed(
    id: string,
    error: string,
  ): import("@codexhub/core").Message {
    this.db
      .prepare("UPDATE messages SET status = 'failed', error = ? WHERE id = ?")
      .run(error, id);
    return this.requireMessage(id);
  }

  getReviewGateStatus(sessionId: string): ReviewGateStatus {
    this.requireSession(sessionId);
    const row = this.db
      .prepare("SELECT * FROM review_gate_statuses WHERE session_id = ?")
      .get(sessionId);
    if (row) return reviewGateStatusFromRow(row);

    const now = isoNow();
    this.db
      .prepare(
        `INSERT INTO review_gate_statuses (
          session_id, implementation_done, self_validation_done,
          review_requested, review_addressed, ready_for_human_review,
          note, created_at, updated_at
        ) VALUES (?, 0, 0, 0, 0, 0, NULL, ?, ?)`,
      )
      .run(sessionId, now, now);
    return this.getReviewGateStatus(sessionId);
  }

  updateReviewGateStatus(
    sessionId: string,
    input: UpdateReviewGateStatusInput,
  ): ReviewGateStatus {
    this.getReviewGateStatus(sessionId);
    const allowed: Array<keyof UpdateReviewGateStatusInput> = [
      "implementation_done",
      "self_validation_done",
      "review_requested",
      "review_addressed",
      "ready_for_human_review",
      "note",
    ];
    const entries: Array<
      [keyof UpdateReviewGateStatusInput, boolean | string | null]
    > = [];
    for (const key of allowed) {
      const value = input[key];
      if (value !== undefined) entries.push([key, value]);
    }
    if (entries.length === 0) return this.getReviewGateStatus(sessionId);

    const assignments = entries.map(([key]) => `${key} = ?`).join(", ");
    const values = entries.map(([, value]) =>
      typeof value === "boolean" ? (value ? 1 : 0) : value,
    );
    const now = isoNow();
    this.db
      .prepare(
        `UPDATE review_gate_statuses
         SET ${assignments}, updated_at = ?
         WHERE session_id = ?`,
      )
      .run(...values, now, sessionId);
    return this.getReviewGateStatus(sessionId);
  }

  appendItem(sessionId: string, payload: unknown): Item {
    const session = this.requireSession(sessionId);
    const sequence = session.last_item_sequence + 1;
    const classification = classifyCodexPayload(payload);
    const now = isoNow();
    const item: Item = {
      id: id("item"),
      session_id: sessionId,
      sequence,
      type: classification.type,
      codex_method: classification.method,
      codex_item_id: classification.codexItemId,
      codex_item_type: classification.codexItemType,
      created_at: now,
      raw_payload: payload,
      text_excerpt: classification.textExcerpt,
    };

    this.db
      .prepare(
        `INSERT INTO items (
          id, session_id, sequence, type, codex_method, codex_item_id,
          codex_item_type, created_at, raw_payload_json, text_excerpt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        item.id,
        item.session_id,
        item.sequence,
        item.type,
        item.codex_method,
        item.codex_item_id,
        item.codex_item_type,
        item.created_at,
        encodeJson(item.raw_payload) ?? "null",
        item.text_excerpt,
      );

    const agentProjection =
      item.type === "agentmessage" && item.text_excerpt
        ? this.agentMessageProjection(item)
        : null;

    if (agentProjection && !agentProjection.isSingleDeltaFragment) {
      this.db
        .prepare(
          `UPDATE worker_sessions
           SET last_item_sequence = ?, last_agent_message_item_id = ?,
               last_agent_message = ?, last_agent_message_at = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          item.sequence,
          agentProjection.itemId,
          agentProjection.text,
          agentProjection.createdAt,
          now,
          sessionId,
        );
    } else {
      this.db
        .prepare(
          "UPDATE worker_sessions SET last_item_sequence = ?, updated_at = ? WHERE id = ?",
        )
        .run(item.sequence, now, sessionId);
    }

    return item;
  }

  listItems(
    sessionId: string,
    options: ItemPageOptions = {},
  ): {
    items: import("@codexhub/core").Item[];
    next_cursor: string | null;
    limit: number;
  } {
    const limit = clampLimit(options.limit, 20, 200);
    const after = options.after ?? 0;
    const before = options.before;
    const type = options.type ?? "agentmessage";
    const noTypeFilter = type === "all";

    if (options.recent && after === 0 && before === undefined) {
      const sql = noTypeFilter
        ? `SELECT * FROM items WHERE session_id = ? ORDER BY sequence DESC LIMIT ?`
        : `SELECT * FROM items WHERE session_id = ? AND type = ? ORDER BY sequence DESC LIMIT ?`;
      const rows = noTypeFilter
        ? this.db.prepare(sql).all(sessionId, limit + 1)
        : this.db.prepare(sql).all(sessionId, type, limit + 1);
      const items = rows
        .map(itemFromRow)
        .slice(0, limit)
        .sort((left, right) => left.sequence - right.sequence);
      return {
        items,
        limit,
        next_cursor: null,
      };
    }

    const where = ["session_id = ?", "sequence > ?"];
    const values: Array<string | number> = [sessionId, after];
    if (!noTypeFilter) {
      where.push("type = ?");
      values.push(type);
    }
    if (before !== undefined && before !== null) {
      where.push("sequence < ?");
      values.push(before);
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM items WHERE ${where.join(" AND ")}
         ORDER BY sequence ASC LIMIT ?`,
      )
      .all(...values, limit + 1);
    const items = rows.map(itemFromRow).slice(0, limit);
    const extra = rows.length > limit;
    return {
      items,
      limit,
      next_cursor:
        extra && items.length > 0
          ? String(items[items.length - 1]?.sequence)
          : null,
    };
  }

  getItem(id: string): Item | null {
    const row = this.db
      .prepare("SELECT * FROM items WHERE id = ? LIMIT 1")
      .get(id);
    return row ? itemFromRow(row) : null;
  }

  latestItem(
    sessionId: string,
    type: ItemType | "all" = "agentmessage",
  ): Item | null {
    const noTypeFilter = type === "all";
    const row = noTypeFilter
      ? this.db
          .prepare(
            "SELECT * FROM items WHERE session_id = ? ORDER BY sequence DESC LIMIT 1",
          )
          .get(sessionId)
      : this.db
          .prepare(
            "SELECT * FROM items WHERE session_id = ? AND type = ? ORDER BY sequence DESC LIMIT 1",
          )
          .get(sessionId, type);
    return row ? itemFromRow(row) : null;
  }

  listTranscript(
    sessionId: string,
    options: TranscriptPageOptions = {},
  ): {
    items: TranscriptEntry[];
    next_cursor: string | null;
    limit: number;
  } {
    this.requireSession(sessionId);
    const limit = clampLimit(options.limit, 20, 100);
    const after = options.after ?? 0;
    const before = options.before;
    if (options.recent && after === 0 && before === undefined) {
      return this.listRecentTranscript(sessionId, limit);
    }

    const messages = this.listMessages(sessionId);
    const items = this.db
      .prepare("SELECT * FROM items WHERE session_id = ? ORDER BY sequence ASC")
      .all(sessionId)
      .map(itemFromRow);
    return projectTranscriptEntries(sessionId, messages, items, options);
  }

  private listRecentTranscript(
    sessionId: string,
    limit: number,
  ): {
    items: TranscriptEntry[];
    next_cursor: string | null;
    limit: number;
  } {
    const units = this.db
      .prepare(
        `WITH transcript_units AS (
          SELECT
            'message' AS unit_source,
            'message:' || id AS entry_id,
            NULL AS codex_item_id,
            id AS source_id,
            COALESCE(sent_at, created_at) AS sort_time,
            0 AS sort_source_rank,
            0 AS sort_sequence,
            id AS tie_id
          FROM messages
          WHERE session_id = ? AND status = 'sent'

          UNION ALL

          SELECT
            'agent' AS unit_source,
            'agent:' || group_id AS entry_id,
            codex_item_id,
            source_id,
            MIN(first_created_at) AS sort_time,
            1 AS sort_source_rank,
            MIN(sequence) AS sort_sequence,
            'agent:' || group_id AS tie_id
          FROM (
            SELECT
              CASE WHEN codex_item_id IS NOT NULL THEN codex_item_id ELSE id END AS group_id,
              codex_item_id,
              CASE WHEN codex_item_id IS NULL THEN id ELSE NULL END AS source_id,
              FIRST_VALUE(created_at) OVER (
                PARTITION BY
                  codex_item_id,
                  CASE WHEN codex_item_id IS NULL THEN id ELSE NULL END
                ORDER BY sequence ASC
              ) AS first_created_at,
              sequence
            FROM items
            WHERE session_id = ? AND type = 'agentmessage'
          )
          GROUP BY group_id, codex_item_id, source_id

          UNION ALL

          SELECT
            'item' AS unit_source,
            'item:' || id AS entry_id,
            NULL AS codex_item_id,
            id AS source_id,
            created_at AS sort_time,
            1 AS sort_source_rank,
            sequence AS sort_sequence,
            id AS tie_id
          FROM items
          WHERE session_id = ? AND type <> 'agentmessage'
        ),
        numbered AS (
          SELECT
            unit_source,
            entry_id,
            codex_item_id,
            source_id,
            row_number() OVER (
              ORDER BY sort_time ASC, sort_source_rank ASC, sort_sequence ASC, tie_id ASC
            ) AS transcript_sequence
          FROM transcript_units
        )
        SELECT *
        FROM numbered
        ORDER BY transcript_sequence DESC
        LIMIT ?`,
      )
      .all(sessionId, sessionId, sessionId, limit)
      .map(recentTranscriptUnitFromRow)
      .sort(
        (left, right) => left.transcript_sequence - right.transcript_sequence,
      );

    if (units.length === 0) {
      return { items: [], limit, next_cursor: null };
    }

    const sequenceByEntryId = new Map(
      units.map((unit) => [unit.entry_id, unit.transcript_sequence]),
    );
    const messages = this.messagesForTranscriptUnits(sessionId, units);
    const items = this.itemsForTranscriptUnits(sessionId, units);
    const entries = buildTranscriptEntries(sessionId, messages, items)
      .map((entry) => {
        const sequence = sequenceByEntryId.get(entry.id);
        if (sequence === undefined) {
          throw new Error(`missing transcript sequence for ${entry.id}`);
        }
        return { ...entry, sequence };
      })
      .sort((left, right) => left.sequence - right.sequence);

    return {
      items: entries,
      limit,
      next_cursor: null,
    };
  }

  private messagesForTranscriptUnits(
    sessionId: string,
    units: RecentTranscriptUnit[],
  ): import("@codexhub/core").Message[] {
    const messageIds = unique(
      units
        .filter((unit) => unit.unit_source === "message")
        .map((unit) => requiredUnitSourceId(unit)),
    );
    if (messageIds.length === 0) return [];

    return this.db
      .prepare(
        `SELECT * FROM messages
         WHERE session_id = ? AND id IN (${placeholders(messageIds)})
         ORDER BY created_at ASC, id ASC`,
      )
      .all(sessionId, ...messageIds)
      .map(messageFromRow);
  }

  private itemsForTranscriptUnits(
    sessionId: string,
    units: RecentTranscriptUnit[],
  ): Item[] {
    const itemIds = unique(
      units
        .filter(
          (unit) =>
            unit.unit_source === "item" ||
            (unit.unit_source === "agent" && unit.codex_item_id === null),
        )
        .map((unit) => requiredUnitSourceId(unit)),
    );
    const agentCodexItemIds = unique(
      units
        .filter(
          (unit) => unit.unit_source === "agent" && unit.codex_item_id !== null,
        )
        .map((unit) => unit.codex_item_id ?? ""),
    );
    const where: string[] = [];
    const values: string[] = [sessionId];

    if (itemIds.length > 0) {
      where.push(`id IN (${placeholders(itemIds)})`);
      values.push(...itemIds);
    }
    if (agentCodexItemIds.length > 0) {
      where.push(
        `type = 'agentmessage' AND codex_item_id IN (${placeholders(
          agentCodexItemIds,
        )})`,
      );
      values.push(...agentCodexItemIds);
    }
    if (where.length === 0) return [];

    return this.db
      .prepare(
        `SELECT * FROM items
         WHERE session_id = ? AND (${where.join(" OR ")})
         ORDER BY sequence ASC`,
      )
      .all(...values)
      .map(itemFromRow);
  }

  private agentMessageProjection(item: Item): {
    itemId: string;
    text: string;
    createdAt: string;
    isSingleDeltaFragment: boolean;
  } | null {
    if (!item.text_excerpt) return null;
    const group = this.agentMessageGroup(item);
    const completed = [...group]
      .reverse()
      .find(
        (entry) =>
          entry.codex_method === "item/completed" &&
          entry.text_excerpt !== null &&
          entry.text_excerpt.trim() !== "",
      );

    if (completed?.text_excerpt) {
      return {
        itemId: completed.id,
        text: completed.text_excerpt,
        createdAt: completed.created_at,
        isSingleDeltaFragment: false,
      };
    }

    const text =
      group
        .map((entry) => entry.text_excerpt ?? "")
        .join("")
        .trim() || item.text_excerpt;

    return {
      itemId: item.id,
      text,
      createdAt: item.created_at,
      isSingleDeltaFragment:
        item.codex_method === "item/agentMessage/delta" && group.length === 1,
    };
  }

  private agentMessageGroup(item: Item): Item[] {
    if (!item.codex_item_id) return [item];
    return this.db
      .prepare(
        `SELECT * FROM items
         WHERE session_id = ? AND type = 'agentmessage' AND codex_item_id = ?
         ORDER BY sequence ASC`,
      )
      .all(item.session_id, item.codex_item_id)
      .map(itemFromRow);
  }

  private requireSession(id: string): WorkerSession {
    const session = this.getSession(id);
    if (!session) throw new Error(`session not found: ${id}`);
    return session;
  }

  private requireWorkspace(id: string): Workspace {
    const workspace = this.getWorkspace(id);
    if (!workspace) throw new Error(`workspace not found: ${id}`);
    return workspace;
  }

  private requireRunGroup(id: string): RunGroup {
    const runGroup = this.getRunGroup(id);
    if (!runGroup) throw new Error(`run group not found: ${id}`);
    return runGroup;
  }

  private requireTaskSpec(sessionId: string): TaskSpecMetadata {
    const taskSpec = this.getTaskSpec(sessionId);
    if (!taskSpec) throw new Error(`task spec not found: ${sessionId}`);
    return taskSpec;
  }

  private requireMessage(id: string): import("@codexhub/core").Message {
    const row = this.db
      .prepare("SELECT * FROM messages WHERE id = ? LIMIT 1")
      .get(id);
    if (!row) throw new Error(`message not found: ${id}`);
    return messageFromRow(row);
  }
}

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function isoNow(): string {
  return new Date().toISOString();
}

function encodeJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

function parseJson(value: string | null): unknown | null {
  if (!value) return null;
  return JSON.parse(value);
}

function clampLimit(
  value: number | undefined,
  fallback: number,
  max: number,
): number {
  if (!Number.isInteger(value) || value === undefined || value < 1)
    return fallback;
  return Math.min(value, max);
}

function parseCursor(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function placeholders(values: unknown[]): string {
  return values.map(() => "?").join(", ");
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function requiredUnitSourceId(unit: RecentTranscriptUnit): string {
  if (unit.source_id === null) {
    throw new Error(`missing source id for transcript unit ${unit.entry_id}`);
  }
  return unit.source_id;
}

function projectFromRow(row: unknown): Project {
  const record = asRow(row);
  return {
    id: requiredString(record, "id"),
    name: requiredString(record, "name"),
    default_repo_url: string(record, "default_repo_url"),
    default_workspace_root: string(record, "default_workspace_root"),
    default_cwd: string(record, "default_cwd"),
    default_branch: string(record, "default_branch"),
    default_codex_options: parseJson(
      string(record, "default_codex_options_json"),
    ),
    created_at: requiredString(record, "created_at"),
    updated_at: requiredString(record, "updated_at"),
  };
}

function workspaceFromRow(row: unknown): Workspace {
  const record = asRow(row);
  return {
    id: requiredString(record, "id"),
    project_id: requiredString(record, "project_id"),
    source_type: requiredString(
      record,
      "source_type",
    ) as Workspace["source_type"],
    repo_url: string(record, "repo_url"),
    path: requiredString(record, "path"),
    cwd: requiredString(record, "cwd"),
    branch: string(record, "branch"),
    commit_sha: string(record, "commit_sha"),
    status: requiredString(record, "status") as Workspace["status"],
    last_error: string(record, "last_error"),
    created_at: requiredString(record, "created_at"),
    updated_at: requiredString(record, "updated_at"),
  };
}

function runGroupFromRow(row: unknown): RunGroup {
  const record = asRow(row);
  return {
    id: requiredString(record, "id"),
    project_id: string(record, "project_id"),
    name: requiredString(record, "name"),
    purpose: string(record, "purpose"),
    created_at: requiredString(record, "created_at"),
    updated_at: requiredString(record, "updated_at"),
  };
}

function sessionFromRow(row: unknown): WorkerSession {
  const record = asRow(row);
  return {
    id: requiredString(record, "id"),
    project_id: requiredString(record, "project_id"),
    workspace_id: requiredString(record, "workspace_id"),
    status: requiredString(record, "status") as WorkerSession["status"],
    codex_thread_id: string(record, "codex_thread_id"),
    codex_turn_id: string(record, "codex_turn_id"),
    codex_session_key: string(record, "codex_session_key"),
    process_pid: string(record, "process_pid"),
    last_agent_message_item_id: string(record, "last_agent_message_item_id"),
    last_agent_message: string(record, "last_agent_message"),
    last_agent_message_at: string(record, "last_agent_message_at"),
    last_item_sequence: number(record, "last_item_sequence"),
    failure_reason: string(record, "failure_reason"),
    started_at: string(record, "started_at"),
    ended_at: string(record, "ended_at"),
    created_at: requiredString(record, "created_at"),
    updated_at: requiredString(record, "updated_at"),
  };
}

function taskSpecFromRow(row: unknown): TaskSpecMetadata {
  const record = asRow(row);
  return {
    session_id: requiredString(record, "session_id"),
    ref: string(record, "ref"),
    title: string(record, "title"),
    intent: string(record, "intent"),
    scope: string(record, "scope"),
    acceptance_criteria: string(record, "acceptance_criteria"),
    raw: string(record, "raw"),
    created_at: requiredString(record, "created_at"),
  };
}

function itemFromRow(row: unknown): import("@codexhub/core").Item {
  const record = asRow(row);
  return {
    id: requiredString(record, "id"),
    session_id: requiredString(record, "session_id"),
    sequence: number(record, "sequence"),
    type: requiredString(record, "type") as ItemType,
    codex_method: string(record, "codex_method"),
    codex_item_id: string(record, "codex_item_id"),
    codex_item_type: string(record, "codex_item_type"),
    created_at: requiredString(record, "created_at"),
    raw_payload: JSON.parse(requiredString(record, "raw_payload_json")),
    text_excerpt: string(record, "text_excerpt"),
  };
}

function messageFromRow(row: unknown): import("@codexhub/core").Message {
  const record = asRow(row);
  return {
    id: requiredString(record, "id"),
    session_id: requiredString(record, "session_id"),
    mode: requiredString(record, "mode") as MessageMode,
    content: requiredString(record, "content"),
    sender_type: requiredString(record, "sender_type") as SenderType,
    sender_id: string(record, "sender_id"),
    status: requiredString(
      record,
      "status",
    ) as import("@codexhub/core").MessageStatus,
    codex_request_id: string(record, "codex_request_id"),
    error: string(record, "error"),
    created_at: requiredString(record, "created_at"),
    sent_at: string(record, "sent_at"),
  };
}

function recentTranscriptUnitFromRow(row: unknown): RecentTranscriptUnit {
  const record = asRow(row);
  const unitSource = requiredString(record, "unit_source");
  if (
    unitSource !== "message" &&
    unitSource !== "agent" &&
    unitSource !== "item"
  ) {
    throw new Error(`invalid transcript unit source: ${unitSource}`);
  }

  return {
    unit_source: unitSource,
    entry_id: requiredString(record, "entry_id"),
    codex_item_id: string(record, "codex_item_id"),
    source_id: string(record, "source_id"),
    transcript_sequence: number(record, "transcript_sequence"),
  };
}

function reviewGateStatusFromRow(row: unknown): ReviewGateStatus {
  const record = asRow(row);
  return {
    session_id: requiredString(record, "session_id"),
    implementation_done: boolean(record, "implementation_done"),
    self_validation_done: boolean(record, "self_validation_done"),
    review_requested: boolean(record, "review_requested"),
    review_addressed: boolean(record, "review_addressed"),
    ready_for_human_review: boolean(record, "ready_for_human_review"),
    note: string(record, "note"),
    created_at: requiredString(record, "created_at"),
    updated_at: requiredString(record, "updated_at"),
  };
}

function asRow(row: unknown): Record<string, unknown> {
  if (row && typeof row === "object" && !Array.isArray(row))
    return row as Record<string, unknown>;
  throw new Error("invalid database row");
}

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value === "string") return value;
  throw new Error(`database field ${key} is not a string`);
}

function string(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function number(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value === "number") return value;
  throw new Error(`database field ${key} is not a number`);
}

function boolean(row: Record<string, unknown>, key: string): boolean {
  return number(row, key) === 1;
}
