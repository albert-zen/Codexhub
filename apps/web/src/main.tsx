import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import type {
  ID,
  Project,
  TranscriptEntry,
  WorkerSession,
  Workspace,
} from "@codexhub/core";
import {
  canSendThreadMessage,
  conversationPageLabel,
  isEmptyThreadSession,
  isResumableThreadSession,
} from "./thread-ui-state.js";
import "./styles.css";

interface TranscriptPage {
  entries: TranscriptEntry[];
  next_cursor: string | null;
}

interface ThreadDetailResponse {
  session?: WorkerSession;
  thread?: unknown;
  workspace?: Workspace;
}

interface SendThreadResponse {
  session?: WorkerSession;
}

const API_BASE = (
  import.meta.env.VITE_CODEXHUB_API ?? "http://127.0.0.1:4317"
).replace(/\/+$/, "");
const THREAD_LIST_LIMIT = 100;
const TRANSCRIPT_LIMIT = 80;

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
    if (value !== null && value !== undefined && value !== "") {
      query.set(key, String(value));
    }
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

async function fetchThreads(projectId: ID): Promise<WorkerSession[]> {
  const nestedPath = `/projects/${encodeURIComponent(projectId)}/sessions${queryString({ limit: THREAD_LIST_LIMIT })}`;
  const flatPath = `/sessions${queryString({
    project_id: projectId,
    limit: THREAD_LIST_LIMIT,
  })}`;
  const body = await withFallback(
    () => request<unknown>(nestedPath),
    () => request<unknown>(flatPath),
  );
  return listFrom<WorkerSession>(body, "sessions");
}

async function fetchThread(threadId: ID): Promise<WorkerSession> {
  const body = await request<ThreadDetailResponse>(
    `/threads/${encodeURIComponent(threadId)}`,
  );
  if (body.session) return body.session;
  return entityFrom<WorkerSession>(body, "session");
}

async function fetchTranscript(threadId: ID): Promise<TranscriptPage> {
  const body = await request<unknown>(
    `/threads/${encodeURIComponent(threadId)}/transcript${queryString({
      recent: true,
      limit: TRANSCRIPT_LIMIT,
    })}`,
  );
  return {
    entries: listFrom<TranscriptEntry>(body, "transcript"),
    next_cursor:
      isObject(body) && typeof body.next_cursor === "string"
        ? body.next_cursor
        : null,
  };
}

async function createThread(
  projectId: ID,
  workspaceId: ID,
): Promise<WorkerSession> {
  const body = await request<unknown>(
    `/projects/${encodeURIComponent(projectId)}/threads`,
    {
      method: "POST",
      body: JSON.stringify({
        workspace_id: workspaceId,
        idempotency_key: `web-${projectId}-${workspaceId}-${Date.now()}`,
      }),
    },
  );
  return entityFrom<WorkerSession>(body, "session");
}

async function sendThreadMessage(
  threadId: ID,
  content: string,
): Promise<WorkerSession> {
  const body = await request<SendThreadResponse>(
    `/threads/${encodeURIComponent(threadId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        mode: "continue",
        content,
        sender_type: "human",
        wait: "accepted",
        idempotency_key: `web-send-${threadId}-${Date.now()}`,
      }),
    },
  );
  if (body.session) return body.session;
  return fetchThread(threadId);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shortId(value: string | null | undefined): string {
  if (!value) return "-";
  return value.length > 10 ? value.slice(0, 10) : value;
}

function compactText(
  value: string | null | undefined,
  fallback = "No messages yet.",
): string {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  return text.length > 120 ? `${text.slice(0, 120)}...` : text;
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

function statusLabel(session: WorkerSession): string {
  if (isEmptyThreadSession(session)) return "empty";
  if (isResumableThreadSession(session)) return "idle";
  if (session.status === "awaiting_input") return "ready";
  if (session.status === "running") return "running";
  if (session.status === "starting") return "starting";
  return session.status.replace("_", " ");
}

function readableThreadTitle(session: WorkerSession): string {
  if (isEmptyThreadSession(session)) return "New thread";
  return compactText(session.last_agent_message, shortId(session.id));
}

function transcriptRole(entry: TranscriptEntry): string {
  if (entry.kind === "message") {
    if (entry.sender_type === "manager_agent") return "Manager";
    if (entry.sender_type === "system") return "System";
    return "You";
  }
  if (entry.kind === "agent_message") return "Agent";
  if (entry.kind === "tool") return "Tool";
  return "Event";
}

function transcriptText(entry: TranscriptEntry): string {
  const text = entry.text?.trim();
  if (text) return text;
  if (entry.kind === "tool") {
    return [
      entry.codex_method,
      entry.codex_item_type,
      entry.item_sequences.length > 0
        ? `items ${entry.item_sequences.join(", ")}`
        : null,
    ]
      .filter(Boolean)
      .join(" / ");
  }
  return "No visible text.";
}

function preferredWorkspace(workspaces: Workspace[]): Workspace | null {
  return (
    workspaces.find((workspace) => workspace.status === "ready") ??
    workspaces[0] ??
    null
  );
}

function mergeThread(
  threads: WorkerSession[],
  updated: WorkerSession,
): WorkerSession[] {
  const next = threads.filter((thread) => thread.id !== updated.id);
  return [updated, ...next];
}

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [threads, setThreads] = useState<WorkerSession[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<ID | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<ID | null>(null);
  const [selectedThread, setSelectedThread] = useState<WorkerSession | null>(
    null,
  );
  const [transcriptEntries, setTranscriptEntries] = useState<TranscriptEntry[]>(
    [],
  );
  const [message, setMessage] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [creatingProjectId, setCreatingProjectId] = useState<ID | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const selectedProject = useMemo(
    () =>
      projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const workspaceById = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace])),
    [workspaces],
  );
  const sendDisabledByRuntime =
    selectedThread?.status === "running" ||
    (selectedThread?.status === "starting" &&
      !isEmptyThreadSession(selectedThread));
  const canSend = canSendThreadMessage({
    session: selectedThread,
    message,
    submitting: sending ? "continue" : null,
    continueDisabled: sendDisabledByRuntime,
  });

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true);
    setError(null);
    try {
      const loaded = await fetchProjects();
      setProjects(loaded);
      setSelectedProjectId((current) => {
        if (current && loaded.some((project) => project.id === current)) {
          return current;
        }
        return loaded[0]?.id ?? null;
      });
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  const loadProjectData = useCallback(
    async (projectId: ID, preferredThreadId: ID | null = selectedThreadId) => {
      setLoadingThreads(true);
      setError(null);
      try {
        const [loadedWorkspaces, loadedThreads] = await Promise.all([
          fetchWorkspaces(projectId),
          fetchThreads(projectId),
        ]);
        setWorkspaces(loadedWorkspaces);
        setThreads(loadedThreads);
        setSelectedThreadId((current) => {
          const desired = preferredThreadId ?? current;
          if (
            desired &&
            loadedThreads.some((thread) => thread.id === desired)
          ) {
            return desired;
          }
          return loadedThreads[0]?.id ?? null;
        });
      } catch (loadError) {
        setError(getErrorMessage(loadError));
      } finally {
        setLoadingThreads(false);
      }
    },
    [selectedThreadId],
  );

  const loadThread = useCallback(async (threadId: ID) => {
    setLoadingTranscript(true);
    setError(null);
    try {
      const [thread, transcript] = await Promise.all([
        fetchThread(threadId),
        fetchTranscript(threadId),
      ]);
      setSelectedThread(thread);
      setThreads((current) => mergeThread(current, thread));
      setTranscriptEntries(transcript.entries);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
      setTranscriptEntries([]);
    } finally {
      setLoadingTranscript(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (!selectedProjectId) {
      setWorkspaces([]);
      setThreads([]);
      setSelectedThreadId(null);
      return;
    }
    void loadProjectData(selectedProjectId);
  }, [loadProjectData, selectedProjectId]);

  useEffect(() => {
    if (!selectedThreadId) {
      setSelectedThread(null);
      setTranscriptEntries([]);
      return;
    }
    void loadThread(selectedThreadId);
  }, [loadThread, selectedThreadId]);

  useEffect(() => {
    if (selectedThread) {
      composerRef.current?.focus();
    }
  }, [selectedThread?.id]);

  async function handleCreateThread(project: Project) {
    setCreatingProjectId(project.id);
    setError(null);
    try {
      let projectWorkspaces = workspaces;
      if (project.id !== selectedProjectId) {
        projectWorkspaces = await fetchWorkspaces(project.id);
        setWorkspaces(projectWorkspaces);
      }
      const workspace = preferredWorkspace(projectWorkspaces);
      if (!workspace) {
        throw new Error("Project has no workspace available for a new thread.");
      }
      const thread = await createThread(project.id, workspace.id);
      setSelectedProjectId(project.id);
      setThreads((current) => mergeThread(current, thread));
      setSelectedThreadId(thread.id);
      setSelectedThread(thread);
      setTranscriptEntries([]);
      setMessage("");
      requestAnimationFrame(() => composerRef.current?.focus());
    } catch (createError) {
      setError(getErrorMessage(createError));
    } finally {
      setCreatingProjectId(null);
    }
  }

  async function handleSend() {
    if (!selectedThread || !canSend) return;
    const content = message.trim();
    setSending(true);
    setError(null);
    setMessage("");
    try {
      const updated = await sendThreadMessage(selectedThread.id, content);
      setSelectedThread(updated);
      setThreads((current) => mergeThread(current, updated));
      await loadThread(updated.id);
    } catch (sendError) {
      setError(getErrorMessage(sendError));
      setMessage(content);
      await loadThread(selectedThread.id);
    } finally {
      setSending(false);
    }
  }

  function handleComposerKeyDown(
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void handleSend();
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Projects and threads">
        <header className="brand">
          <div className="mark" aria-hidden="true">
            C
          </div>
          <div className="brand-copy">
            <h1>CodexHub</h1>
            <p>{API_BASE}</p>
          </div>
          <button
            className="icon-button refresh-button"
            type="button"
            title="Refresh"
            aria-label="Refresh"
            onClick={() => void loadProjects()}
            disabled={loadingProjects}
          >
            R
          </button>
        </header>

        {error ? (
          <div className="notice" role="alert">
            {error}
          </div>
        ) : null}

        <nav className="project-tree" aria-busy={loadingProjects}>
          {projects.map((project) => {
            const isActive = project.id === selectedProjectId;
            const visibleThreads = isActive ? threads : [];
            return (
              <section className="project-node" key={project.id}>
                <div
                  className={`project-row ${isActive ? "is-active" : ""}`}
                >
                  <button
                    className="project-select"
                    type="button"
                    onClick={() => setSelectedProjectId(project.id)}
                  >
                    <span className="tree-chevron" aria-hidden="true">
                      {isActive ? "v" : ">"}
                    </span>
                    <span className="project-copy">
                      <strong>{project.name}</strong>
                      <span>
                        {project.default_cwd ??
                          project.default_branch ??
                          shortId(project.id)}
                      </span>
                    </span>
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    title={`New thread in ${project.name}`}
                    aria-label={`New thread in ${project.name}`}
                    onClick={() => void handleCreateThread(project)}
                    disabled={creatingProjectId !== null}
                  >
                    +
                  </button>
                </div>

                {isActive ? (
                  <div className="thread-list" aria-busy={loadingThreads}>
                    {visibleThreads.map((thread) => {
                      const workspace = workspaceById.get(thread.workspace_id);
                      return (
                        <button
                          className={`thread-row ${
                            thread.id === selectedThreadId ? "is-active" : ""
                          }`}
                          key={thread.id}
                          type="button"
                          onClick={() => setSelectedThreadId(thread.id)}
                        >
                          <span className="thread-title">
                            {readableThreadTitle(thread)}
                          </span>
                          <span className="thread-meta">
                            {statusLabel(thread)} ·{" "}
                            {workspace?.cwd ?? shortId(thread.workspace_id)}
                          </span>
                        </button>
                      );
                    })}
                    {!loadingThreads && visibleThreads.length === 0 ? (
                      <p className="tree-empty">No threads yet.</p>
                    ) : null}
                  </div>
                ) : null}
              </section>
            );
          })}
          {!loadingProjects && projects.length === 0 ? (
            <p className="tree-empty">No projects yet.</p>
          ) : null}
        </nav>
      </aside>

      <section className="chat-surface" aria-label="Thread chat">
        <header className="chat-header">
          <div>
            <p className="eyebrow">{selectedProject?.name ?? "No project"}</p>
            <h2>
              {selectedThread
                ? readableThreadTitle(selectedThread)
                : "Select or create a thread"}
            </h2>
          </div>
          {selectedThread ? (
            <div className="quiet-meta">
              <span>{statusLabel(selectedThread)}</span>
              <span>{formatDate(selectedThread.updated_at)}</span>
            </div>
          ) : null}
        </header>

        <div className="message-window" aria-busy={loadingTranscript}>
          <div className="message-list">
            {selectedThread && transcriptEntries.length > 0 ? (
              transcriptEntries.map((entry) => (
                <article
                  className={`message-row message-${entry.kind}`}
                  key={entry.id}
                >
                  <div className="message-author">
                    <strong>{transcriptRole(entry)}</strong>
                    <time>{formatDate(entry.created_at)}</time>
                  </div>
                  <div className="message-body">
                    <p>{transcriptText(entry)}</p>
                  </div>
                </article>
              ))
            ) : selectedThread ? (
              <div className="empty-chat">
                <h3>
                  {isEmptyThreadSession(selectedThread)
                    ? "New thread"
                    : "No visible messages"}
                </h3>
                <p>
                  {isEmptyThreadSession(selectedThread)
                    ? "Type the first message below."
                    : "The conversation is empty in the current window."}
                </p>
              </div>
            ) : (
              <div className="empty-chat">
                <h3>Choose a thread</h3>
                <p>
                  Use the + button beside a project to create one in the right
                  workspace.
                </p>
              </div>
            )}
          </div>
        </div>

        <footer className="composer" aria-label="Send message">
          <div className="composer-context">
            <span>
              {selectedThread
                ? conversationPageLabel(transcriptEntries)
                : "No thread selected"}
            </span>
            {sending ? <span>Sending...</span> : null}
          </div>
          <div className="composer-box">
            <textarea
              ref={composerRef}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder={
                selectedThread
                  ? "Message this thread..."
                  : "Create or select a thread to start..."
              }
              rows={3}
              disabled={!selectedThread || sending}
            />
            <button
              className="send-button"
              type="button"
              onClick={() => void handleSend()}
              disabled={!canSend}
              aria-label="Send message"
            >
              ^
            </button>
          </div>
        </footer>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
