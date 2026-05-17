import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  ID,
  Item,
  ItemType,
  Message,
  MessageMode,
  Project,
  WorkerSession,
  WorkerSessionStatus,
} from "@codexhub/core";
import "./styles.css";

type SendMessageMode = Exclude<MessageMode, "initial">;

interface ItemPage {
  items: Item[];
  next_cursor: string | null;
  limit: number;
  type: string;
}

type TranscriptEntry =
  | {
      kind: "message";
      id: string;
      at: string;
      sortTime: number;
      sortIndex: number;
      message: Message;
    }
  | {
      kind: "agent";
      id: string;
      at: string;
      sortTime: number;
      sortIndex: number;
      sequenceStart: number;
      sequenceEnd: number;
      method: string | null;
      codexItemId: string | null;
      text: string;
      items: Item[];
    }
  | {
      kind: "item";
      id: string;
      at: string;
      sortTime: number;
      sortIndex: number;
      item: Item;
    };

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
const ITEM_PAGE_LIMIT = 50;

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
  params: Record<string, string | number | null | undefined>,
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
    const detail =
      isObject(body) && typeof body.message === "string"
        ? body.message
        : response.statusText;
    throw new ApiError(`${response.status} ${detail}`.trim(), response.status);
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

async function fetchSessions(projectId: ID): Promise<WorkerSession[]> {
  const nestedPath = `/projects/${encodeURIComponent(projectId)}/sessions${queryString({ limit: 100 })}`;
  const flatPath = `/sessions${queryString({ project_id: projectId, limit: 100 })}`;
  const body = await withFallback(
    () => request<unknown>(nestedPath),
    () => request<unknown>(flatPath),
  );
  return listFrom<WorkerSession>(body, "sessions");
}

async function fetchSession(sessionId: ID): Promise<WorkerSession> {
  const body = await request<unknown>(
    `/sessions/${encodeURIComponent(sessionId)}`,
  );
  return entityFrom<WorkerSession>(body, "session");
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

async function fetchMessages(sessionId: ID): Promise<Message[]> {
  const body = await request<unknown>(
    `/sessions/${encodeURIComponent(sessionId)}/messages`,
  );
  return listFrom<Message>(body, "messages");
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

function canSend(status: WorkerSessionStatus, mode: SendMessageMode): boolean {
  if (mode === "steer")
    return status === "running" || status === "awaiting_input";
  return status === "awaiting_input";
}

function canFinish(status: WorkerSessionStatus): boolean {
  return (
    status === "starting" || status === "running" || status === "awaiting_input"
  );
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

function displayJson(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "No renderable payload.";
  }
}

function timeValue(value: string): number {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function buildTranscript(
  messages: Message[],
  items: Item[],
): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  const agentGroups = new Map<
    string,
    Extract<TranscriptEntry, { kind: "agent" }>
  >();

  for (const item of [...items].sort((a, b) => a.sequence - b.sequence)) {
    if (item.type !== "agentmessage") {
      entries.push({
        kind: "item",
        id: `item:${item.id}`,
        at: item.created_at,
        sortTime: timeValue(item.created_at),
        sortIndex: item.sequence,
        item,
      });
      continue;
    }

    const key = item.codex_item_id ?? item.id;
    const existing = agentGroups.get(key);
    const text = item.text_excerpt ?? "";
    if (existing) {
      existing.items.push(item);
      existing.at = item.created_at;
      existing.sortTime = Math.min(
        existing.sortTime,
        timeValue(item.created_at),
      );
      existing.sequenceStart = Math.min(existing.sequenceStart, item.sequence);
      existing.sequenceEnd = Math.max(existing.sequenceEnd, item.sequence);
      existing.method = item.codex_method ?? existing.method;
      if (item.codex_method === "item/agentMessage/delta") {
        existing.text += text;
      } else if (text.trim() && text.length >= existing.text.length) {
        existing.text = text;
      }
      continue;
    }

    const entry: Extract<TranscriptEntry, { kind: "agent" }> = {
      kind: "agent",
      id: `agent:${key}:${item.id}`,
      at: item.created_at,
      sortTime: timeValue(item.created_at),
      sortIndex: item.sequence,
      sequenceStart: item.sequence,
      sequenceEnd: item.sequence,
      method: item.codex_method,
      codexItemId: item.codex_item_id,
      text,
      items: [item],
    };
    agentGroups.set(key, entry);
    entries.push(entry);
  }

  for (const message of messages) {
    entries.push({
      kind: "message",
      id: `message:${message.id}`,
      at: message.created_at,
      sortTime: timeValue(message.created_at),
      sortIndex: -1,
      message,
    });
  }

  return entries.sort((a, b) => {
    if (a.sortTime !== b.sortTime) return a.sortTime - b.sortTime;
    const rank = { message: 0, agent: 1, item: 2 };
    if (rank[a.kind] !== rank[b.kind]) return rank[a.kind] - rank[b.kind];
    return a.sortIndex - b.sortIndex || a.id.localeCompare(b.id);
  });
}

function messageTitle(message: Message): string {
  if (message.mode === "initial") return "Initial Prompt";
  if (message.mode === "continue") return "Continue";
  return "Steer";
}

function itemTitle(item: Item): string {
  if (item.type === "toolcall") return "Tool Call";
  if (item.type === "toolresult") return "Tool Result";
  if (item.type === "reasoning") return "Reasoning";
  if (item.type === "error") return "Error";
  if (item.type === "state") return "State";
  return "Raw Item";
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

function itemWindowLabel(items: Item[], afterSequence: number | null): string {
  if (items.length === 0) return `after #${afterSequence ?? 0}`;
  const first = items[0]?.sequence ?? afterSequence ?? 0;
  const last = items[items.length - 1]?.sequence ?? first;
  return first === last ? `#${first}` : `#${first}-${last}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<ID | null>(null);
  const [sessions, setSessions] = useState<WorkerSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<ID | null>(null);
  const [selectedSession, setSelectedSession] = useState<WorkerSession | null>(
    null,
  );
  const [items, setItems] = useState<Item[]>([]);
  const [itemAfter, setItemAfter] = useState<number | null>(null);
  const [itemHistory, setItemHistory] = useState<number[]>([]);
  const [itemNextCursor, setItemNextCursor] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [itemType, setItemType] = useState<ItemType | "all">("all");
  const [message, setMessage] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [submitting, setSubmitting] = useState<
    "steer" | "continue" | "stop" | "complete" | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  const latestAgentMessage = useMemo(() => {
    if (selectedSession?.last_agent_message)
      return selectedSession.last_agent_message;
    const newestAgentItem = [...items]
      .filter((item) => item.type === "agentmessage" && item.text_excerpt)
      .sort((a, b) => b.sequence - a.sequence)[0];
    return newestAgentItem?.text_excerpt ?? null;
  }, [items, selectedSession]);

  const transcript = useMemo(
    () => buildTranscript(messages, items),
    [items, messages],
  );

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

  const loadDetail = useCallback(
    async (
      sessionId: ID,
      type: ItemType | "all",
      afterSequence: number | null,
    ) => {
      setLoadingDetail(true);
      setError(null);
      try {
        const [nextSession, nextItemPage, nextMessages] = await Promise.all([
          fetchSession(sessionId),
          fetchItems(sessionId, type, afterSequence),
          fetchMessages(sessionId),
        ]);
        setSelectedSession(nextSession);
        setItems(nextItemPage.items);
        setItemNextCursor(nextItemPage.next_cursor);
        setMessages(nextMessages);
      } catch (loadError) {
        setSelectedSession(null);
        setItems([]);
        setItemNextCursor(null);
        setMessages([]);
        setError(`Session detail: ${getErrorMessage(loadError)}`);
      } finally {
        setLoadingDetail(false);
      }
    },
    [],
  );

  const refreshCurrent = useCallback(async () => {
    if (selectedProjectId) await loadSessions(selectedProjectId);
    if (selectedSessionId)
      await loadDetail(selectedSessionId, itemType, itemAfter);
  }, [
    itemAfter,
    itemType,
    loadDetail,
    loadSessions,
    selectedProjectId,
    selectedSessionId,
  ]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (!selectedProjectId) {
      setSessions([]);
      setSelectedSessionId(null);
      return;
    }
    void loadSessions(selectedProjectId);
  }, [loadSessions, selectedProjectId]);

  useEffect(() => {
    if (!selectedSessionId) {
      setSelectedSession(null);
      setItems([]);
      setItemAfter(null);
      setItemHistory([]);
      setItemNextCursor(null);
      setMessages([]);
      return;
    }
    setItemAfter(null);
    setItemHistory([]);
    void loadDetail(selectedSessionId, itemType, null);
  }, [itemType, loadDetail, selectedSessionId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshCurrent();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [refreshCurrent]);

  async function handleSend(mode: SendMessageMode) {
    if (!selectedSession) return;
    const content = message.trim();
    if (mode === "steer" && !content) return;
    if (mode === "continue" && !content) return;
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

  async function handleNextItems() {
    if (!selectedSession || itemNextCursor === null) return;
    const nextAfter = Number(itemNextCursor);
    if (!Number.isInteger(nextAfter)) return;
    setItemHistory((current) => [...current, itemAfter ?? 0]);
    setItemAfter(nextAfter);
    await loadDetail(selectedSession.id, itemType, nextAfter);
  }

  async function handlePreviousItems() {
    if (!selectedSession || itemHistory.length === 0) return;
    const previousHistory = itemHistory.slice(0, -1);
    const previousAfter = itemHistory[itemHistory.length - 1] ?? 0;
    setItemHistory(previousHistory);
    setItemAfter(previousAfter === 0 ? null : previousAfter);
    await loadDetail(
      selectedSession.id,
      itemType,
      previousAfter === 0 ? null : previousAfter,
    );
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

      {error ? <div className="notice">{error}</div> : null}

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
          <div className="list session-list">
            {sessions.map((session) => (
              <button
                className={`list-row session-row ${session.id === selectedSessionId ? "is-active" : ""}`}
                key={session.id}
                type="button"
                onClick={() => setSelectedSessionId(session.id)}
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

        <section className="panel detail-panel" aria-label="Session detail">
          <div className="panel-heading detail-heading">
            <div>
              <h2>Session Detail</h2>
              <p>
                {selectedSession
                  ? shortId(selectedSession.id)
                  : "Select a session"}
              </p>
            </div>
            {selectedSession ? (
              <span className={statusClass(selectedSession.status)}>
                {selectedSession.status.replace("_", " ")}
              </span>
            ) : null}
          </div>

          {selectedSession ? (
            <>
              <div className="detail-grid">
                <div>
                  <span className="label">Workspace</span>
                  <strong>{shortId(selectedSession.workspace_id)}</strong>
                </div>
                <div>
                  <span className="label">Thread</span>
                  <strong>{shortId(selectedSession.codex_thread_id)}</strong>
                </div>
                <div>
                  <span className="label">PID</span>
                  <strong>{selectedSession.process_pid ?? "-"}</strong>
                </div>
                <div>
                  <span className="label">Items</span>
                  <strong>{selectedSession.last_item_sequence}</strong>
                </div>
              </div>

              <section
                className="latest-block"
                aria-label="Latest agent message"
              >
                <div className="section-heading">
                  <h3>Latest Agent Message</h3>
                  <span>
                    {formatDate(selectedSession.last_agent_message_at)}
                  </span>
                </div>
                <p>{compactText(latestAgentMessage)}</p>
              </section>

              <section className="composer" aria-label="Send session message">
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="Write a steer or continue instruction..."
                  rows={4}
                />
                <div className="action-row">
                  <button
                    className="button"
                    type="button"
                    onClick={() => void handleSend("steer")}
                    disabled={
                      !canSend(selectedSession.status, "steer") ||
                      !message.trim() ||
                      submitting !== null
                    }
                  >
                    Send Steer
                  </button>
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => void handleSend("continue")}
                    disabled={
                      !canSend(selectedSession.status, "continue") ||
                      !message.trim() ||
                      submitting !== null
                    }
                  >
                    Continue
                  </button>
                  <button
                    className="button button-danger"
                    type="button"
                    onClick={() => void handleAction("stop")}
                    disabled={
                      !canFinish(selectedSession.status) || submitting !== null
                    }
                  >
                    Stop
                  </button>
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => void handleAction("complete")}
                    disabled={
                      !canFinish(selectedSession.status) || submitting !== null
                    }
                  >
                    Complete
                  </button>
                </div>
              </section>

              <section className="items-block" aria-label="Session transcript">
                <div className="section-heading">
                  <div>
                    <h3>Transcript</h3>
                    <p>
                      Items {itemWindowLabel(items, itemAfter)}; page limit{" "}
                      {ITEM_PAGE_LIMIT}
                    </p>
                  </div>
                  <div className="item-controls">
                    <label>
                      Type
                      <select
                        value={itemType}
                        onChange={(event) =>
                          setItemType(event.target.value as ItemType | "all")
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

                <div className="item-list" aria-busy={loadingDetail}>
                  {transcript.map((entry) => {
                    if (entry.kind === "message") {
                      return (
                        <article
                          className="transcript-row transcript-message"
                          key={entry.id}
                        >
                          <div className="transcript-meta">
                            <strong>{messageTitle(entry.message)}</strong>
                            <span>{entry.message.sender_type}</span>
                            <span className="message-status">
                              {entry.message.status}
                            </span>
                            <time>{formatDate(entry.at)}</time>
                          </div>
                          <p>
                            {compactText(entry.message.content, "Continue.")}
                          </p>
                          {entry.message.error ? (
                            <details className="payload-details">
                              <summary>Message error</summary>
                              <pre>{entry.message.error}</pre>
                            </details>
                          ) : null}
                        </article>
                      );
                    }

                    if (entry.kind === "agent") {
                      return (
                        <article
                          className="transcript-row transcript-agent"
                          key={entry.id}
                        >
                          <div className="transcript-meta">
                            <strong>Agent</strong>
                            <span>
                              #{entry.sequenceStart}
                              {entry.sequenceEnd !== entry.sequenceStart
                                ? `-${entry.sequenceEnd}`
                                : ""}
                            </span>
                            <span>{entry.method ?? "agentmessage"}</span>
                            <time>{formatDate(entry.at)}</time>
                          </div>
                          <p>{compactText(entry.text)}</p>
                          <details className="payload-details">
                            <summary>
                              Raw payload{entry.items.length === 1 ? "" : "s"}
                            </summary>
                            <pre>
                              {displayJson(
                                entry.items.length === 1
                                  ? entry.items[0]?.raw_payload
                                  : entry.items.map((item) => item.raw_payload),
                              )}
                            </pre>
                          </details>
                        </article>
                      );
                    }

                    return (
                      <article
                        className={`transcript-row transcript-${entry.item.type}`}
                        key={entry.id}
                      >
                        <div className="transcript-meta">
                          <strong>{itemTitle(entry.item)}</strong>
                          <span>#{entry.item.sequence}</span>
                          <span>
                            {entry.item.codex_method ??
                              entry.item.codex_item_type ??
                              entry.item.type}
                          </span>
                          <time>{formatDate(entry.at)}</time>
                        </div>
                        <p>{itemSummary(entry.item)}</p>
                        <details className="payload-details">
                          <summary>Payload details</summary>
                          <pre>{displayJson(entry.item.raw_payload)}</pre>
                        </details>
                      </article>
                    );
                  })}
                  {!loadingDetail && transcript.length === 0 ? (
                    <p className="empty">
                      No transcript entries match this filter.
                    </p>
                  ) : null}
                </div>
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
