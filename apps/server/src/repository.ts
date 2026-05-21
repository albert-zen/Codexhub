import type { DatabaseSync } from "node:sqlite";
import {
  type Item,
  type ItemType,
  type MessageMode,
  type Project,
  type ReviewFinding,
  type ReviewFindingSeverity,
  type ReviewFindingStatus,
  type ReviewGateStatus,
  type RunGroup,
  type RunGroupSessionSummary,
  type SenderType,
  type TaskSpecMetadata,
  type TranscriptEntry,
  type TranscriptPageOptions,
  type WorkerSession,
  type Workspace,
  buildTranscriptEntries,
  projectTranscriptEntries,
} from "@codexhub/core";
import {
  clampLimit,
  encodeJson,
  id,
  isoNow,
  itemFromRow,
  messageFromRow,
  parseCursor,
  placeholders,
  projectFromRow,
  recentTranscriptUnitFromRow,
  requiredUnitSourceId,
  reviewFindingFromRow,
  reviewGateStatusFromRow,
  runGroupFromRow,
  runGroupSessionSummaryFromRow,
  sessionFromRow,
  taskSpecFromRow,
  type RecentTranscriptUnit,
  unique,
  workspaceFromRow,
} from "./repository-sql.js";
import { RawItemLogStore } from "./state-raw-item-log.js";

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
  previous_session_id?: string | null;
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

export interface CreateReviewFindingInput {
  session_id: string;
  reviewer_session_id?: string | null;
  severity: ReviewFindingSeverity;
  summary: string;
  details?: string | null;
}

export interface UpdateReviewFindingInput {
  status?: ReviewFindingStatus;
  worker_response?: string | null;
}

export interface ReviewFindingListOptions {
  limit?: number;
  cursor?: string | null;
}

export interface RunGroupSessionListOptions {
  limit?: number;
  cursor?: string | null;
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

export type SessionResolution =
  | { status: "found"; session: WorkerSession }
  | { status: "not_found"; reference: string }
  | {
      status: "ambiguous";
      reference: string;
      matches: WorkerSession[];
    };

const SESSION_ID_PREFIX = "sess_";
const SESSION_RESOLUTION_MATCH_LIMIT = 20;
const TRANSIENT_SESSION_STATUS_SQL = "'starting', 'running', 'awaiting_input'";
const UNAVAILABLE_TRANSIENT_FAILURE_REASON =
  "Server restarted without a live Codex app-server process; session cannot be continued in this server process. Start a follow-up session.";

export class HubRepository {
  private readonly rawItems: RawItemLogStore;

  constructor(private readonly db: DatabaseSync) {
    this.rawItems = new RawItemLogStore(db);
  }

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

  listRunGroupSessions(
    runGroupId: string,
    options: RunGroupSessionListOptions = {},
  ): {
    items: WorkerSession[];
    next_cursor: string | null;
    limit: number;
  } {
    this.requireRunGroup(runGroupId);
    const limit = clampLimit(options.limit, 20, 100);
    const offset = parseCursor(options.cursor);
    const rows = this.db
      .prepare(
        `SELECT worker_sessions.*
         FROM worker_sessions
         INNER JOIN run_group_sessions
           ON worker_sessions.id = run_group_sessions.session_id
         WHERE run_group_sessions.run_group_id = ?
         ORDER BY run_group_sessions.created_at ASC, run_group_sessions.rowid ASC
         LIMIT ? OFFSET ?`,
      )
      .all(runGroupId, limit + 1, offset)
      .map(sessionFromRow);
    const items = rows.slice(0, limit);
    return {
      items,
      limit,
      next_cursor: rows.length > limit ? String(offset + limit) : null,
    };
  }

  listRunGroupSessionSummaries(
    runGroupId: string,
    options: RunGroupSessionListOptions = {},
  ): {
    items: RunGroupSessionSummary[];
    next_cursor: string | null;
    limit: number;
  } {
    this.requireRunGroup(runGroupId);
    const limit = clampLimit(options.limit, 20, 100);
    const offset = parseCursor(options.cursor);
    const rows = this.db
      .prepare(
        `SELECT
           worker_sessions.*,
           review_gate_statuses.session_id AS review_status_session_id,
           review_gate_statuses.implementation_done AS review_implementation_done,
           review_gate_statuses.self_validation_done AS review_self_validation_done,
           review_gate_statuses.review_requested AS review_requested,
           review_gate_statuses.review_addressed AS review_addressed,
           review_gate_statuses.ready_for_human_review AS review_ready_for_human_review,
           review_gate_statuses.note AS review_note,
           review_gate_statuses.created_at AS review_created_at,
           review_gate_statuses.updated_at AS review_updated_at,
           COALESCE(review_counts.review_finding_count, 0) AS review_finding_count,
           COALESCE(review_counts.open_review_finding_count, 0) AS open_review_finding_count
         FROM run_group_sessions
         INNER JOIN worker_sessions
           ON worker_sessions.id = run_group_sessions.session_id
         LEFT JOIN review_gate_statuses
           ON review_gate_statuses.session_id = worker_sessions.id
         LEFT JOIN (
           SELECT
             session_id,
             COUNT(*) AS review_finding_count,
             SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_review_finding_count
           FROM review_findings
           GROUP BY session_id
         ) review_counts
           ON review_counts.session_id = worker_sessions.id
         WHERE run_group_sessions.run_group_id = ?
         ORDER BY run_group_sessions.created_at ASC, run_group_sessions.rowid ASC
         LIMIT ? OFFSET ?`,
      )
      .all(runGroupId, limit + 1, offset);
    const items = rows.slice(0, limit).map(runGroupSessionSummaryFromRow);
    return {
      items,
      limit,
      next_cursor: rows.length > limit ? String(offset + limit) : null,
    };
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
      previous_session_id: input.previous_session_id ?? null,
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
          id, project_id, workspace_id, previous_session_id, status,
          codex_thread_id, codex_turn_id, codex_session_key, process_pid,
          last_agent_message_item_id, last_agent_message,
          last_agent_message_at, last_item_sequence, failure_reason,
          started_at, ended_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.id,
        session.project_id,
        session.workspace_id,
        session.previous_session_id,
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

  listTransientSessions(): WorkerSession[] {
    return this.db
      .prepare(
        `SELECT * FROM worker_sessions
         WHERE status IN (${TRANSIENT_SESSION_STATUS_SQL})
         ORDER BY updated_at DESC, created_at DESC`,
      )
      .all()
      .map(sessionFromRow);
  }

  resolveSession(reference: string): SessionResolution {
    const sessionReference = reference.trim();
    const exact = this.getSession(sessionReference);
    if (exact) return { status: "found", session: exact };

    const matchUuidPrefix = !sessionReference.startsWith(SESSION_ID_PREFIX);
    const matches = this.db
      .prepare(
        `SELECT * FROM worker_sessions
         WHERE substr(id, 1, ?) = ?
            OR (? = 1 AND substr(id, ?, ?) = ?)
         ORDER BY id ASC
         LIMIT ?`,
      )
      .all(
        sessionReference.length,
        sessionReference,
        matchUuidPrefix ? 1 : 0,
        SESSION_ID_PREFIX.length + 1,
        sessionReference.length,
        sessionReference,
        SESSION_RESOLUTION_MATCH_LIMIT,
      )
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
    failureReason = UNAVAILABLE_TRANSIENT_FAILURE_REASON,
  ): number {
    return this.reconcileTransientSessions(failureReason);
  }

  reconcileUnavailableTransientSessionIds(
    sessionIds: readonly string[],
    failureReason = UNAVAILABLE_TRANSIENT_FAILURE_REASON,
  ): number {
    const uniqueSessionIds = unique(sessionIds);
    if (uniqueSessionIds.length === 0) return 0;
    return this.reconcileTransientSessions(
      failureReason,
      `id IN (${placeholders(uniqueSessionIds)})`,
      uniqueSessionIds,
    );
  }

  private reconcileTransientSessions(
    failureReason: string,
    extraWhere?: string,
    extraValues: readonly string[] = [],
  ): number {
    const now = isoNow();
    const where = [`status IN (${TRANSIENT_SESSION_STATUS_SQL})`, extraWhere]
      .filter((entry): entry is string => Boolean(entry))
      .join(" AND ");
    const result = this.db
      .prepare(
        `UPDATE worker_sessions
         SET status = 'failed', failure_reason = ?, process_pid = NULL,
             ended_at = ?, updated_at = ?
         WHERE ${where}`,
      )
      .run(failureReason, now, now, ...extraValues);
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

  createReviewFinding(input: CreateReviewFindingInput): ReviewFinding {
    this.requireSession(input.session_id);
    if (input.reviewer_session_id)
      this.requireSession(input.reviewer_session_id);

    const now = isoNow();
    const finding: ReviewFinding = {
      id: id("rfnd"),
      session_id: input.session_id,
      reviewer_session_id: input.reviewer_session_id ?? null,
      severity: input.severity,
      status: "open",
      summary: input.summary,
      details: input.details ?? null,
      worker_response: null,
      created_at: now,
      updated_at: now,
    };

    this.db
      .prepare(
        `INSERT INTO review_findings (
          id, session_id, reviewer_session_id, severity, status, summary,
          details, worker_response, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        finding.id,
        finding.session_id,
        finding.reviewer_session_id,
        finding.severity,
        finding.status,
        finding.summary,
        finding.details,
        finding.worker_response,
        finding.created_at,
        finding.updated_at,
      );

    return finding;
  }

  listReviewFindings(
    sessionId: string,
    options: ReviewFindingListOptions = {},
  ): {
    items: ReviewFinding[];
    next_cursor: string | null;
    limit: number;
  } {
    this.requireSession(sessionId);
    const limit = clampLimit(options.limit, 50, 100);
    const offset = parseCursor(options.cursor);
    const rows = this.db
      .prepare(
        `SELECT * FROM review_findings
         WHERE session_id = ?
         ORDER BY created_at ASC, id ASC
         LIMIT ? OFFSET ?`,
      )
      .all(sessionId, limit + 1, offset)
      .map(reviewFindingFromRow);
    const items = rows.slice(0, limit);
    return {
      items,
      limit,
      next_cursor: rows.length > limit ? String(offset + limit) : null,
    };
  }

  getReviewFinding(sessionId: string, findingId: string): ReviewFinding | null {
    this.requireSession(sessionId);
    const row = this.db
      .prepare(
        "SELECT * FROM review_findings WHERE session_id = ? AND id = ? LIMIT 1",
      )
      .get(sessionId, findingId);
    return row ? reviewFindingFromRow(row) : null;
  }

  updateReviewFinding(
    sessionId: string,
    findingId: string,
    input: UpdateReviewFindingInput,
  ): ReviewFinding {
    this.requireReviewFinding(sessionId, findingId);
    const allowed: Array<keyof UpdateReviewFindingInput> = [
      "status",
      "worker_response",
    ];
    const entries: Array<
      [keyof UpdateReviewFindingInput, ReviewFindingStatus | string | null]
    > = [];
    for (const key of allowed) {
      const value = input[key];
      if (value !== undefined) entries.push([key, value]);
    }
    if (entries.length === 0) {
      return this.requireReviewFinding(sessionId, findingId);
    }

    const assignments = entries.map(([key]) => `${key} = ?`).join(", ");
    const values = entries.map(([, value]) => value);
    const now = isoNow();
    this.db
      .prepare(
        `UPDATE review_findings
         SET ${assignments}, updated_at = ?
         WHERE session_id = ? AND id = ?`,
      )
      .run(...values, now, sessionId, findingId);
    return this.requireReviewFinding(sessionId, findingId);
  }

  appendItem(sessionId: string, payload: unknown): Item {
    return this.rawItems.appendItem(sessionId, payload);
  }

  listItems(
    sessionId: string,
    options: ItemPageOptions = {},
  ): {
    items: import("@codexhub/core").Item[];
    next_cursor: string | null;
    limit: number;
  } {
    return this.rawItems.listItems(sessionId, options);
  }

  getItem(id: string): Item | null {
    return this.rawItems.getItem(id);
  }

  latestItem(
    sessionId: string,
    type: ItemType | "all" = "agentmessage",
  ): Item | null {
    return this.rawItems.latestItem(sessionId, type);
  }

  latestCompletedAgentMessage(sessionId: string): Item | null {
    return this.rawItems.latestCompletedAgentMessage(sessionId);
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

  private requireReviewFinding(
    sessionId: string,
    findingId: string,
  ): ReviewFinding {
    const finding = this.getReviewFinding(sessionId, findingId);
    if (!finding) throw new Error(`review finding not found: ${findingId}`);
    return finding;
  }

  private requireMessage(id: string): import("@codexhub/core").Message {
    const row = this.db
      .prepare("SELECT * FROM messages WHERE id = ? LIMIT 1")
      .get(id);
    if (!row) throw new Error(`message not found: ${id}`);
    return messageFromRow(row);
  }
}
