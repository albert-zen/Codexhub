import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import type {
  ItemType,
  MessageMode,
  SenderType,
  WorkerSession,
} from "@codexhub/core";
import { isTerminalStatus } from "@codexhub/core";
import { openDatabase, type CodexHubDatabase } from "./database.js";
import {
  HubRepository,
  type ItemPageOptions,
  type SessionListOptions,
} from "./repository.js";
import { CodexRuntime } from "./runtime.js";
import { buildWorkspace } from "./workspace-builder.js";

export interface CreateServerOptions {
  dbPath?: string;
  logger?: boolean;
}

interface ServerState {
  database: CodexHubDatabase;
  repo: HubRepository;
  runtime: CodexRuntime;
}

export async function createServer(options: CreateServerOptions = {}) {
  const app = Fastify({ logger: options.logger ?? true });
  await app.register(cors, { origin: true });

  const database = openDatabase({ path: options.dbPath });
  const repo = new HubRepository(database.db);
  const runtime = new CodexRuntime(repo);
  const state: ServerState = { database, repo, runtime };
  const reconciledSessions = repo.reconcileUnavailableTransientSessions();
  if (reconciledSessions > 0) {
    app.log.warn(
      { reconciledSessions },
      "reconciled persisted sessions without live runtime processes",
    );
  }

  app.setErrorHandler((error, _request, reply) => {
    const err = error instanceof Error ? error : new Error(String(error));
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({
        error: { code: err.code, message: err.message },
        message: err.message,
      });
    }

    app.log.error(err);
    return reply.status(500).send({
      error: { code: "internal_error", message: err.message },
      message: err.message,
    });
  });

  app.get("/health", async () => ({ ok: true, service: "codexhub" }));
  app.get("/api/v1/health", async () => ({ ok: true, service: "codexhub" }));

  registerApiRoutes(app, state, "");
  registerApiRoutes(app, state, "/api/v1");

  app.addHook("onClose", async () => {
    await runtime.shutdownAll();
    database.close();
  });

  return app;
}

function registerApiRoutes(
  app: FastifyInstance,
  state: ServerState,
  prefix: string,
): void {
  const path = (route: string) => `${prefix}${route}`;

  app.post(path("/projects"), async (request) => {
    const body = asRecord(request.body);
    const name = requiredString(body, "name");
    const project = state.repo.createProject({
      name,
      default_repo_url: optionalString(body, "default_repo_url"),
      default_workspace_root: optionalString(body, "default_workspace_root"),
      default_cwd: optionalString(body, "default_cwd"),
      default_branch: optionalString(body, "default_branch"),
      default_codex_options: body.default_codex_options ?? null,
    });
    return { project };
  });

  app.get(path("/projects"), async () => {
    const items = state.repo.listProjects();
    return { items, projects: items, next_cursor: null, limit: items.length };
  });

  app.get(path("/projects/:id/sessions"), async (request) => {
    const params = asRecord(request.params);
    const query = asRecord(request.query);
    const project = state.repo.getProject(requiredString(params, "id"));
    if (!project)
      throw new HttpError(404, "project_not_found", "project not found");
    const listOptions: SessionListOptions = { project_id: project.id };
    const status = optionalString(query, "status");
    const limit = optionalNumber(query, "limit");
    const cursor = optionalString(query, "cursor");
    if (status) listOptions.status = status as WorkerSession["status"];
    if (limit !== undefined) listOptions.limit = limit;
    if (cursor) listOptions.cursor = cursor;
    const page = state.repo.listSessions(listOptions);
    return { ...page, sessions: page.items };
  });

  app.post(path("/workspaces"), async (request) => {
    const body = asRecord(request.body);
    const projectId =
      optionalString(body, "project_id") ?? optionalString(body, "project");
    if (!projectId)
      throw new HttpError(
        400,
        "project_required",
        "project_id or project is required",
      );
    const project = state.repo.getProject(projectId);
    if (!project)
      throw new HttpError(404, "project_not_found", "project not found");

    const built = tryBuildWorkspace({
      project,
      source_type: parseWorkspaceSource(optionalString(body, "source_type")),
      repo_url: optionalString(body, "repo_url"),
      path: optionalString(body, "path"),
      cwd: optionalString(body, "cwd"),
      branch: optionalString(body, "branch"),
      commit_sha: optionalString(body, "commit_sha"),
    });

    const workspace = state.repo.createWorkspace({
      project_id: project.id,
      ...built,
    });
    return { workspace };
  });

  app.get(path("/workspaces"), async (request) => {
    const query = asRecord(request.query);
    const items = state.repo.listWorkspaces(
      optionalString(query, "project_id") ?? optionalString(query, "project"),
    );
    return { items, workspaces: items, next_cursor: null, limit: items.length };
  });

  app.get(path("/workspaces/:id"), async (request) => {
    const workspace = state.repo.getWorkspace(
      requiredString(asRecord(request.params), "id"),
    );
    if (!workspace)
      throw new HttpError(404, "workspace_not_found", "workspace not found");
    return { workspace };
  });

  app.post(path("/sessions"), async (request) => {
    const body = asRecord(request.body);
    const workspace = state.repo.getWorkspace(
      requiredString(body, "workspace_id"),
    );
    if (!workspace)
      throw new HttpError(404, "workspace_not_found", "workspace not found");
    const project = state.repo.getProject(
      optionalString(body, "project_id") ?? workspace.project_id,
    );
    if (!project)
      throw new HttpError(404, "project_not_found", "project not found");
    const prompt =
      optionalString(body, "initial_message") ?? optionalString(body, "prompt");
    if (!prompt || prompt.trim() === "")
      throw new HttpError(
        400,
        "prompt_required",
        "initial_message or prompt is required",
      );

    const session = state.repo.createSession({
      project_id: project.id,
      workspace_id: workspace.id,
    });
    const message = state.repo.createMessage({
      session_id: session.id,
      mode: "initial",
      content: prompt,
      sender_type:
        parseSenderType(optionalString(body, "sender_type")) ?? "manager_agent",
      sender_id: optionalString(body, "sender_id"),
    });

    const started = await state.runtime.startSession(session, workspace, {
      initialMessage: message,
      codexOptions: body.codex_options ?? project.default_codex_options,
    });
    return { session: started, workspace };
  });

  app.get(path("/sessions"), async (request) => {
    const query = asRecord(request.query);
    const listOptions: SessionListOptions = {};
    const projectId =
      optionalString(query, "project_id") ?? optionalString(query, "project");
    const workspaceId =
      optionalString(query, "workspace_id") ??
      optionalString(query, "workspace");
    const status = optionalString(query, "status");
    const limit = optionalNumber(query, "limit");
    const cursor = optionalString(query, "cursor");
    if (projectId) listOptions.project_id = projectId;
    if (workspaceId) listOptions.workspace_id = workspaceId;
    if (status) listOptions.status = status as WorkerSession["status"];
    if (limit !== undefined) listOptions.limit = limit;
    if (cursor) listOptions.cursor = cursor;
    const page = state.repo.listSessions(listOptions);
    return { ...page, sessions: page.items };
  });

  app.get(path("/sessions/:id"), async (request) => {
    const session = requireSession(
      state.repo,
      requiredString(asRecord(request.params), "id"),
    );
    const workspace =
      state.repo.getWorkspace(session.workspace_id) ?? undefined;
    return { session, workspace };
  });

  app.post(path("/sessions/:id/messages"), async (request) => {
    const session = requireSession(
      state.repo,
      requiredString(asRecord(request.params), "id"),
    );
    const workspace = state.repo.getWorkspace(session.workspace_id);
    if (!workspace)
      throw new HttpError(404, "workspace_not_found", "workspace not found");
    if (isTerminalStatus(session.status))
      throw new HttpError(
        409,
        "session_terminal",
        `session is ${session.status}`,
      );

    const body = asRecord(request.body);
    const mode = parseMessageMode(requiredString(body, "mode"));
    const content = optionalString(body, "content") ?? "";
    if (mode === "steer" && content.trim() === "")
      throw new HttpError(400, "message_required", "steer content is required");
    if (mode === "continue" && content.trim() === "")
      throw new HttpError(
        400,
        "message_required",
        "continue content is required",
      );

    const message = state.repo.createMessage({
      session_id: session.id,
      mode,
      content,
      sender_type:
        parseSenderType(optionalString(body, "sender_type")) ?? "human",
      sender_id: optionalString(body, "sender_id"),
    });

    const updatedSession = await state.runtime.sendMessage(session, workspace, {
      message,
    });
    return {
      message:
        state.repo
          .listMessages(session.id)
          .find((entry) => entry.id === message.id) ?? message,
      session: updatedSession,
    };
  });

  app.get(path("/sessions/:id/messages"), async (request) => {
    const session = requireSession(
      state.repo,
      requiredString(asRecord(request.params), "id"),
    );
    const items = state.repo.listMessages(session.id);
    return { items, messages: items, next_cursor: null, limit: items.length };
  });

  app.post(path("/sessions/:id/stop"), async (request) => {
    const id = requiredString(asRecord(request.params), "id");
    requireSession(state.repo, id);
    state.runtime.stopSession(id);
    return { session: requireSession(state.repo, id) };
  });

  app.post(path("/sessions/:id/complete"), async (request) => {
    const id = requiredString(asRecord(request.params), "id");
    requireSession(state.repo, id);
    return { session: state.runtime.completeSession(id) };
  });

  app.get(path("/sessions/:id/items"), async (request) => {
    const params = asRecord(request.params);
    const query = asRecord(request.query);
    const session = requireSession(state.repo, requiredString(params, "id"));
    return itemPageResponse(state, session.id, query);
  });

  app.get(path("/items"), async (request) => {
    const query = asRecord(request.query);
    const sessionId = requiredString(query, "session_id");
    requireSession(state.repo, sessionId);
    return itemPageResponse(state, sessionId, query);
  });

  app.get(path("/sessions/:id/items/latest"), async (request) =>
    latestResponse(state, request, false),
  );
  app.get(path("/sessions/:id/latest"), async (request) =>
    latestResponse(state, request, true),
  );
}

function itemPageResponse(
  state: ServerState,
  sessionId: string,
  query: Record<string, unknown>,
) {
  const type = parseItemType(optionalString(query, "type"), "agentmessage");
  const after =
    optionalNumber(query, "after") ??
    optionalNumber(query, "after_sequence") ??
    optionalNumber(query, "cursor");
  const before =
    optionalNumber(query, "before") ?? optionalNumber(query, "before_sequence");
  const itemOptions: ItemPageOptions = { type };
  const recent = optionalBoolean(query, "recent");
  const limit = optionalNumber(query, "limit");
  if (limit !== undefined) itemOptions.limit = limit;
  if (after !== undefined) itemOptions.after = after;
  if (before !== undefined) itemOptions.before = before;
  if (recent !== undefined) itemOptions.recent = recent;
  const page = state.repo.listItems(sessionId, itemOptions);
  return { ...page, session_id: sessionId, type };
}

function latestResponse(
  state: ServerState,
  request: { params: unknown; query: unknown },
  includeSession: boolean,
) {
  const session = requireSession(
    state.repo,
    requiredString(asRecord(request.params), "id"),
  );
  const type = parseItemType(
    optionalString(asRecord(request.query), "type"),
    "agentmessage",
  );
  const item = state.repo.latestItem(session.id, type);
  return includeSession
    ? {
        session_id: session.id,
        type,
        item,
        session,
        last_agent_message: session.last_agent_message,
      }
    : { session_id: session.id, type, item };
}

function requireSession(repo: HubRepository, id: string): WorkerSession {
  const session = repo.getSession(id);
  if (!session)
    throw new HttpError(404, "session_not_found", "session not found");
  return session;
}

function tryBuildWorkspace(input: Parameters<typeof buildWorkspace>[0]) {
  try {
    return buildWorkspace(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new HttpError(400, "workspace_build_failed", message);
  }
}

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value))
    return value as Record<string, unknown>;
  return {};
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value === "string" && value.trim() !== "") return value;
  throw new HttpError(400, "invalid_request", `${key} is required`);
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function optionalNumber(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function optionalBoolean(
  record: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = record[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true" || value === "1") return true;
    if (value === "false" || value === "0") return false;
  }
  return undefined;
}

function parseWorkspaceSource(value: string | null): "git" | "local" | null {
  if (value === null) return null;
  if (value === "git" || value === "local") return value;
  throw new HttpError(
    400,
    "invalid_workspace_source",
    "source_type must be git or local",
  );
}

function parseMessageMode(value: string): MessageMode {
  if (value === "initial" || value === "steer" || value === "continue")
    return value;
  throw new HttpError(
    400,
    "invalid_message_mode",
    "mode must be initial, steer, or continue",
  );
}

function parseSenderType(value: string | null): SenderType | null {
  if (value === null) return null;
  if (value === "manager_agent" || value === "human" || value === "system")
    return value;
  throw new HttpError(
    400,
    "invalid_sender_type",
    "sender_type must be manager_agent, human, or system",
  );
}

function parseItemType(
  value: string | null,
  fallback: ItemType | "all",
): ItemType | "all" {
  if (value === null) return fallback;
  if (
    value === "all" ||
    value === "agentmessage" ||
    value === "toolcall" ||
    value === "toolresult" ||
    value === "error" ||
    value === "state" ||
    value === "reasoning" ||
    value === "raw"
  ) {
    return value;
  }
  throw new HttpError(400, "invalid_item_type", "unsupported item type");
}
