import Fastify, { type FastifyInstance } from "fastify";
import type { WorkerSession, Workspace } from "@codexhub/core";
import { openDatabase, type CodexHubDatabase } from "./database.js";
import { HubRepository } from "./repository.js";
import {
  CodexRuntime,
  SessionProcessUnavailableError,
  type CodexRuntimeController,
  type SendOptions,
  type StartOptions,
} from "./runtime.js";

export interface CreateRuntimeSupervisorServerOptions {
  dbPath?: string;
  logger?: boolean;
  runtimeFactory?: (repo: HubRepository) => CodexRuntimeController;
}

export interface SupervisorRuntimeClientOptions {
  requestTimeoutMs?: number;
  fetch?: typeof fetch;
}

interface RuntimeSupervisorState {
  database: CodexHubDatabase;
  runtime: CodexRuntimeController;
}

interface RuntimeSupervisorResponse {
  error?: {
    code?: unknown;
    message?: unknown;
    session_id?: unknown;
  };
}

const DEFAULT_SUPERVISOR_REQUEST_TIMEOUT_MS = 5_000;

export async function createRuntimeSupervisorServer(
  options: CreateRuntimeSupervisorServerOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? true });
  const database = openDatabase({ path: options.dbPath });
  const repo = new HubRepository(database.db);
  const runtime = options.runtimeFactory?.(repo) ?? new CodexRuntime(repo);
  const state: RuntimeSupervisorState = { database, runtime };

  app.setErrorHandler((error, _request, reply) => {
    const err = error instanceof Error ? error : new Error(String(error));
    if (err instanceof RuntimeSupervisorHttpError) {
      return reply.status(err.statusCode).send({
        error: { code: err.code, message: err.message },
        message: err.message,
      });
    }
    if (err instanceof SessionProcessUnavailableError) {
      return reply.status(409).send({
        error: {
          code: err.code,
          message: err.message,
          session_id: err.sessionId,
        },
        message: err.message,
      });
    }

    app.log.error(err);
    return reply.status(500).send({
      error: { code: "internal_error", message: err.message },
      message: err.message,
    });
  });

  app.get("/health", async () => ({
    ok: true,
    service: "codexhub-runtime-supervisor",
  }));
  app.get("/api/v1/health", async () => ({
    ok: true,
    service: "codexhub-runtime-supervisor",
  }));

  registerRuntimeSupervisorRoutes(app, state, "");
  registerRuntimeSupervisorRoutes(app, state, "/api/v1");

  app.addHook("onClose", async () => {
    await runtime.shutdownAll();
    database.close();
  });

  return app;
}

export class SupervisorRuntimeClient implements CodexRuntimeController {
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly repo: HubRepository,
    supervisorUrl: string,
    options: SupervisorRuntimeClientOptions = {},
  ) {
    this.baseUrl = normalizeSupervisorUrl(supervisorUrl);
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_SUPERVISOR_REQUEST_TIMEOUT_MS;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (!this.fetchImpl) {
      throw new Error("global fetch is required for SupervisorRuntimeClient");
    }
  }

  async hasLiveSession(session: WorkerSession): Promise<boolean> {
    const response = await this.postJson<{ live?: unknown }>(
      "runtime/has-live-session",
      { session },
    );
    return response.live === true;
  }

  async startSession(
    session: WorkerSession,
    workspace: Workspace,
    options: StartOptions,
  ): Promise<WorkerSession> {
    try {
      const response = await this.postJson<{ session?: unknown }>(
        "runtime/sessions/start",
        { session, workspace, options },
      );
      return responseWorkerSession(response);
    } catch (error) {
      if (
        error instanceof RuntimeSupervisorUnavailableError ||
        error instanceof SessionProcessUnavailableError
      ) {
        this.repo.markMessageFailed(options.initialMessage.id, error.message);
        this.repo.updateSession(session.id, {
          status: "failed",
          failure_reason: error.message,
          process_pid: null,
          ended_at: new Date().toISOString(),
        });
      }
      throw error;
    }
  }

  async sendMessage(
    session: WorkerSession,
    workspace: Workspace,
    options: SendOptions,
  ): Promise<WorkerSession> {
    try {
      const response = await this.postJson<{ session?: unknown }>(
        `runtime/sessions/${encodeURIComponent(session.id)}/messages`,
        { session, workspace, options },
      );
      return responseWorkerSession(response);
    } catch (error) {
      if (isSupervisorConnectionUnavailable(error)) {
        throw new SessionProcessUnavailableError(
          session.id,
          "runtime supervisor is unavailable; session cannot be proven live. Start a follow-up session.",
        );
      }
      throw error;
    }
  }

  async stopSession(sessionId: string): Promise<void> {
    await this.postJson<{ ok?: unknown }>(
      `runtime/sessions/${encodeURIComponent(sessionId)}/stop`,
      {},
    );
  }

  async completeSession(sessionId: string): Promise<WorkerSession> {
    const response = await this.postJson<{ session?: unknown }>(
      `runtime/sessions/${encodeURIComponent(sessionId)}/complete`,
      {},
    );
    return responseWorkerSession(response);
  }

  async shutdownAll(): Promise<void> {
    return Promise.resolve();
  }

  private async postJson<T>(path: string, payload: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint(path), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      throw new RuntimeSupervisorUnavailableError(
        `runtime supervisor is unavailable: ${errorMessage(error)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    const body = await readJson(response);
    if (!response.ok) {
      throw supervisorResponseError(response, body);
    }
    return body as T;
  }

  private endpoint(path: string): string {
    return new URL(path.replace(/^\/+/, ""), this.baseUrl).toString();
  }
}

export class RuntimeSupervisorUnavailableError extends Error {
  readonly code = "runtime_supervisor_unavailable";

  constructor(
    message: string,
    readonly statusCode?: number,
    readonly upstreamCode?: string,
  ) {
    super(message);
    this.name = "RuntimeSupervisorUnavailableError";
  }
}

function registerRuntimeSupervisorRoutes(
  app: FastifyInstance,
  state: RuntimeSupervisorState,
  prefix: string,
): void {
  const path = (route: string) => `${prefix}${route}`;

  app.post(path("/runtime/has-live-session"), async (request) => {
    const body = asRecord(request.body);
    const session = requiredRecord(body, "session") as unknown as WorkerSession;
    return { live: await state.runtime.hasLiveSession(session) };
  });

  app.post(path("/runtime/sessions/start"), async (request) => {
    const body = asRecord(request.body);
    const session = requiredRecord(body, "session") as unknown as WorkerSession;
    const workspace = requiredRecord(body, "workspace") as unknown as Workspace;
    const rawOptions = requiredRecord(body, "options");
    const initialMessage = requiredRecord(
      rawOptions,
      "initialMessage",
    ) as unknown as StartOptions["initialMessage"];
    const options: StartOptions = {
      initialMessage,
      ...("codexOptions" in rawOptions
        ? { codexOptions: rawOptions.codexOptions }
        : {}),
    };
    return {
      session: await state.runtime.startSession(session, workspace, options),
    };
  });

  app.post(path("/runtime/sessions/:id/messages"), async (request) => {
    const body = asRecord(request.body);
    const session = requiredRecord(body, "session") as unknown as WorkerSession;
    const workspace = requiredRecord(body, "workspace") as unknown as Workspace;
    const rawOptions = requiredRecord(body, "options");
    const message = requiredRecord(
      rawOptions,
      "message",
    ) as unknown as SendOptions["message"];
    return {
      session: await state.runtime.sendMessage(session, workspace, { message }),
    };
  });

  app.post(path("/runtime/sessions/:id/stop"), async (request) => {
    const sessionId = requiredString(asRecord(request.params), "id");
    await state.runtime.stopSession(sessionId);
    return { ok: true, session_id: sessionId };
  });

  app.post(path("/runtime/sessions/:id/complete"), async (request) => {
    const sessionId = requiredString(asRecord(request.params), "id");
    return { session: await state.runtime.completeSession(sessionId) };
  });
}

class RuntimeSupervisorHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function normalizeSupervisorUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `runtime supervisor URL must be an absolute http(s) URL; received ${JSON.stringify(value)}`,
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `runtime supervisor URL must use http or https; received ${JSON.stringify(value)}`,
    );
  }
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/?$/, "/");
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new RuntimeSupervisorUnavailableError(
      `runtime supervisor returned invalid JSON with HTTP ${response.status}`,
      protocolFailureStatus(response.status),
    );
  }
}

function protocolFailureStatus(status: number): number {
  return status >= 400 ? status : 502;
}

function supervisorResponseError(response: Response, payload: unknown): Error {
  const body = asRecord(payload) as RuntimeSupervisorResponse;
  const error = asRecord(body.error);
  const code = optionalString(error, "code");
  const message =
    optionalString(error, "message") ??
    `runtime supervisor request failed with HTTP ${response.status}`;
  if (code === "session_process_unavailable") {
    const sessionId = optionalString(error, "session_id") ?? "unknown";
    return new SessionProcessUnavailableError(sessionId, message);
  }
  return new RuntimeSupervisorUnavailableError(message, response.status, code);
}

function responseWorkerSession(response: { session?: unknown }): WorkerSession {
  const session = response.session;
  if (!session || typeof session !== "object" || Array.isArray(session)) {
    throw new RuntimeSupervisorUnavailableError(
      "runtime supervisor response did not include a session",
    );
  }
  return session as WorkerSession;
}

function isSupervisorConnectionUnavailable(error: unknown): boolean {
  return (
    error instanceof RuntimeSupervisorUnavailableError &&
    (error.statusCode === undefined || error.statusCode === 503)
  );
}

function requiredRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = record[key];
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new RuntimeSupervisorHttpError(
    400,
    "invalid_request",
    `${key} is required`,
  );
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value === "string" && value.trim() !== "") return value;
  throw new RuntimeSupervisorHttpError(
    400,
    "invalid_request",
    `${key} is required`,
  );
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
