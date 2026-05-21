import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { SESSION_ACTIONS, getSessionActionAvailability } from "@codexhub/core";
import type {
  ID,
  Item,
  ItemType,
  MessageMode,
  Project,
  RunGroup,
  RunGroupDashboardResponse,
  RunGroupSessionSummary,
  TaskSpecMetadata,
  TranscriptEntry,
  WorkerSession,
  WorkerSessionStatus,
  Workspace,
  SessionAction,
} from "@codexhub/core";
import {
  buildFollowUpSessionRequest,
  buildStartSessionRequest,
  canStartFollowUpFromStatus,
  createEmptySessionDraft,
  validateSessionDraft,
  type SessionDraft,
} from "./session-forms.js";
import {
  attentionLabels,
  reviewStateLabel,
  runGroupDashboardCounts,
} from "./run-group-dashboard.js";
import {
  RECENT_TRANSCRIPT_CURSOR,
  type TranscriptCursor,
  conversationWindow,
} from "./transcript-view.js";
import "./styles.css";

type SendMessageMode = Exclude<MessageMode, "initial">;

interface ItemPage {
  items: Item[];
  next_cursor: string | null;
  limit: number;
  type: string;
}

interface TranscriptPage {
  entries: TranscriptEntry[];
  next_cursor: string | null;
  limit: number;
}

interface RunGroupDashboardPage {
  runGroup: RunGroup;
  summaries: RunGroupSessionSummary[];
  next_cursor: string | null;
  limit: number;
}

interface SessionDetail {
  session: WorkerSession;
  task_spec: TaskSpecMetadata | null;
}

type DetailMode = "session" | "run_group";

interface LoadDetailOptions {
  transcriptCursor: TranscriptCursor;
  rawItemType: ItemType | "all";
  rawItemAfter: number | null;
  includeRawItems: boolean;
}

const API_BASE = (
  import.meta.env.VITE_CODEXHUB_API ?? "http://127.0.0.1:4317"
).replace(/\/+$/, "");
const ITEM_TYPES: Array<ItemType | "all"> = [
  "all",
  "agentmessage",
  "toolcall",
  "toolresult",
  "error",
  "state",
  "reasoning",
  "raw",
];
const VISIBLE_TRANSCRIPT_LIMIT = 50;
const TRANSCRIPT_FETCH_LIMIT = 100;
const ITEM_PAGE_LIMIT = 50;
const RUN_GROUP_SESSION_LIMIT = 50;

class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function listFrom<T>(body: unknown, key: string): T[] {
  if (Array.isArray(body)) return body as T[];
  if (!isObject(body)) return [];
  const items = body.items;
  if (Array.isArray(items)) return items as T[];
  const keyed = body[key];
  if (Array.isArray(keyed)) return keyed as T[];
  return [];
}

function entityFrom<T>(body: unknown, key: string): T {
  if (isObject(body) && isObject(body[key])) return body[key] as T;
  return body as T;
}

function queryString(
  params: Record<string, string | number | boolean | null | undefined>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "")
      query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    const errorBody = isObject(body) && isObject(body.error) ? body.error : {};
    const code =
      isObject(errorBody) && typeof errorBody.code === "string"
        ? errorBody.code
        : null;
    const detail =
      isObject(body) && typeof body.message === "string"
        ? body.message
        : isObject(errorBody) && typeof errorBody.message === "string"
          ? errorBody.message
          : response.statusText;
    throw new ApiError(
      `${response.status}${code ? ` ${code}:` : ""} ${detail}`.trim(),
      response.status,
    );
  }

  return body as T;
}

async function withFallback<T>(
  primary: () => Promise<T>,
  fallback: () => Promise<T>,
): Promise<T> {
  try {
    return await primary();
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return fallback();
    throw error;
  }
}

async function fetchProjects(): Promise<Project[]> {
  const body = await request<unknown>("/projects");
  return listFrom<Project>(body, "projects");
}

async function fetchWorkspaces(projectId: ID): Promise<Workspace[]> {
  const body = await request<unknown>(
    `/workspaces${queryString({ project_id: projectId })}`,
  );
  return listFrom<Workspace>(body, "workspaces");
}

async function fetchSessions(projectId: ID): Promise<WorkerSession[]> {
  const nestedPath = `/projects/${encodeURIComponent(projectId)}/sessions${queryString({ limit: 100 })}`;
  const flatPath = `/sessions${queryString({ project_id: projectId, limit: 100 })}`;
  const body = await withFallback(
    () => request<unknown>(nestedPath),
    () => request<unknown>(flatPath),
  );
  return listFrom<WorkerSession>(body, "sessions");
}

async function fetchRunGroups(projectId: ID): Promise<RunGroup[]> {
  const body = await request<unknown>(
    `/run-groups${queryString({ project_id: projectId })}`,
  );
  return listFrom<RunGroup>(body, "run_groups");
}

async function fetchRunGroupDashboard(
  runGroupId: ID,
  cursor: string | null,
): Promise<RunGroupDashboardPage> {
  const body = await request<RunGroupDashboardResponse>(
    `/run-groups/${encodeURIComponent(runGroupId)}/dashboard${queryString({
      limit: RUN_GROUP_SESSION_LIMIT,
      cursor,
    })}`,
  );
  return {
    runGroup: body.run_group,
    summaries: body.session_summaries ?? body.items ?? [],
    next_cursor: body.next_cursor,
    limit: body.limit,
  };
}

async function fetchSession(sessionId: ID): Promise<SessionDetail> {
  const body = await request<unknown>(
    `/sessions/${encodeURIComponent(sessionId)}`,
  );
  return {
    session: entityFrom<WorkerSession>(body, "session"),
    task_spec:
      isObject(body) && isObject(body.task_spec)
        ? (body.task_spec as unknown as TaskSpecMetadata)
        : null,
  };
}

async function fetchTranscript(
  sessionId: ID,
  cursor: TranscriptCursor,
): Promise<TranscriptPage> {
  const query = queryString({
    limit: TRANSCRIPT_FETCH_LIMIT,
    after_sequence: cursor.recent ? null : cursor.afterSequence,
    recent: cursor.recent ? true : null,
  });
  const nestedPath = `/sessions/${encodeURIComponent(sessionId)}/transcript${query}`;
  const flatPath = `/transcript${queryString({
    session_id: sessionId,
    limit: TRANSCRIPT_FETCH_LIMIT,
    after_sequence: cursor.recent ? null : cursor.afterSequence,
    recent: cursor.recent ? true : null,
  })}`;
  const body = await withFallback(
    () => request<unknown>(nestedPath),
    () => request<unknown>(flatPath),
  );
  return {
    entries: listFrom<TranscriptEntry>(body, "transcript"),
    next_cursor:
      isObject(body) && typeof body.next_cursor === "string"
        ? body.next_cursor
        : null,
    limit:
      isObject(body) && typeof body.limit === "number"
        ? body.limit
        : TRANSCRIPT_FETCH_LIMIT,
  };
}

async function fetchItems(
  sessionId: ID,
  type: ItemType | "all",
  afterSequence: number | null,
): Promise<ItemPage> {
  const query = queryString({
    limit: ITEM_PAGE_LIMIT,
    type: type === "all" ? null : type,
    after_sequence: afterSequence,
  });
  const nestedPath = `/sessions/${encodeURIComponent(sessionId)}/items${query}`;
  const flatPath = `/items${queryString({
    session_id: sessionId,
    limit: ITEM_PAGE_LIMIT,
    type: type === "all" ? null : type,
    after_sequence: afterSequence,
  })}`;
  const body = await withFallback(
    () => request<unknown>(nestedPath),
    () => request<unknown>(flatPath),
  );
  return {
    items: listFrom<Item>(body, "items"),
    next_cursor:
      isObject(body) && typeof body.next_cursor === "string"
        ? body.next_cursor
        : null,
    limit:
      isObject(body) && typeof body.limit === "number"
        ? body.limit
        : ITEM_PAGE_LIMIT,
    type: isObject(body) && typeof body.type === "string" ? body.type : type,
  };
}

async function sendMessage(
  sessionId: ID,
  mode: SendMessageMode,
  content: string,
): Promise<void> {
  await request<unknown>(
    `/sessions/${encodeURIComponent(sessionId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        mode,
        content,
        sender_type: "human",
      }),
    },
  );
}

async function updateSessionState(
  sessionId: ID,
  action: "stop" | "complete",
): Promise<void> {
  await request<unknown>(
    `/sessions/${encodeURIComponent(sessionId)}/${action}`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}

async function startSession(
  projectId: ID,
  draft: SessionDraft,
): Promise<WorkerSession> {
  const body = await request<unknown>("/sessions", {
    method: "POST",
    body: JSON.stringify(buildStartSessionRequest(projectId, draft)),
  });
  return entityFrom<WorkerSession>(body, "session");
}

async function startFollowUpSession(
  previousSessionId: ID,
  draft: SessionDraft,
): Promise<WorkerSession> {
  const body = await request<unknown>(
    `/sessions/${encodeURIComponent(previousSessionId)}/follow-up`,
    {
      method: "POST",
      body: JSON.stringify(buildFollowUpSessionRequest(draft)),
    },
  );
  return entityFrom<WorkerSession>(body, "session");
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function shortId(value: string | null | undefined): string {
  if (!value) return "-";
  return value.length > 10 ? value.slice(0, 10) : value;
}

function compactText(
  value: string | null | undefined,
  fallback = "No message yet.",
): string {
  const text = value?.trim();
  return text ? text : fallback;
}

function statusClass(status: WorkerSessionStatus): string {
  return `status status-${status.replace("_", "-")}`;
}

function statusLabel(status: WorkerSessionStatus): string {
  return status.replace("_", " ");
}

function attentionClass(label: string): string {
  return `attention-badge attention-${label.toLowerCase().replaceAll(" ", "-")}`;
}

function workspaceLabel(workspace: Workspace): string {
  const status =
    workspace.status === "ready"
      ? ""
      : ` (${workspace.status.replace("_", " ")})`;
  const branch = workspace.branch ? ` @ ${workspace.branch}` : "";
  return `${shortId(workspace.id)}${branch}${status} - ${workspace.cwd}`;
}

function preferredWorkspaceId(
  workspaces: Workspace[],
  current: string,
  fallback?: string | null,
): string {
  if (current && workspaces.some((workspace) => workspace.id === current)) {
    return current;
  }
  if (fallback && workspaces.some((workspace) => workspace.id === fallback)) {
    return fallback;
  }
  return (
    workspaces.find((workspace) => workspace.status === "ready")?.id ??
    workspaces[0]?.id ??
    ""
  );
}

function displayJson(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "No renderable payload.";
  }
}

function messageTitle(mode: MessageMode | null): string {
  if (mode === "initial") return "Initial Prompt";
  if (mode === "continue") return "Continue";
  if (mode === "steer") return "Steer";
  return "Message";
}

function itemTypeTitle(type: ItemType | null): string {
  if (type === "toolcall") return "Tool Call";
  if (type === "toolresult") return "Tool Result";
  if (type === "reasoning") return "Reasoning";
  if (type === "error") return "Error";
  if (type === "state") return "State";
  if (type === "agentmessage") return "Agent Message Item";
  if (type === "raw") return "Raw Item";
  return "Debug";
}

function itemTitle(item: Item): string {
  if (item.type === "raw") return "Raw Item";
  return itemTypeTitle(item.type);
}

function transcriptTitle(entry: TranscriptEntry): string {
  if (entry.kind === "message") return messageTitle(entry.message_mode);
  if (entry.kind === "agent_message") return "Agent";
  if (entry.kind === "tool") return itemTypeTitle(entry.item_type);
  return itemTypeTitle(entry.item_type);
}

function transcriptClass(entry: TranscriptEntry): string {
  if (entry.kind === "message") return "transcript-message";
  if (entry.kind === "agent_message") return "transcript-agent";
  if (entry.kind === "tool") {
    return entry.item_type === "toolresult"
      ? "transcript-toolresult"
      : "transcript-toolcall";
  }
  return `transcript-${entry.item_type ?? "debug"}`;
}

function truncateSummary(value: string | null | undefined): string | null {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > 220 ? `${text.slice(0, 220)}...` : text;
}

function transcriptSummary(entry: TranscriptEntry): string {
  const text = truncateSummary(entry.text);
  if (text) return text;
  const parts = [
    entry.codex_method,
    entry.codex_item_type,
    entry.codex_item_id ? `id ${shortId(entry.codex_item_id)}` : null,
  ].filter(Boolean);
  return parts.join(" - ") || "No transcript text.";
}

function itemSummary(item: Item): string {
  const parts = [
    item.codex_method,
    item.codex_item_type,
    item.codex_item_id ? `id ${shortId(item.codex_item_id)}` : null,
  ].filter(Boolean);
  const summary = parts.join(" - ") || "No summary.";
  return summary.length > 220 ? `${summary.slice(0, 220)}...` : summary;
}

function sequenceRangeLabel(values: number[]): string {
  if (values.length === 0) return "no raw items";
  const sorted = [...values].sort((a, b) => a - b);
  const first = sorted[0] ?? 0;
  const last = sorted[sorted.length - 1] ?? first;
  if (first === last) return `item #${first}`;
  return `items #${first}-${last} (${sorted.length})`;
}

function transcriptWindowLabel(
  entries: TranscriptEntry[],
  cursor: TranscriptCursor,
): string {
  const prefix = cursor.recent ? "recent " : "";
  if (entries.length === 0)
    return cursor.recent
      ? "recent entries"
      : `after entry #${cursor.afterSequence ?? 0}`;
  const first = entries[0]?.sequence ?? cursor.afterSequence ?? 0;
  const last = entries[entries.length - 1]?.sequence ?? first;
  return first === last
    ? `${prefix}entry #${first}`
    : `${prefix}entries #${first}-${last}`;
}

function itemWindowLabel(items: Item[], afterSequence: number | null): string {
  if (items.length === 0) return `after #${afterSequence ?? 0}`;
  const first = items[0]?.sequence ?? afterSequence ?? 0;
  const last = items[items.length - 1]?.sequence ?? first;
  return first === last ? `#${first}` : `#${first}-${last}`;
}

function transcriptMetadata(entry: TranscriptEntry): Record<string, unknown> {
  return {
    source: entry.source,
    source_id: entry.source_id,
    role: entry.role,
    codex_method: entry.codex_method,
    codex_item_id: entry.codex_item_id,
    codex_item_type: entry.codex_item_type,
    item_ids: entry.item_ids,
    item_sequences: entry.item_sequences,
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function TranscriptMetadataDetails({ entry }: { entry: TranscriptEntry }) {
  return (
    <details className="payload-details">
      <summary>Transcript metadata</summary>
      <pre>{displayJson(transcriptMetadata(entry))}</pre>
    </details>
  );
}

interface SessionDraftFormProps {
  idPrefix: string;
  draft: SessionDraft;
  workspaces: Workspace[];
  disabled: boolean;
  submitting: boolean;
  submitDisabled: boolean;
  submitLabel: string;
  submittingLabel: string;
  validationMessages: string[];
  error: string | null;
  onDraftChange: (draft: SessionDraft) => void;
  onSubmit: () => Promise<void>;
}

function SessionDraftForm({
  idPrefix,
  draft,
  workspaces,
  disabled,
  submitting,
  submitDisabled,
  submitLabel,
  submittingLabel,
  validationMessages,
  error,
  onDraftChange,
  onSubmit,
}: SessionDraftFormProps) {
  const fieldId = (name: string) => `${idPrefix}-${name}`;
  const setDraftField = (field: keyof SessionDraft, value: string) => {
    onDraftChange({ ...draft, [field]: value });
  };

  return (
    <form
      className="session-draft-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!submitDisabled) void onSubmit();
      }}
    >
      <label className="field" htmlFor={fieldId("workspace")}>
        <span>Workspace</span>
        <select
          id={fieldId("workspace")}
          value={draft.workspaceId}
          onChange={(event) => setDraftField("workspaceId", event.target.value)}
          disabled={disabled || workspaces.length === 0}
        >
          <option value="">Select workspace</option>
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspaceLabel(workspace)}
            </option>
          ))}
        </select>
      </label>

      <label className="field" htmlFor={fieldId("prompt")}>
        <span>Initial prompt</span>
        <textarea
          id={fieldId("prompt")}
          value={draft.prompt}
          onChange={(event) => setDraftField("prompt", event.target.value)}
          placeholder="Describe the work for the worker..."
          rows={3}
          disabled={disabled}
        />
      </label>

      <details className="task-spec-fields">
        <summary>Task spec fields</summary>
        <div className="field-grid">
          <label className="field" htmlFor={fieldId("task-ref")}>
            <span>Ref</span>
            <input
              id={fieldId("task-ref")}
              type="text"
              value={draft.taskRef}
              onChange={(event) => setDraftField("taskRef", event.target.value)}
              disabled={disabled}
            />
          </label>
          <label className="field" htmlFor={fieldId("task-title")}>
            <span>Title</span>
            <input
              id={fieldId("task-title")}
              type="text"
              value={draft.taskTitle}
              onChange={(event) =>
                setDraftField("taskTitle", event.target.value)
              }
              disabled={disabled}
            />
          </label>
          <label className="field field-wide" htmlFor={fieldId("task-intent")}>
            <span>Intent</span>
            <textarea
              id={fieldId("task-intent")}
              value={draft.taskIntent}
              onChange={(event) =>
                setDraftField("taskIntent", event.target.value)
              }
              rows={2}
              disabled={disabled}
            />
          </label>
          <label className="field field-wide" htmlFor={fieldId("task-scope")}>
            <span>Scope</span>
            <textarea
              id={fieldId("task-scope")}
              value={draft.taskScope}
              onChange={(event) =>
                setDraftField("taskScope", event.target.value)
              }
              rows={2}
              disabled={disabled}
            />
          </label>
          <label
            className="field field-wide"
            htmlFor={fieldId("task-acceptance")}
          >
            <span>Acceptance</span>
            <textarea
              id={fieldId("task-acceptance")}
              value={draft.taskAcceptance}
              onChange={(event) =>
                setDraftField("taskAcceptance", event.target.value)
              }
              rows={2}
              disabled={disabled}
            />
          </label>
        </div>
      </details>

      <div className="action-row form-action-row">
        <button
          className="button"
          type="submit"
          disabled={disabled || submitDisabled}
        >
          {submitting ? submittingLabel : submitLabel}
        </button>
      </div>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {validationMessages.length > 0 ? (
        <ul className="form-help">
          {validationMessages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}

interface RunGroupDashboardProps {
  runGroup: RunGroup;
  summaries: RunGroupSessionSummary[];
  counts: ReturnType<typeof runGroupDashboardCounts>;
  loading: boolean;
  nextCursor: string | null;
  historyLength: number;
  onNext: () => Promise<void>;
  onPrevious: () => Promise<void>;
  onOpenSession: (sessionId: ID) => void;
}

function RunGroupDashboard({
  runGroup,
  summaries,
  counts,
  loading,
  nextCursor,
  historyLength,
  onNext,
  onPrevious,
  onOpenSession,
}: RunGroupDashboardProps) {
  return (
    <>
      <div className="session-context">
        <section className="run-group-summary-strip" aria-label="Run group">
          <div className="task-title">
            <span className="label">Run Group</span>
            <strong>{runGroup.name}</strong>
            <p className="run-group-purpose">
              {compactText(runGroup.purpose, "No purpose recorded.")}
            </p>
          </div>
          <dl className="run-group-metrics">
            <div>
              <dt>Shown</dt>
              <dd>{counts.total}</dd>
            </div>
            <div>
              <dt>Attention</dt>
              <dd>{counts.attention}</dd>
            </div>
            <div>
              <dt>Failed</dt>
              <dd>{counts.failed}</dd>
            </div>
            <div>
              <dt>Awaiting</dt>
              <dd>{counts.awaitingInput}</dd>
            </div>
            <div>
              <dt>Review</dt>
              <dd>{counts.reviewNeeded}</dd>
            </div>
            <div>
              <dt>Findings</dt>
              <dd>{counts.openReviewFindings}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section
        className="run-group-dashboard-shell"
        aria-label="Run group dashboard"
      >
        <div className="section-heading conversation-heading">
          <div>
            <h3>Batch Dashboard</h3>
            <p>
              Showing {summaries.length} session
              {summaries.length === 1 ? "" : "s"}; page limit{" "}
              {RUN_GROUP_SESSION_LIMIT}
            </p>
          </div>
          <div className="item-controls">
            <button
              className="button button-secondary button-compact"
              type="button"
              onClick={() => void onPrevious()}
              disabled={loading || historyLength === 0}
            >
              Previous
            </button>
            <button
              className="button button-secondary button-compact"
              type="button"
              onClick={() => void onNext()}
              disabled={loading || nextCursor === null}
            >
              Next
            </button>
          </div>
        </div>

        <div className="run-group-session-list" aria-busy={loading}>
          {summaries.map((summary) => {
            const labels = attentionLabels(summary);
            return (
              <article
                className={`run-group-session-card ${summary.attention_required ? "needs-attention" : ""}`}
                key={summary.session.id}
              >
                <div className="run-group-card-topline">
                  <div>
                    <strong>{shortId(summary.session.id)}</strong>
                    <span className={statusClass(summary.session.status)}>
                      {statusLabel(summary.session.status)}
                    </span>
                  </div>
                  <div className="attention-list">
                    {labels.length > 0 ? (
                      labels.map((label) => (
                        <span className={attentionClass(label)} key={label}>
                          {label}
                        </span>
                      ))
                    ) : (
                      <span className="attention-badge attention-clear">
                        Clear
                      </span>
                    )}
                  </div>
                </div>
                <p className="run-group-latest">
                  {compactText(summary.session.last_agent_message)}
                </p>
                <dl className="run-group-session-meta">
                  <div>
                    <dt>Review</dt>
                    <dd>{reviewStateLabel(summary)}</dd>
                  </div>
                  <div>
                    <dt>Findings</dt>
                    <dd>
                      {summary.open_review_finding_count}/
                      {summary.review_finding_count}
                    </dd>
                  </div>
                  <div>
                    <dt>Items</dt>
                    <dd>{summary.session.last_item_sequence}</dd>
                  </div>
                  <div>
                    <dt>Updated</dt>
                    <dd>{formatDate(summary.session.updated_at)}</dd>
                  </div>
                </dl>
                {summary.session.failure_reason ? (
                  <p className="run-group-failure">
                    {summary.session.failure_reason}
                  </p>
                ) : null}
                <div className="action-row run-group-card-actions">
                  <button
                    className="button button-secondary button-compact"
                    type="button"
                    onClick={() => onOpenSession(summary.session.id)}
                  >
                    Open Session
                  </button>
                </div>
              </article>
            );
          })}
          {!loading && summaries.length === 0 ? (
            <p className="empty">No sessions in this run group page.</p>
          ) : null}
        </div>
      </section>
    </>
  );
}

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<ID | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [sessions, setSessions] = useState<WorkerSession[]>([]);
  const [runGroups, setRunGroups] = useState<RunGroup[]>([]);
  const [selectedRunGroupId, setSelectedRunGroupId] = useState<ID | null>(null);
  const [runGroupSummaries, setRunGroupSummaries] = useState<
    RunGroupSessionSummary[]
  >([]);
  const [runGroupCursor, setRunGroupCursor] = useState<string | null>(null);
  const [runGroupHistory, setRunGroupHistory] = useState<Array<string | null>>(
    [],
  );
  const [runGroupNextCursor, setRunGroupNextCursor] = useState<string | null>(
    null,
  );
  const [runGroupDetail, setRunGroupDetail] =
    useState<RunGroupDashboardPage | null>(null);
  const [activeDetail, setActiveDetail] = useState<DetailMode>("session");
  const [selectedSessionId, setSelectedSessionId] = useState<ID | null>(null);
  const [selectedSession, setSelectedSession] = useState<WorkerSession | null>(
    null,
  );
  const [taskSpec, setTaskSpec] = useState<TaskSpecMetadata | null>(null);
  const [transcriptEntries, setTranscriptEntries] = useState<TranscriptEntry[]>(
    [],
  );
  const [transcriptCursor, setTranscriptCursor] = useState<TranscriptCursor>(
    RECENT_TRANSCRIPT_CURSOR,
  );
  const [transcriptHistory, setTranscriptHistory] = useState<
    TranscriptCursor[]
  >([]);
  const [transcriptNextCursor, setTranscriptNextCursor] = useState<
    string | null
  >(null);
  const [showRawItems, setShowRawItems] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [itemAfter, setItemAfter] = useState<number | null>(null);
  const [itemHistory, setItemHistory] = useState<number[]>([]);
  const [itemNextCursor, setItemNextCursor] = useState<string | null>(null);
  const [itemType, setItemType] = useState<ItemType | "all">("all");
  const [message, setMessage] = useState("");
  const [createDraft, setCreateDraft] = useState<SessionDraft>(() =>
    createEmptySessionDraft(),
  );
  const [followUpDraft, setFollowUpDraft] = useState<SessionDraft>(() =>
    createEmptySessionDraft(),
  );
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingRunGroups, setLoadingRunGroups] = useState(false);
  const [loadingRunGroupDetail, setLoadingRunGroupDetail] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [submitting, setSubmitting] = useState<SessionAction | null>(null);
  const [submittingStart, setSubmittingStart] = useState(false);
  const [submittingFollowUp, setSubmittingFollowUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createSessionError, setCreateSessionError] = useState<string | null>(
    null,
  );
  const [followUpError, setFollowUpError] = useState<string | null>(null);
  const actionAvailability = selectedSession
    ? getSessionActionAvailability({
        status: selectedSession.status,
        message,
        submitting,
      })
    : null;
  const disabledActions = actionAvailability
    ? SESSION_ACTIONS.filter((action) => actionAvailability[action].disabled)
    : [];
  const actionHelpId =
    disabledActions.length > 0 ? "session-action-help" : undefined;
  const followUpAvailable =
    selectedSession !== null &&
    canStartFollowUpFromStatus(selectedSession.status);
  const createValidationMessages = [
    ...(selectedProjectId ? [] : ["Select a project."]),
    ...validateSessionDraft(createDraft, { requireWorkspace: true }),
  ];
  const followUpValidationMessages =
    selectedSession && followUpAvailable
      ? validateSessionDraft(followUpDraft, { requireWorkspace: true })
      : [];
  const createSubmitDisabled =
    submittingStart || loadingWorkspaces || createValidationMessages.length > 0;
  const followUpSubmitDisabled =
    submittingFollowUp ||
    loadingWorkspaces ||
    !followUpAvailable ||
    followUpValidationMessages.length > 0;

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const selectedRunGroup = useMemo(
    () =>
      runGroupDetail?.runGroup ??
      runGroups.find((runGroup) => runGroup.id === selectedRunGroupId) ??
      null,
    [runGroupDetail, runGroups, selectedRunGroupId],
  );
  const runGroupCounts = useMemo(
    () => runGroupDashboardCounts(runGroupSummaries),
    [runGroupSummaries],
  );

  const conversationTranscriptEntries = useMemo(
    () => conversationWindow(transcriptEntries, VISIBLE_TRANSCRIPT_LIMIT),
    [transcriptEntries],
  );

  const previousTranscriptCursor = useMemo(() => {
    const firstSequence = transcriptEntries[0]?.sequence;
    if (firstSequence === undefined || firstSequence <= 1) return null;
    return {
      afterSequence: Math.max(0, firstSequence - TRANSCRIPT_FETCH_LIMIT - 1),
      recent: false,
    };
  }, [transcriptEntries]);

  const canLoadPreviousTranscript =
    transcriptHistory.length > 0 || previousTranscriptCursor !== null;

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true);
    setError(null);
    try {
      const nextProjects = await fetchProjects();
      setProjects(nextProjects);
      setSelectedProjectId((current) => {
        if (current && nextProjects.some((project) => project.id === current))
          return current;
        return nextProjects[0]?.id ?? null;
      });
    } catch (loadError) {
      setProjects([]);
      setSelectedProjectId(null);
      setError(`Projects: ${getErrorMessage(loadError)}`);
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  const loadWorkspaces = useCallback(async (projectId: ID) => {
    setLoadingWorkspaces(true);
    setError(null);
    try {
      const nextWorkspaces = await fetchWorkspaces(projectId);
      setWorkspaces(nextWorkspaces);
      setCreateDraft((current) => ({
        ...current,
        workspaceId: preferredWorkspaceId(nextWorkspaces, current.workspaceId),
      }));
      setFollowUpDraft((current) => ({
        ...current,
        workspaceId: preferredWorkspaceId(nextWorkspaces, current.workspaceId),
      }));
    } catch (loadError) {
      setWorkspaces([]);
      setCreateDraft((current) => ({ ...current, workspaceId: "" }));
      setFollowUpDraft((current) => ({ ...current, workspaceId: "" }));
      setError(`Workspaces: ${getErrorMessage(loadError)}`);
    } finally {
      setLoadingWorkspaces(false);
    }
  }, []);

  const loadSessions = useCallback(async (projectId: ID) => {
    setLoadingSessions(true);
    setError(null);
    try {
      const nextSessions = await fetchSessions(projectId);
      setSessions(nextSessions);
      setSelectedSessionId((current) => {
        if (current && nextSessions.some((session) => session.id === current))
          return current;
        return nextSessions[0]?.id ?? null;
      });
    } catch (loadError) {
      setSessions([]);
      setSelectedSessionId(null);
      setError(`Sessions: ${getErrorMessage(loadError)}`);
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  const loadRunGroups = useCallback(async (projectId: ID) => {
    setLoadingRunGroups(true);
    setError(null);
    try {
      const nextRunGroups = await fetchRunGroups(projectId);
      setRunGroups(nextRunGroups);
      setSelectedRunGroupId((current) => {
        if (
          current &&
          nextRunGroups.some((runGroup) => runGroup.id === current)
        ) {
          return current;
        }
        return nextRunGroups[0]?.id ?? null;
      });
    } catch (loadError) {
      setRunGroups([]);
      setSelectedRunGroupId(null);
      setRunGroupDetail(null);
      setRunGroupSummaries([]);
      setRunGroupNextCursor(null);
      setError(`Run groups: ${getErrorMessage(loadError)}`);
    } finally {
      setLoadingRunGroups(false);
    }
  }, []);

  const loadRunGroupDetail = useCallback(
    async (runGroupId: ID, cursor: string | null) => {
      setLoadingRunGroupDetail(true);
      setError(null);
      try {
        const nextDetail = await fetchRunGroupDashboard(runGroupId, cursor);
        setRunGroupDetail(nextDetail);
        setRunGroupSummaries(nextDetail.summaries);
        setRunGroupNextCursor(nextDetail.next_cursor);
      } catch (loadError) {
        setRunGroupDetail(null);
        setRunGroupSummaries([]);
        setRunGroupNextCursor(null);
        setError(`Run group detail: ${getErrorMessage(loadError)}`);
      } finally {
        setLoadingRunGroupDetail(false);
      }
    },
    [],
  );

  const loadDetail = useCallback(
    async (sessionId: ID, options: LoadDetailOptions) => {
      setLoadingDetail(true);
      setError(null);
      try {
        const rawItemsPromise = options.includeRawItems
          ? fetchItems(sessionId, options.rawItemType, options.rawItemAfter)
          : Promise.resolve<ItemPage | null>(null);
        const [nextSessionDetail, nextTranscriptPage, nextItemPage] =
          await Promise.all([
            fetchSession(sessionId),
            fetchTranscript(sessionId, options.transcriptCursor),
            rawItemsPromise,
          ]);
        setSelectedSession(nextSessionDetail.session);
        setTaskSpec(nextSessionDetail.task_spec);
        setTranscriptEntries(nextTranscriptPage.entries);
        setTranscriptNextCursor(nextTranscriptPage.next_cursor);
        setItems(nextItemPage?.items ?? []);
        setItemNextCursor(nextItemPage?.next_cursor ?? null);
      } catch (loadError) {
        setSelectedSession(null);
        setTaskSpec(null);
        setTranscriptEntries([]);
        setTranscriptNextCursor(null);
        setItems([]);
        setItemNextCursor(null);
        setError(`Session detail: ${getErrorMessage(loadError)}`);
      } finally {
        setLoadingDetail(false);
      }
    },
    [],
  );

  const refreshCurrent = useCallback(async () => {
    if (selectedProjectId) {
      await Promise.all([
        loadSessions(selectedProjectId),
        loadRunGroups(selectedProjectId),
      ]);
    }
    if (selectedSessionId)
      await loadDetail(selectedSessionId, {
        transcriptCursor,
        rawItemType: itemType,
        rawItemAfter: itemAfter,
        includeRawItems: showRawItems,
      });
    if (selectedRunGroupId)
      await loadRunGroupDetail(selectedRunGroupId, runGroupCursor);
  }, [
    itemAfter,
    itemType,
    loadDetail,
    loadRunGroupDetail,
    loadRunGroups,
    loadSessions,
    runGroupCursor,
    selectedProjectId,
    selectedRunGroupId,
    selectedSessionId,
    showRawItems,
    transcriptCursor,
  ]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (!selectedProjectId) {
      setWorkspaces([]);
      setSessions([]);
      setRunGroups([]);
      setSelectedSessionId(null);
      setSelectedRunGroupId(null);
      setRunGroupDetail(null);
      setRunGroupSummaries([]);
      setRunGroupCursor(null);
      setRunGroupHistory([]);
      setRunGroupNextCursor(null);
      setActiveDetail("session");
      setCreateDraft((current) => ({ ...current, workspaceId: "" }));
      setFollowUpDraft((current) => ({ ...current, workspaceId: "" }));
      return;
    }
    void loadWorkspaces(selectedProjectId);
    void loadSessions(selectedProjectId);
    void loadRunGroups(selectedProjectId);
  }, [loadRunGroups, loadSessions, loadWorkspaces, selectedProjectId]);

  useEffect(() => {
    setFollowUpDraft((current) => ({
      ...current,
      workspaceId: preferredWorkspaceId(
        workspaces,
        current.workspaceId,
        selectedSession?.workspace_id,
      ),
    }));
  }, [selectedSession?.workspace_id, workspaces]);

  useEffect(() => {
    if (!selectedSessionId) {
      setSelectedSession(null);
      setTaskSpec(null);
      setTranscriptEntries([]);
      setTranscriptCursor(RECENT_TRANSCRIPT_CURSOR);
      setTranscriptHistory([]);
      setTranscriptNextCursor(null);
      setItems([]);
      setItemAfter(null);
      setItemHistory([]);
      setItemNextCursor(null);
      return;
    }
    setTranscriptCursor(RECENT_TRANSCRIPT_CURSOR);
    setTranscriptHistory([]);
    setItemAfter(null);
    setItemHistory([]);
    void loadDetail(selectedSessionId, {
      transcriptCursor: RECENT_TRANSCRIPT_CURSOR,
      rawItemType: itemType,
      rawItemAfter: null,
      includeRawItems: showRawItems,
    });
  }, [itemType, loadDetail, selectedSessionId, showRawItems]);

  useEffect(() => {
    if (!selectedRunGroupId) {
      setRunGroupDetail(null);
      setRunGroupSummaries([]);
      setRunGroupCursor(null);
      setRunGroupHistory([]);
      setRunGroupNextCursor(null);
      return;
    }
    setRunGroupCursor(null);
    setRunGroupHistory([]);
    void loadRunGroupDetail(selectedRunGroupId, null);
  }, [loadRunGroupDetail, selectedRunGroupId]);

  useEffect(() => {
    setFollowUpDraft(
      createEmptySessionDraft(
        preferredWorkspaceId(workspaces, "", selectedSession?.workspace_id),
      ),
    );
    setFollowUpError(null);
  }, [selectedSession?.id]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshCurrent();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [refreshCurrent]);

  async function handleSend(mode: SendMessageMode) {
    if (!selectedSession) return;
    const content = message.trim();
    const availability = getSessionActionAvailability({
      status: selectedSession.status,
      message: content,
      submitting,
    })[mode];
    if (availability.disabled) return;
    setSubmitting(mode);
    setError(null);
    try {
      await sendMessage(selectedSession.id, mode, content);
      setMessage("");
      await refreshCurrent();
    } catch (sendError) {
      setError(`${mode}: ${getErrorMessage(sendError)}`);
    } finally {
      setSubmitting(null);
    }
  }

  async function handleAction(action: "stop" | "complete") {
    if (!selectedSession) return;
    const availability = getSessionActionAvailability({
      status: selectedSession.status,
      message,
      submitting,
    })[action];
    if (availability.disabled) return;
    setSubmitting(action);
    setError(null);
    try {
      await updateSessionState(selectedSession.id, action);
      await refreshCurrent();
    } catch (actionError) {
      setError(`${action}: ${getErrorMessage(actionError)}`);
    } finally {
      setSubmitting(null);
    }
  }

  async function handleStartSession() {
    if (!selectedProjectId || createSubmitDisabled) return;
    setSubmittingStart(true);
    setCreateSessionError(null);
    setError(null);
    try {
      const nextSession = await startSession(selectedProjectId, createDraft);
      setCreateDraft(createEmptySessionDraft(createDraft.workspaceId));
      await loadSessions(selectedProjectId);
      setSelectedSessionId(nextSession.id);
      setActiveDetail("session");
    } catch (startError) {
      setCreateSessionError(
        `Start session failed: ${getErrorMessage(startError)}`,
      );
    } finally {
      setSubmittingStart(false);
    }
  }

  async function handleStartFollowUp() {
    if (!selectedSession || followUpSubmitDisabled) return;
    setSubmittingFollowUp(true);
    setFollowUpError(null);
    setError(null);
    try {
      const nextSession = await startFollowUpSession(
        selectedSession.id,
        followUpDraft,
      );
      setFollowUpDraft(createEmptySessionDraft(followUpDraft.workspaceId));
      if (selectedProjectId) await loadSessions(selectedProjectId);
      setSelectedSessionId(nextSession.id);
      setActiveDetail("session");
    } catch (startError) {
      setFollowUpError(
        `Start follow-up failed: ${getErrorMessage(startError)}`,
      );
    } finally {
      setSubmittingFollowUp(false);
    }
  }

  async function handleNextRunGroupSessions() {
    if (!selectedRunGroupId || runGroupNextCursor === null) return;
    const nextCursor = runGroupNextCursor;
    setRunGroupHistory((current) => [...current, runGroupCursor]);
    setRunGroupCursor(nextCursor);
    await loadRunGroupDetail(selectedRunGroupId, nextCursor);
  }

  async function handlePreviousRunGroupSessions() {
    if (!selectedRunGroupId || runGroupHistory.length === 0) return;
    const previousHistory = runGroupHistory.slice(0, -1);
    const previousCursor = runGroupHistory[runGroupHistory.length - 1] ?? null;
    setRunGroupHistory(previousHistory);
    setRunGroupCursor(previousCursor);
    await loadRunGroupDetail(selectedRunGroupId, previousCursor);
  }

  async function handleNextTranscript() {
    if (!selectedSession || transcriptNextCursor === null) return;
    const nextAfter = Number(transcriptNextCursor);
    if (!Number.isInteger(nextAfter)) return;
    const nextCursor = { afterSequence: nextAfter, recent: false };
    setTranscriptHistory((current) => [...current, transcriptCursor]);
    setTranscriptCursor(nextCursor);
    await loadDetail(selectedSession.id, {
      transcriptCursor: nextCursor,
      rawItemType: itemType,
      rawItemAfter: itemAfter,
      includeRawItems: showRawItems,
    });
  }

  async function handlePreviousTranscript() {
    if (!selectedSession) return;
    const previousHistory = transcriptHistory.slice(0, -1);
    const previousCursor =
      transcriptHistory[transcriptHistory.length - 1] ??
      previousTranscriptCursor;
    if (!previousCursor) return;
    setTranscriptHistory(previousHistory);
    setTranscriptCursor(previousCursor);
    await loadDetail(selectedSession.id, {
      transcriptCursor: previousCursor,
      rawItemType: itemType,
      rawItemAfter: itemAfter,
      includeRawItems: showRawItems,
    });
  }

  async function handleNextItems() {
    if (!selectedSession || itemNextCursor === null) return;
    const nextAfter = Number(itemNextCursor);
    if (!Number.isInteger(nextAfter)) return;
    setItemHistory((current) => [...current, itemAfter ?? 0]);
    setItemAfter(nextAfter);
    await loadDetail(selectedSession.id, {
      transcriptCursor,
      rawItemType: itemType,
      rawItemAfter: nextAfter,
      includeRawItems: showRawItems,
    });
  }

  async function handlePreviousItems() {
    if (!selectedSession || itemHistory.length === 0) return;
    const previousHistory = itemHistory.slice(0, -1);
    const previousAfter = itemHistory[itemHistory.length - 1] ?? 0;
    setItemHistory(previousHistory);
    setItemAfter(previousAfter === 0 ? null : previousAfter);
    await loadDetail(selectedSession.id, {
      transcriptCursor,
      rawItemType: itemType,
      rawItemAfter: previousAfter === 0 ? null : previousAfter,
      includeRawItems: showRawItems,
    });
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>Codexhub</h1>
          <p>{API_BASE}</p>
        </div>
        <button
          className="button button-secondary"
          type="button"
          onClick={loadProjects}
          disabled={loadingProjects}
        >
          Refresh
        </button>
      </header>

      {error ? (
        <div className="notice" role="alert">
          {error}
        </div>
      ) : null}

      <section className="workspace-grid" aria-label="Codexhub control plane">
        <aside className="panel project-panel" aria-label="Projects">
          <div className="panel-heading">
            <h2>Projects</h2>
            <span>{loadingProjects ? "Loading" : projects.length}</span>
          </div>
          <div className="list">
            {projects.map((project) => (
              <button
                className={`list-row ${project.id === selectedProjectId ? "is-active" : ""}`}
                key={project.id}
                type="button"
                onClick={() => setSelectedProjectId(project.id)}
              >
                <strong>{project.name}</strong>
                <span>
                  {project.default_branch ??
                    project.default_cwd ??
                    shortId(project.id)}
                </span>
              </button>
            ))}
            {!loadingProjects && projects.length === 0 ? (
              <p className="empty">No projects returned.</p>
            ) : null}
          </div>
        </aside>

        <aside className="panel session-panel" aria-label="Sessions">
          <div className="panel-heading">
            <div>
              <h2>Sessions</h2>
              <p>{selectedProject?.name ?? "Select a project"}</p>
            </div>
            <span>{loadingSessions ? "Loading" : sessions.length}</span>
          </div>
          <section className="run-group-block" aria-label="Run groups">
            <div className="section-heading compact-heading">
              <h3>Run Groups</h3>
              <span>{loadingRunGroups ? "Loading" : runGroups.length}</span>
            </div>
            <div className="run-group-list">
              {runGroups.map((runGroup) => (
                <button
                  className={`run-group-chip ${runGroup.id === selectedRunGroupId && activeDetail === "run_group" ? "is-active" : ""}`}
                  key={runGroup.id}
                  type="button"
                  onClick={() => {
                    setSelectedRunGroupId(runGroup.id);
                    setActiveDetail("run_group");
                  }}
                >
                  <strong>{runGroup.name}</strong>
                  <span>{runGroup.purpose ?? shortId(runGroup.id)}</span>
                </button>
              ))}
              {!loadingRunGroups &&
              selectedProjectId &&
              runGroups.length === 0 ? (
                <p className="empty compact-empty">No run groups.</p>
              ) : null}
            </div>
          </section>
          <section className="start-session-block" aria-label="Start session">
            <div className="section-heading compact-heading">
              <h3>Start Session</h3>
              <span>
                {loadingWorkspaces
                  ? "Loading workspaces"
                  : `${workspaces.length} workspaces`}
              </span>
            </div>
            <SessionDraftForm
              idPrefix="start-session"
              draft={createDraft}
              workspaces={workspaces}
              disabled={
                !selectedProjectId || loadingWorkspaces || submittingStart
              }
              submitting={submittingStart}
              submitDisabled={createSubmitDisabled}
              submitLabel="Start"
              submittingLabel="Starting"
              validationMessages={createValidationMessages}
              error={createSessionError}
              onDraftChange={setCreateDraft}
              onSubmit={handleStartSession}
            />
          </section>
          <div className="list session-list">
            {sessions.map((session) => (
              <button
                className={`list-row session-row ${session.id === selectedSessionId ? "is-active" : ""}`}
                key={session.id}
                type="button"
                onClick={() => {
                  setSelectedSessionId(session.id);
                  setActiveDetail("session");
                }}
              >
                <span className="row-topline">
                  <strong>{shortId(session.id)}</strong>
                  <span className={statusClass(session.status)}>
                    {session.status.replace("_", " ")}
                  </span>
                </span>
                <span className="message-preview">
                  {compactText(session.last_agent_message)}
                </span>
                <span>Updated {formatDate(session.updated_at)}</span>
              </button>
            ))}
            {!loadingSessions && selectedProjectId && sessions.length === 0 ? (
              <p className="empty">No sessions returned.</p>
            ) : null}
          </div>
        </aside>

        <section
          className="panel detail-panel"
          aria-label={
            activeDetail === "run_group" ? "Run group detail" : "Session detail"
          }
        >
          <div className="panel-heading detail-heading">
            <div>
              <h2>
                {activeDetail === "run_group" ? "Run Group" : "Session Detail"}
              </h2>
              <p>
                {activeDetail === "run_group"
                  ? (selectedRunGroup?.name ?? "Select a run group")
                  : selectedSession
                    ? shortId(selectedSession.id)
                    : "Select a session"}
              </p>
            </div>
            {activeDetail === "run_group" && selectedRunGroup ? (
              <span className="dashboard-pill">
                {loadingRunGroupDetail
                  ? "Loading"
                  : `${runGroupCounts.attention} attention`}
              </span>
            ) : selectedSession ? (
              <span className={statusClass(selectedSession.status)}>
                {selectedSession.status.replace("_", " ")}
              </span>
            ) : null}
          </div>

          {activeDetail === "run_group" ? (
            selectedRunGroup ? (
              <RunGroupDashboard
                runGroup={selectedRunGroup}
                summaries={runGroupSummaries}
                counts={runGroupCounts}
                loading={loadingRunGroupDetail}
                nextCursor={runGroupNextCursor}
                historyLength={runGroupHistory.length}
                onNext={handleNextRunGroupSessions}
                onPrevious={handlePreviousRunGroupSessions}
                onOpenSession={(sessionId) => {
                  setSelectedSessionId(sessionId);
                  setActiveDetail("session");
                }}
              />
            ) : (
              <p className="empty detail-empty">No run group selected.</p>
            )
          ) : selectedSession ? (
            <>
              <div className="session-context">
                <section className="task-spec-strip" aria-label="Task spec">
                  <div className="task-title">
                    <span className="label">Task</span>
                    <strong>
                      {compactText(
                        taskSpec?.title ?? taskSpec?.intent,
                        "No task spec snapshot.",
                      )}
                    </strong>
                  </div>
                  <dl className="session-meta-list">
                    <div>
                      <dt>Ref</dt>
                      <dd>{taskSpec?.ref ?? "snapshot"}</dd>
                    </div>
                    <div>
                      <dt>Workspace</dt>
                      <dd>{shortId(selectedSession.workspace_id)}</dd>
                    </div>
                    <div>
                      <dt>Thread</dt>
                      <dd>{shortId(selectedSession.codex_thread_id)}</dd>
                    </div>
                    <div>
                      <dt>PID</dt>
                      <dd>{selectedSession.process_pid ?? "-"}</dd>
                    </div>
                    <div>
                      <dt>Items</dt>
                      <dd>{selectedSession.last_item_sequence}</dd>
                    </div>
                    <div>
                      <dt>Updated</dt>
                      <dd>{formatDate(selectedSession.updated_at)}</dd>
                    </div>
                  </dl>
                </section>
              </div>

              <section
                className="conversation-shell"
                aria-label="Session conversation"
              >
                <div className="section-heading conversation-heading">
                  <div>
                    <h3>Conversation</h3>
                    <p>
                      {transcriptWindowLabel(
                        transcriptEntries,
                        transcriptCursor,
                      )}
                      ; fetched {TRANSCRIPT_FETCH_LIMIT}, showing up to{" "}
                      {VISIBLE_TRANSCRIPT_LIMIT}
                    </p>
                  </div>
                  <div className="item-controls">
                    <label className="toggle-label">
                      <input
                        type="checkbox"
                        checked={showRawItems}
                        onChange={(event) =>
                          setShowRawItems(event.target.checked)
                        }
                      />
                      Raw items
                    </label>
                    <button
                      className="button button-secondary button-compact"
                      type="button"
                      onClick={() => void handlePreviousTranscript()}
                      disabled={loadingDetail || !canLoadPreviousTranscript}
                    >
                      Previous
                    </button>
                    <button
                      className="button button-secondary button-compact"
                      type="button"
                      onClick={() => void handleNextTranscript()}
                      disabled={loadingDetail || transcriptNextCursor === null}
                    >
                      Next
                    </button>
                  </div>
                </div>

                <div className="conversation-scroll" aria-busy={loadingDetail}>
                  <div className="chat-stream">
                    {conversationTranscriptEntries.map((entry) => {
                      if (entry.kind === "message") {
                        return (
                          <article
                            className="chat-row chat-row-user"
                            key={entry.id}
                          >
                            <div className="chat-bubble chat-bubble-user">
                              <div className="chat-meta">
                                <strong>
                                  {messageTitle(entry.message_mode)}
                                </strong>
                                <span>Entry #{entry.sequence}</span>
                                <span className="message-status">
                                  {entry.message_status ?? entry.role}
                                </span>
                                <time>{formatDate(entry.created_at)}</time>
                              </div>
                              <p>{compactText(entry.text, "Continue.")}</p>
                              <TranscriptMetadataDetails entry={entry} />
                            </div>
                          </article>
                        );
                      }

                      if (entry.kind === "agent_message") {
                        return (
                          <article
                            className="chat-row chat-row-agent"
                            key={entry.id}
                          >
                            <div className="chat-bubble chat-bubble-agent">
                              <div className="chat-meta">
                                <strong>Agent</strong>
                                <span>Entry #{entry.sequence}</span>
                                <span>
                                  {sequenceRangeLabel(entry.item_sequences)}
                                </span>
                                <time>{formatDate(entry.created_at)}</time>
                              </div>
                              <p>{compactText(entry.text)}</p>
                              <TranscriptMetadataDetails entry={entry} />
                            </div>
                          </article>
                        );
                      }

                      return (
                        <details
                          className={`chat-tool ${transcriptClass(entry)}`}
                          key={entry.id}
                        >
                          <summary className="tool-summary">
                            <strong>{transcriptTitle(entry)}</strong>
                            <span>Entry #{entry.sequence}</span>
                            <span>{transcriptSummary(entry)}</span>
                            <time>{formatDate(entry.created_at)}</time>
                          </summary>
                          <div className="tool-body">
                            <div className="chat-meta">
                              <strong>Tool</strong>
                              <span>
                                {sequenceRangeLabel(entry.item_sequences)}
                              </span>
                              <span>
                                {entry.codex_method ??
                                  entry.codex_item_type ??
                                  entry.item_type ??
                                  entry.role}
                              </span>
                              <time>{formatDate(entry.created_at)}</time>
                            </div>
                            <p>
                              {compactText(entry.text, "No transcript text.")}
                            </p>
                            <TranscriptMetadataDetails entry={entry} />
                          </div>
                        </details>
                      );
                    })}
                    {!loadingDetail &&
                    conversationTranscriptEntries.length === 0 ? (
                      <p className="empty">
                        No complete conversation entries in this page.
                      </p>
                    ) : null}
                  </div>

                  {showRawItems ? (
                    <div
                      className="raw-item-panel"
                      aria-label="Raw item inspection"
                    >
                      <div className="section-heading raw-item-heading">
                        <div>
                          <h3>Raw Item Inspection</h3>
                          <p>
                            Items {itemWindowLabel(items, itemAfter)}; page
                            limit {ITEM_PAGE_LIMIT}
                          </p>
                        </div>
                        <div className="item-controls">
                          <label>
                            Type
                            <select
                              value={itemType}
                              onChange={(event) =>
                                setItemType(
                                  event.target.value as ItemType | "all",
                                )
                              }
                            >
                              {ITEM_TYPES.map((type) => (
                                <option key={type} value={type}>
                                  {type}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            className="button button-secondary button-compact"
                            type="button"
                            onClick={() => void handlePreviousItems()}
                            disabled={loadingDetail || itemHistory.length === 0}
                          >
                            Previous
                          </button>
                          <button
                            className="button button-secondary button-compact"
                            type="button"
                            onClick={() => void handleNextItems()}
                            disabled={loadingDetail || itemNextCursor === null}
                          >
                            Next
                          </button>
                        </div>
                      </div>

                      <div
                        className="item-list raw-item-list"
                        aria-busy={loadingDetail}
                      >
                        {items.map((item) => (
                          <article
                            className={`transcript-row transcript-${item.type}`}
                            key={item.id}
                          >
                            <div className="transcript-meta">
                              <strong>{itemTitle(item)}</strong>
                              <span>Item #{item.sequence}</span>
                              <span>
                                {item.codex_method ??
                                  item.codex_item_type ??
                                  item.type}
                              </span>
                              <time>{formatDate(item.created_at)}</time>
                            </div>
                            <p>{itemSummary(item)}</p>
                            <details className="payload-details">
                              <summary>Raw payload</summary>
                              <pre>{displayJson(item.raw_payload)}</pre>
                            </details>
                          </article>
                        ))}
                        {!loadingDetail && items.length === 0 ? (
                          <p className="empty">
                            No raw items match this filter.
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              </section>

              <section
                className="composer composer-bottom"
                aria-label="Send session message"
              >
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="Write a steer or continue instruction..."
                  rows={3}
                />
                <div className="action-row">
                  <button
                    className="button"
                    type="button"
                    onClick={() => void handleSend("steer")}
                    disabled={actionAvailability?.steer.disabled ?? true}
                    aria-describedby={
                      actionAvailability?.steer.disabled
                        ? actionHelpId
                        : undefined
                    }
                  >
                    Send Steer
                  </button>
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => void handleSend("continue")}
                    disabled={actionAvailability?.continue.disabled ?? true}
                    aria-describedby={
                      actionAvailability?.continue.disabled
                        ? actionHelpId
                        : undefined
                    }
                  >
                    Continue
                  </button>
                  <button
                    className="button button-danger"
                    type="button"
                    onClick={() => void handleAction("stop")}
                    disabled={actionAvailability?.stop.disabled ?? true}
                    aria-describedby={
                      actionAvailability?.stop.disabled
                        ? actionHelpId
                        : undefined
                    }
                  >
                    Stop
                  </button>
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => void handleAction("complete")}
                    disabled={actionAvailability?.complete.disabled ?? true}
                    aria-describedby={
                      actionAvailability?.complete.disabled
                        ? actionHelpId
                        : undefined
                    }
                  >
                    Complete
                  </button>
                </div>
                {actionAvailability && disabledActions.length > 0 ? (
                  <dl className="action-help" id="session-action-help">
                    {disabledActions.map((action) => (
                      <div key={action}>
                        <dt>{actionAvailability[action].label}</dt>
                        <dd>{actionAvailability[action].reasons.join(" ")}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                {followUpAvailable ? (
                  <section
                    className="follow-up-block"
                    aria-label="Start follow-up session"
                  >
                    <div className="section-heading compact-heading">
                      <h3>Follow-up</h3>
                      <span>
                        Source is {statusLabel(selectedSession.status)}
                      </span>
                    </div>
                    <SessionDraftForm
                      idPrefix={`follow-up-${selectedSession.id}`}
                      draft={followUpDraft}
                      workspaces={workspaces}
                      disabled={loadingWorkspaces || submittingFollowUp}
                      submitting={submittingFollowUp}
                      submitDisabled={followUpSubmitDisabled}
                      submitLabel="Start Follow-up"
                      submittingLabel="Starting Follow-up"
                      validationMessages={followUpValidationMessages}
                      error={followUpError}
                      onDraftChange={setFollowUpDraft}
                      onSubmit={handleStartFollowUp}
                    />
                  </section>
                ) : null}
              </section>
            </>
          ) : (
            <p className="empty detail-empty">No session selected.</p>
          )}
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
