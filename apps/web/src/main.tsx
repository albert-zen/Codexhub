import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type ID = string;

type WorkerSessionStatus =
  | "starting"
  | "running"
  | "awaiting_input"
  | "completed"
  | "failed"
  | "stopped";

type MessageMode = "steer" | "continue";

type ItemType =
  | "agentmessage"
  | "toolcall"
  | "toolresult"
  | "error"
  | "state"
  | "reasoning"
  | "raw";

interface Project {
  id: ID;
  name: string;
  default_repo_url: string | null;
  default_workspace_root: string | null;
  default_cwd: string | null;
  default_branch: string | null;
  created_at: string;
  updated_at: string;
}

interface WorkerSession {
  id: ID;
  project_id: ID;
  workspace_id: ID;
  status: WorkerSessionStatus;
  codex_thread_id: string | null;
  codex_turn_id: string | null;
  codex_session_key: string | null;
  process_pid: string | null;
  last_agent_message_item_id: ID | null;
  last_agent_message: string | null;
  last_agent_message_at: string | null;
  last_item_sequence: number;
  failure_reason: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

interface Item {
  id: ID;
  session_id: ID;
  sequence: number;
  type: ItemType;
  codex_method: string | null;
  codex_item_id: string | null;
  codex_item_type: string | null;
  created_at: string;
  raw_payload: unknown;
  text_excerpt: string | null;
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
): Promise<Item[]> {
  const query = queryString({ limit: 200, type: type === "all" ? null : type });
  const nestedPath = `/sessions/${encodeURIComponent(sessionId)}/items${query}`;
  const flatPath = `/items${queryString({
    session_id: sessionId,
    limit: 200,
    type: type === "all" ? null : type,
  })}`;
  const body = await withFallback(
    () => request<unknown>(nestedPath),
    () => request<unknown>(flatPath),
  );
  return listFrom<Item>(body, "items");
}

async function sendMessage(
  sessionId: ID,
  mode: MessageMode,
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

function canSend(status: WorkerSessionStatus, mode: MessageMode): boolean {
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

function displayItem(item: Item): string {
  if (item.text_excerpt?.trim()) return item.text_excerpt.trim();
  if (typeof item.raw_payload === "string") return item.raw_payload;
  try {
    return JSON.stringify(item.raw_payload, null, 2);
  } catch {
    return "No renderable payload.";
  }
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
  const [itemType, setItemType] = useState<ItemType | "all">("agentmessage");
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
    async (sessionId: ID, type: ItemType | "all") => {
      setLoadingDetail(true);
      setError(null);
      try {
        const [nextSession, nextItems] = await Promise.all([
          fetchSession(sessionId),
          fetchItems(sessionId, type),
        ]);
        setSelectedSession(nextSession);
        setItems(nextItems);
      } catch (loadError) {
        setSelectedSession(null);
        setItems([]);
        setError(`Session detail: ${getErrorMessage(loadError)}`);
      } finally {
        setLoadingDetail(false);
      }
    },
    [],
  );

  const refreshCurrent = useCallback(async () => {
    if (selectedProjectId) await loadSessions(selectedProjectId);
    if (selectedSessionId) await loadDetail(selectedSessionId, itemType);
  }, [
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
      return;
    }
    void loadDetail(selectedSessionId, itemType);
  }, [itemType, loadDetail, selectedSessionId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshCurrent();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [refreshCurrent]);

  async function handleSend(mode: MessageMode) {
    if (!selectedSession) return;
    const content = message.trim();
    if (mode === "steer" && !content) return;
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
                  placeholder="Steer this worker or leave empty to continue..."
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

              <section className="items-block" aria-label="Session items">
                <div className="section-heading">
                  <h3>Items</h3>
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
                </div>

                <div className="item-list" aria-busy={loadingDetail}>
                  {items.map((item) => (
                    <article className="item-row" key={item.id}>
                      <div className="item-meta">
                        <strong>#{item.sequence}</strong>
                        <span>{item.type}</span>
                        <span>
                          {item.codex_method ?? item.codex_item_type ?? "item"}
                        </span>
                        <time>{formatDate(item.created_at)}</time>
                      </div>
                      <pre>{displayItem(item)}</pre>
                    </article>
                  ))}
                  {!loadingDetail && items.length === 0 ? (
                    <p className="empty">No items match this filter.</p>
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
