import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import type {
  ReviewFindingSeverity,
  ReviewFindingStatus,
  ItemType,
  MessageMode,
  SenderType,
  TaskSpecMetadata,
  TranscriptPageOptions,
  WorkerSession,
} from "@codexhub/core";
import { canStartFollowUpSession, isTerminalStatus } from "@codexhub/core";
import { openDatabase, type CodexHubDatabase } from "./database.js";
import {
  HubRepository,
  type CreateReviewFindingInput,
  type CreateTaskSpecInput,
  type ItemPageOptions,
  type ReviewFindingListOptions,
  type SessionListOptions,
  type UpdateReviewFindingInput,
  type UpdateReviewGateStatusInput,
} from "./repository.js";
import { CodexRuntime, SessionProcessUnavailableError } from "./runtime.js";
import { cleanupWorkspace } from "./workspace-cleanup.js";
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
        error: { code: err.code, message: err.message, ...err.details },
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

  app.post(path("/run-groups"), async (request) => {
    const body = asRecord(request.body);
    const projectId = optionalString(body, "project_id");
    if (projectId && !state.repo.getProject(projectId))
      throw new HttpError(404, "project_not_found", "project not found");
    const runGroup = state.repo.createRunGroup({
      name: requiredString(body, "name"),
      project_id: projectId,
      purpose: optionalString(body, "purpose"),
    });
    return { run_group: runGroup };
  });

  app.get(path("/run-groups"), async (request) => {
    const query = asRecord(request.query);
    const items = state.repo.listRunGroups(optionalString(query, "project_id"));
    return {
      items,
      run_groups: items,
      next_cursor: null,
      limit: items.length,
    };
  });

  app.get(path("/run-groups/:id"), async (request) => {
    const runGroup = state.repo.getRunGroup(
      requiredString(asRecord(request.params), "id"),
    );
    if (!runGroup)
      throw new HttpError(404, "run_group_not_found", "run group not found");
    return { run_group: runGroup };
  });

  app.post(path("/run-groups/:id/sessions"), async (request) => {
    const id = requiredString(asRecord(request.params), "id");
    if (!state.repo.getRunGroup(id))
      throw new HttpError(404, "run_group_not_found", "run group not found");
    const sessionId = requiredString(asRecord(request.body), "session_id");
    const session = requireSession(state.repo, sessionId);
    state.repo.addSessionToRunGroup(id, session.id);
    return {
      run_group: state.repo.getRunGroup(id),
      sessions: state.repo.listRunGroupSessions(id),
    };
  });

  app.get(path("/run-groups/:id/sessions"), async (request) => {
    const id = requiredString(asRecord(request.params), "id");
    if (!state.repo.getRunGroup(id))
      throw new HttpError(404, "run_group_not_found", "run group not found");
    const items = state.repo.listRunGroupSessions(id);
    return { items, sessions: items, next_cursor: null, limit: items.length };
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
      mode: parseWorkspaceMode(
        optionalString(body, "mode") ?? optionalString(body, "workspace_mode"),
      ),
      repo_url: optionalString(body, "repo_url"),
      repo_path: optionalString(body, "repo_path"),
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

  app.post(path("/workspaces/:id/cleanup"), async (request) => {
    const workspace = state.repo.getWorkspace(
      requiredString(asRecord(request.params), "id"),
    );
    if (!workspace)
      throw new HttpError(404, "workspace_not_found", "workspace not found");

    const activeSessions = state.repo
      .listSessions({ workspace_id: workspace.id, limit: 100 })
      .items.filter((session) => !isTerminalStatus(session.status));
    if (activeSessions.length > 0) {
      throw new HttpError(
        409,
        "workspace_has_active_sessions",
        "workspace has active sessions",
      );
    }

    const deleteFiles =
      optionalBoolean(asRecord(request.body), "delete_files") === true;
    try {
      const cleanup = await cleanupWorkspace(workspace, { deleteFiles });
      const updated = state.repo.updateWorkspace(workspace.id, {
        status: cleanup.status,
        last_error: null,
      });
      return { workspace: updated, cleanup };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.repo.updateWorkspace(workspace.id, { last_error: message });
      throw new HttpError(400, "workspace_cleanup_failed", message);
    }
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
    const taskSpec = parseTaskSpec(optionalRecord(body, "task_spec"));
    if (taskSpec) {
      state.repo.createTaskSpec({ session_id: session.id, ...taskSpec });
    }
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

  app.post(path("/sessions/:id/follow-up"), async (request) => {
    const previousSession = requireSession(
      state.repo,
      requiredString(asRecord(request.params), "id"),
    );
    if (!canStartFollowUpSession(previousSession.status)) {
      throw new HttpError(
        409,
        "session_not_terminal",
        `session is ${previousSession.status}; follow-up sessions require a stopped, completed, or failed source session`,
      );
    }

    const body = asRecord(request.body);
    const workspaceId =
      optionalString(body, "workspace_id") ??
      optionalString(body, "workspace") ??
      previousSession.workspace_id;
    const workspace = state.repo.getWorkspace(workspaceId);
    if (!workspace)
      throw new HttpError(404, "workspace_not_found", "workspace not found");
    if (workspace.project_id !== previousSession.project_id) {
      throw new HttpError(
        400,
        "workspace_project_mismatch",
        "follow-up workspace must belong to the previous session project",
      );
    }

    const project = state.repo.getProject(previousSession.project_id);
    if (!project)
      throw new HttpError(404, "project_not_found", "project not found");
    const prompt =
      optionalString(body, "initial_message") ?? optionalString(body, "prompt");
    if (!prompt || prompt.trim() === "") {
      throw new HttpError(
        400,
        "prompt_required",
        "initial_message or prompt is required",
      );
    }

    const session = state.repo.createSession({
      project_id: previousSession.project_id,
      workspace_id: workspace.id,
      previous_session_id: previousSession.id,
    });
    const previousTaskSpec = state.repo.getTaskSpec(previousSession.id);
    const taskSpec = mergeTaskSpec(
      previousTaskSpec,
      optionalRecord(body, "task_spec"),
    );
    if (taskSpec) {
      state.repo.createTaskSpec({ session_id: session.id, ...taskSpec });
    }
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
    return {
      session: started,
      previous_session_id: previousSession.id,
      previous_session: previousSession,
      workspace,
      task_spec: state.repo.getTaskSpec(session.id),
    };
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
    const task_spec = state.repo.getTaskSpec(session.id);
    return { session, workspace, task_spec };
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

    let updatedSession: WorkerSession;
    try {
      updatedSession = await state.runtime.sendMessage(session, workspace, {
        message,
      });
    } catch (error) {
      if (error instanceof SessionProcessUnavailableError) {
        throw new HttpError(409, error.code, error.message);
      }
      throw error;
    }
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

  app.get(path("/sessions/:id/review-status"), async (request) => {
    const session = requireSession(
      state.repo,
      requiredString(asRecord(request.params), "id"),
    );
    return { review_status: state.repo.getReviewGateStatus(session.id) };
  });

  app.put(path("/sessions/:id/review-status"), async (request) => {
    const session = requireSession(
      state.repo,
      requiredString(asRecord(request.params), "id"),
    );
    return {
      review_status: state.repo.updateReviewGateStatus(
        session.id,
        parseReviewGateStatusUpdate(asRecord(request.body)),
      ),
    };
  });

  app.get(path("/sessions/:id/review-findings"), async (request) => {
    const session = requireSession(
      state.repo,
      requiredString(asRecord(request.params), "id"),
    );
    const query = asRecord(request.query);
    const listOptions: ReviewFindingListOptions = {};
    const limit = optionalNumber(query, "limit");
    const cursor = optionalString(query, "cursor");
    if (limit !== undefined) listOptions.limit = limit;
    if (cursor) listOptions.cursor = cursor;
    const page = state.repo.listReviewFindings(session.id, listOptions);
    return {
      ...page,
      session_id: session.id,
      review_findings: page.items,
    };
  });

  app.post(path("/sessions/:id/review-findings"), async (request) => {
    const session = requireSession(
      state.repo,
      requiredString(asRecord(request.params), "id"),
    );
    const body = asRecord(request.body);
    const reviewerSessionId = requireSession(
      state.repo,
      requiredString(body, "reviewer_session_id"),
    ).id;
    const input = parseReviewFindingCreate(body);
    return {
      review_finding: state.repo.createReviewFinding({
        session_id: session.id,
        reviewer_session_id: reviewerSessionId,
        ...input,
      }),
    };
  });

  app.put(path("/sessions/:id/review-findings/:findingId"), async (request) => {
    const params = asRecord(request.params);
    const session = requireSession(state.repo, requiredString(params, "id"));
    const findingId = requiredString(params, "findingId");
    if (!state.repo.getReviewFinding(session.id, findingId)) {
      throw new HttpError(
        404,
        "review_finding_not_found",
        "review finding not found",
      );
    }
    return {
      review_finding: state.repo.updateReviewFinding(
        session.id,
        findingId,
        parseReviewFindingUpdate(asRecord(request.body)),
      ),
    };
  });

  app.post(path("/sessions/:id/stop"), async (request) => {
    const session = requireSession(
      state.repo,
      requiredString(asRecord(request.params), "id"),
    );
    state.runtime.stopSession(session.id);
    return { session: requireSession(state.repo, session.id) };
  });

  app.post(path("/sessions/:id/complete"), async (request) => {
    const session = requireSession(
      state.repo,
      requiredString(asRecord(request.params), "id"),
    );
    return { session: state.runtime.completeSession(session.id) };
  });

  app.get(path("/sessions/:id/items"), async (request) => {
    const params = asRecord(request.params);
    const query = asRecord(request.query);
    const session = requireSession(state.repo, requiredString(params, "id"));
    return itemPageResponse(state, session.id, query);
  });

  app.get(path("/sessions/:id/transcript"), async (request) => {
    const params = asRecord(request.params);
    const query = asRecord(request.query);
    const session = requireSession(state.repo, requiredString(params, "id"));
    return transcriptPageResponse(state, session.id, query);
  });

  app.get(path("/items"), async (request) => {
    const query = asRecord(request.query);
    const sessionId = requiredString(query, "session_id");
    const session = requireSession(state.repo, sessionId);
    return itemPageResponse(state, session.id, query);
  });

  app.get(path("/transcript"), async (request) => {
    const query = asRecord(request.query);
    const sessionId = requiredString(query, "session_id");
    const session = requireSession(state.repo, sessionId);
    return transcriptPageResponse(state, session.id, query);
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

function transcriptPageResponse(
  state: ServerState,
  sessionId: string,
  query: Record<string, unknown>,
) {
  const after =
    optionalNumber(query, "after") ??
    optionalNumber(query, "after_sequence") ??
    optionalNumber(query, "cursor");
  const before =
    optionalNumber(query, "before") ?? optionalNumber(query, "before_sequence");
  const transcriptOptions: TranscriptPageOptions = {};
  const recent = optionalBoolean(query, "recent");
  const limit = optionalNumber(query, "limit");
  if (limit !== undefined) transcriptOptions.limit = limit;
  if (after !== undefined) transcriptOptions.after = after;
  if (before !== undefined) transcriptOptions.before = before;
  if (recent !== undefined) transcriptOptions.recent = recent;
  const page = state.repo.listTranscript(sessionId, transcriptOptions);
  return { ...page, session_id: sessionId, transcript: page.items };
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
  const item = latestManagerItem(
    state,
    session,
    state.repo.latestItem(session.id, type),
    includeSession,
    type,
  );
  const stableLatest = includeSession && requiresStableAgentLatest(type);
  const stableLastAgentMessage = stableLatest
    ? (item?.text_excerpt ?? null)
    : null;
  const responseSession = stableLatest
    ? {
        ...session,
        last_agent_message_item_id: item?.id ?? null,
        last_agent_message: stableLastAgentMessage,
        last_agent_message_at: item?.created_at ?? null,
      }
    : session;
  return includeSession
    ? {
        session_id: session.id,
        type,
        item,
        session: responseSession,
        last_agent_message: stableLatest
          ? stableLastAgentMessage
          : session.last_agent_message,
      }
    : { session_id: session.id, type, item };
}

function latestManagerItem(
  state: ServerState,
  session: WorkerSession,
  item: import("@codexhub/core").Item | null,
  includeSession: boolean,
  type: ItemType | "all",
): import("@codexhub/core").Item | null {
  if (!includeSession || !requiresStableAgentLatest(type)) {
    return item;
  }

  const projectedSource = session.last_agent_message_item_id
    ? state.repo.getItem(session.last_agent_message_item_id)
    : null;
  if (isCompletedAgentMessage(projectedSource)) return projectedSource;

  return state.repo.latestCompletedAgentMessage(session.id);
}

function requiresStableAgentLatest(type: ItemType | "all"): boolean {
  return type === "agentmessage" || type === "all";
}

function isCompletedAgentMessage(
  item: import("@codexhub/core").Item | null,
): boolean {
  return (
    item?.type === "agentmessage" &&
    item.codex_method === "item/completed" &&
    typeof item.text_excerpt === "string" &&
    item.text_excerpt.trim() !== ""
  );
}

function requireSession(repo: HubRepository, reference: string): WorkerSession {
  const result = repo.resolveSession(reference);
  if (result.status === "found") return result.session;
  if (result.status === "ambiguous") {
    throw new HttpError(
      409,
      "session_id_ambiguous",
      `session id prefix "${result.reference}" is ambiguous; pass a longer prefix or canonical session id`,
      {
        candidate_ids: result.matches.map((session) => session.id),
      },
    );
  }
  if (result.status === "not_found")
    throw new HttpError(404, "session_not_found", "session not found");
  throw new HttpError(404, "session_not_found", "session not found");
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
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value))
    return value as Record<string, unknown>;
  return {};
}

function optionalRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const value = record[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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

function parseWorkspaceMode(value: string | null): "worktree" | null {
  if (value === null || value === "standard") return null;
  if (value === "worktree") return value;
  throw new HttpError(
    400,
    "invalid_workspace_mode",
    "mode must be standard or worktree",
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

function parseReviewGateStatusUpdate(
  record: Record<string, unknown>,
): UpdateReviewGateStatusInput {
  const fields = [
    "implementation_done",
    "self_validation_done",
    "review_requested",
    "review_addressed",
    "ready_for_human_review",
  ] as const;
  const update: UpdateReviewGateStatusInput = {};
  for (const field of fields) {
    const value = record[field];
    if (value === undefined) continue;
    if (typeof value !== "boolean") {
      throw new HttpError(
        400,
        "invalid_review_status",
        `${field} must be boolean`,
      );
    }
    update[field] = value;
  }

  if ("note" in record) {
    const value = record.note;
    if (value !== null && typeof value !== "string") {
      throw new HttpError(400, "invalid_review_status", "note must be string");
    }
    update.note = value;
  }
  return update;
}

function parseReviewFindingCreate(
  record: Record<string, unknown>,
): Omit<CreateReviewFindingInput, "session_id" | "reviewer_session_id"> {
  const severity = parseReviewFindingSeverity(
    requiredString(record, "severity"),
  );
  const summary = requiredString(record, "summary");
  const details = optionalNullableReviewString(record, "details");
  return details === undefined
    ? { severity, summary }
    : { severity, summary, details };
}

function parseReviewFindingUpdate(
  record: Record<string, unknown>,
): UpdateReviewFindingInput {
  const update: UpdateReviewFindingInput = {};
  if ("status" in record) {
    const value = record.status;
    if (typeof value !== "string") {
      throw new HttpError(
        400,
        "invalid_review_finding",
        "status must be string",
      );
    }
    update.status = parseReviewFindingStatus(value);
  }
  if ("worker_response" in record) {
    const value = record.worker_response;
    if (value !== null && typeof value !== "string") {
      throw new HttpError(
        400,
        "invalid_review_finding",
        "worker_response must be string",
      );
    }
    update.worker_response = value;
  }
  return update;
}

function parseReviewFindingSeverity(value: string): ReviewFindingSeverity {
  if (
    value === "info" ||
    value === "low" ||
    value === "medium" ||
    value === "high"
  ) {
    return value;
  }
  throw new HttpError(
    400,
    "invalid_review_finding",
    "severity must be info, low, medium, or high",
  );
}

function parseReviewFindingStatus(value: string): ReviewFindingStatus {
  if (
    value === "open" ||
    value === "accepted" ||
    value === "rejected" ||
    value === "deferred"
  ) {
    return value;
  }
  throw new HttpError(
    400,
    "invalid_review_finding",
    "status must be open, accepted, rejected, or deferred",
  );
}

function optionalNullableReviewString(
  record: Record<string, unknown>,
  key: string,
): string | null | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string") return value;
  throw new HttpError(400, "invalid_review_finding", `${key} must be string`);
}

function parseTaskSpec(
  record: Record<string, unknown> | null,
): Omit<CreateTaskSpecInput, "session_id"> | null {
  if (!record) return null;
  const taskSpec = {
    ref: optionalNullableString(record, "ref"),
    title: optionalNullableString(record, "title"),
    intent: optionalNullableString(record, "intent"),
    scope: optionalNullableString(record, "scope"),
    acceptance_criteria: optionalNullableString(record, "acceptance_criteria"),
    raw: optionalNullableString(record, "raw"),
  };
  const hasValue = Object.values(taskSpec).some(
    (value) => typeof value === "string" && value.trim() !== "",
  );
  return hasValue ? taskSpec : null;
}

const taskSpecFields = [
  "ref",
  "title",
  "intent",
  "scope",
  "acceptance_criteria",
  "raw",
] as const;

type TaskSpecField = (typeof taskSpecFields)[number];
type TaskSpecInputMetadata = Omit<CreateTaskSpecInput, "session_id">;

function mergeTaskSpec(
  source: TaskSpecMetadata | null,
  overrides: Record<string, unknown> | null,
): TaskSpecInputMetadata | null {
  const taskSpec = copyTaskSpec(source);
  if (!overrides) return taskSpec;

  const merged = taskSpec ?? emptyTaskSpec();
  let hasOverrideValue = false;
  for (const field of taskSpecFields) {
    const value = overrides[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") {
      throw new HttpError(400, "invalid_task_spec", `${field} must be string`);
    }
    merged[field] = value;
    hasOverrideValue ||= value.trim() !== "";
  }

  return taskSpec || hasOverrideValue ? merged : null;
}

function emptyTaskSpec(): Record<TaskSpecField, string | null> {
  return {
    ref: null,
    title: null,
    intent: null,
    scope: null,
    acceptance_criteria: null,
    raw: null,
  };
}

function copyTaskSpec(
  taskSpec: TaskSpecMetadata | null,
): TaskSpecInputMetadata | null {
  if (!taskSpec) return null;
  return {
    ref: taskSpec.ref,
    title: taskSpec.title,
    intent: taskSpec.intent,
    scope: taskSpec.scope,
    acceptance_criteria: taskSpec.acceptance_criteria,
    raw: taskSpec.raw,
  };
}

function optionalNullableString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  throw new HttpError(400, "invalid_task_spec", `${key} must be string`);
}
