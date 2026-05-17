import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Message, WorkerSession, Workspace } from "@codexhub/core";
import {
  canSendMessage,
  statusAfterSendMessage,
  statusAfterTurnCompleted,
} from "@codexhub/core";
import type { HubRepository } from "./repository.js";

interface StartOptions {
  initialMessage: Message;
  codexOptions?: unknown;
}

interface SendOptions {
  message: Message;
}

interface ManagedSession {
  sessionId: string;
  process: ChildProcessWithoutNullStreams;
  pending: Map<number, PendingRequest>;
  nextRequestId: number;
  stopped: boolean;
  lineBuffers: {
    stdout: string;
    stderr: string;
  };
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

interface CodexOptions {
  fake?: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  approvalPolicy?: unknown;
  threadSandbox?: string;
  sandboxPolicy?: unknown;
  responseTimeoutMs?: number;
}

const DEFAULT_RESPONSE_TIMEOUT_MS = 30_000;

export class CodexRuntime {
  private readonly managed = new Map<string, ManagedSession>();

  constructor(private readonly repo: HubRepository) {}

  async startSession(
    session: WorkerSession,
    workspace: Workspace,
    options: StartOptions,
  ): Promise<WorkerSession> {
    const codexOptions = parseCodexOptions(options.codexOptions);
    if (codexOptions.fake || process.env.CODEXHUB_FAKE_CODEX === "1") {
      return this.runFakeTurn(session.id, options.initialMessage);
    }

    const launch = resolveCodexInvocation(codexOptions);
    const child = spawn(launch.command, launch.args, {
      cwd: workspace.cwd,
      env: { ...process.env, ...codexOptions.env },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const managed: ManagedSession = {
      sessionId: session.id,
      process: child,
      pending: new Map(),
      nextRequestId: 1,
      stopped: false,
      lineBuffers: { stdout: "", stderr: "" },
    };

    this.managed.set(session.id, managed);
    this.installProcessHandlers(managed);
    this.repo.updateSession(session.id, {
      status: "starting",
      process_pid: child.pid ? String(child.pid) : null,
      started_at: new Date().toISOString(),
    });

    try {
      await this.sendRequest(
        managed,
        "initialize",
        {
          capabilities: { experimentalApi: true },
          clientInfo: {
            name: "codexhub",
            title: "Codexhub",
            version: "0.1.0",
          },
        },
        codexOptions.responseTimeoutMs,
      );
      this.sendNotification(managed, "initialized", {});

      const threadResult = await this.sendRequest(
        managed,
        "thread/start",
        {
          approvalPolicy: codexOptions.approvalPolicy ?? "never",
          sandbox: codexOptions.threadSandbox ?? "workspace-write",
          cwd: workspace.cwd,
          dynamicTools: [],
        },
        codexOptions.responseTimeoutMs,
      );
      const threadId = extractNestedString(threadResult, ["thread", "id"]);
      if (!threadId)
        throw new Error(
          "Codex thread/start response did not include thread.id",
        );

      const turnResult = await this.startTurn(
        managed,
        workspace,
        threadId,
        options.initialMessage.content,
        codexOptions,
      );
      const turnId = extractNestedString(turnResult, ["turn", "id"]);
      this.repo.markMessageSent(options.initialMessage.id, 3);
      return this.repo.updateSession(session.id, {
        status: "running",
        codex_thread_id: threadId,
        codex_turn_id: turnId,
        codex_session_key: turnId ? `${threadId}-${turnId}` : threadId,
      });
    } catch (error) {
      const message = errorMessage(error);
      this.repo.markMessageFailed(options.initialMessage.id, message);
      this.repo.updateSession(session.id, {
        status: "failed",
        failure_reason: message,
        ended_at: new Date().toISOString(),
      });
      this.stopManaged(session.id);
      throw error;
    }
  }

  async sendMessage(
    session: WorkerSession,
    workspace: Workspace,
    options: SendOptions,
  ): Promise<WorkerSession> {
    const mode = options.message.mode;
    if (!canSendMessage(session.status, mode)) {
      throw new Error(
        `cannot send ${mode} message while session is ${session.status}`,
      );
    }

    if (mode === "initial") {
      throw new Error("initial messages can only be sent during session start");
    }

    if (
      process.env.CODEXHUB_FAKE_CODEX === "1" ||
      session.process_pid === "fake" ||
      session.codex_thread_id === "fake-thread"
    ) {
      return this.runFakeTurn(session.id, options.message);
    }

    const managed = this.managed.get(session.id);
    if (!managed) {
      this.repo.markMessageFailed(
        options.message.id,
        "session process is not available in this server process",
      );
      throw new Error(
        "session process is not available in this server process",
      );
    }

    if (mode === "steer") {
      const content = options.message.content.trim();
      if (!content) throw new Error("steer message content is required");
      const requestId = this.nextRequestId(managed);
      this.sendPayload(managed, {
        method: "turn/steer",
        id: requestId,
        params: {
          threadId: session.codex_thread_id,
          expectedTurnId: session.codex_turn_id,
          input: [{ type: "text", text: content }],
        },
      });
      this.repo.markMessageSent(options.message.id, requestId);
      return this.repo.updateSession(session.id, {
        status: statusAfterSendMessage(mode) ?? session.status,
      });
    }

    const text = options.message.content.trim();
    if (!text) throw new Error("continue message content is required");
    const result = await this.startTurn(
      managed,
      workspace,
      requireString(session.codex_thread_id, "session.codex_thread_id"),
      text,
      {},
    );
    const turnId = extractNestedString(result, ["turn", "id"]);
    this.repo.markMessageSent(options.message.id, 3);
    return this.repo.updateSession(session.id, {
      status: statusAfterSendMessage(mode) ?? "running",
      codex_turn_id: turnId,
      codex_session_key:
        turnId && session.codex_thread_id
          ? `${session.codex_thread_id}-${turnId}`
          : session.codex_session_key,
    });
  }

  stopSession(sessionId: string): void {
    const managed = this.managed.get(sessionId);
    if (managed) {
      managed.stopped = true;
      this.stopManaged(sessionId);
    }
    this.repo.updateSession(sessionId, {
      status: "stopped",
      ended_at: new Date().toISOString(),
    });
  }

  completeSession(sessionId: string): WorkerSession {
    this.stopManaged(sessionId);
    return this.repo.updateSession(sessionId, {
      status: "completed",
      ended_at: new Date().toISOString(),
    });
  }

  async shutdownAll(): Promise<void> {
    for (const sessionId of [...this.managed.keys()]) {
      this.stopManaged(sessionId);
    }
  }

  private async startTurn(
    managed: ManagedSession,
    workspace: Workspace,
    threadId: string,
    message: string,
    codexOptions: CodexOptions,
  ): Promise<unknown> {
    return this.sendRequest(
      managed,
      "turn/start",
      {
        threadId,
        input: [{ type: "text", text: message }],
        cwd: workspace.cwd,
        title: "Codexhub Worker",
        approvalPolicy: codexOptions.approvalPolicy ?? "never",
        sandboxPolicy: codexOptions.sandboxPolicy ?? {
          type: "workspaceWrite",
          writableRoots: [workspace.path],
          readOnlyAccess: { type: "fullAccess" },
          networkAccess: false,
          excludeTmpdirEnvVar: false,
          excludeSlashTmp: false,
        },
      },
      codexOptions.responseTimeoutMs,
    );
  }

  private async runFakeTurn(
    sessionId: string,
    message: Message,
  ): Promise<WorkerSession> {
    this.repo.markMessageSent(message.id, "fake");
    this.repo.updateSession(sessionId, {
      status: "running",
      codex_thread_id: "fake-thread",
      codex_turn_id: `fake-turn-${Date.now()}`,
      codex_session_key: "fake-thread",
      process_pid: "fake",
      started_at: new Date().toISOString(),
    });
    this.repo.appendItem(sessionId, {
      method: "item/completed",
      params: {
        item: {
          id: `fake-agent-${Date.now()}`,
          type: "agentMessage",
          text: `Fake Codex worker received: ${message.content.trim()}`,
        },
      },
    });
    this.repo.appendItem(sessionId, {
      method: "turn/completed",
      params: { mode: message.mode },
    });
    return this.repo.updateSession(sessionId, {
      status: statusAfterTurnCompleted(),
    });
  }

  private installProcessHandlers(managed: ManagedSession): void {
    managed.process.stdout.setEncoding("utf8");
    managed.process.stderr.setEncoding("utf8");

    managed.process.stdout.on("data", (chunk: string) =>
      this.handleChunk(managed, "stdout", chunk),
    );
    managed.process.stderr.on("data", (chunk: string) =>
      this.handleChunk(managed, "stderr", chunk),
    );
    managed.process.on("error", (error) => {
      this.failPending(managed, error);
      this.repo.appendItem(managed.sessionId, {
        stream: "process",
        error: error.message,
      });
      this.repo.updateSession(managed.sessionId, {
        status: "failed",
        failure_reason: error.message,
        ended_at: new Date().toISOString(),
      });
    });
    managed.process.on("exit", (code, signal) => {
      this.managed.delete(managed.sessionId);
      this.failPending(
        managed,
        new Error(
          `Codex app-server exited code=${code ?? "null"} signal=${signal ?? "null"}`,
        ),
      );
      const current = this.repo.getSession(managed.sessionId);
      if (
        !current ||
        managed.stopped ||
        ["completed", "failed", "stopped"].includes(current.status)
      )
        return;
      this.repo.updateSession(managed.sessionId, {
        status: "failed",
        failure_reason: `Codex app-server exited code=${code ?? "null"} signal=${signal ?? "null"}`,
        ended_at: new Date().toISOString(),
      });
    });
  }

  private handleChunk(
    managed: ManagedSession,
    stream: "stdout" | "stderr",
    chunk: string,
  ): void {
    managed.lineBuffers[stream] += chunk;
    while (true) {
      const newline = managed.lineBuffers[stream].indexOf("\n");
      if (newline === -1) return;
      const line = managed.lineBuffers[stream]
        .slice(0, newline)
        .replace(/\r$/, "");
      managed.lineBuffers[stream] = managed.lineBuffers[stream].slice(
        newline + 1,
      );
      this.handleLine(managed, stream, line);
    }
  }

  private handleLine(
    managed: ManagedSession,
    stream: "stdout" | "stderr",
    line: string,
  ): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let payload: unknown;
    try {
      payload = JSON.parse(trimmed);
    } catch {
      this.repo.appendItem(managed.sessionId, { stream, line: trimmed });
      return;
    }

    this.repo.appendItem(managed.sessionId, payload);
    const record = asRecord(payload) ?? {};
    const responseId = typeof record?.id === "number" ? record.id : null;
    if (responseId !== null) {
      const pending = managed.pending.get(responseId);
      if (pending) {
        managed.pending.delete(responseId);
        clearTimeout(pending.timer);
        if ("error" in record) {
          pending.reject(new Error(JSON.stringify(record.error)));
        } else {
          pending.resolve(record.result);
        }
      }
    }

    const method = typeof record?.method === "string" ? record.method : null;
    if (method === "turn/completed") {
      this.repo.updateSession(managed.sessionId, {
        status: statusAfterTurnCompleted(),
      });
    } else if (method === "turn/failed" || method === "turn/cancelled") {
      this.repo.updateSession(managed.sessionId, {
        status: "failed",
        failure_reason: JSON.stringify(record.params ?? record),
        ended_at: new Date().toISOString(),
      });
    } else if (
      method === "turn/input_required" ||
      method === "turn/needs_input"
    ) {
      this.repo.updateSession(managed.sessionId, { status: "awaiting_input" });
    }
  }

  private sendRequest(
    managed: ManagedSession,
    method: string,
    params: unknown,
    timeoutMs = DEFAULT_RESPONSE_TIMEOUT_MS,
  ): Promise<unknown> {
    const requestId = this.nextRequestId(managed);
    const promise = new Promise<unknown>((resolveResponse, rejectResponse) => {
      const timer = setTimeout(() => {
        managed.pending.delete(requestId);
        rejectResponse(
          new Error(`Codex request ${method} timed out after ${timeoutMs}ms`),
        );
      }, timeoutMs);
      managed.pending.set(requestId, {
        resolve: resolveResponse,
        reject: rejectResponse,
        timer,
      });
    });
    this.sendPayload(managed, { method, id: requestId, params });
    return promise;
  }

  private sendNotification(
    managed: ManagedSession,
    method: string,
    params: unknown,
  ): void {
    this.sendPayload(managed, { method, params });
  }

  private sendPayload(managed: ManagedSession, payload: unknown): void {
    managed.process.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private nextRequestId(managed: ManagedSession): number {
    const id = managed.nextRequestId;
    managed.nextRequestId += 1;
    return id;
  }

  private failPending(managed: ManagedSession, error: Error): void {
    for (const [id, pending] of managed.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      managed.pending.delete(id);
    }
  }

  private stopManaged(sessionId: string): void {
    const managed = this.managed.get(sessionId);
    if (!managed) return;
    this.managed.delete(sessionId);
    this.failPending(managed, new Error("Codex app-server stopped"));
    managed.process.kill();
  }
}

function resolveCodexInvocation(options: CodexOptions): {
  command: string;
  args: string[];
} {
  if (options.command)
    return { command: options.command, args: options.args ?? [] };

  if (process.platform === "win32") {
    const cmd = where("codex.cmd");
    if (cmd) {
      const script = codexJsFromCmd(cmd);
      if (script && existsSync(script))
        return { command: process.execPath, args: [script, "app-server"] };
    }

    const exe = where("codex.exe");
    if (exe) return { command: exe, args: ["app-server"] };
  }

  return { command: "codex", args: ["app-server"] };
}

function where(command: string): string | null {
  const result = spawnSync("where.exe", [command], {
    encoding: "utf8",
    windowsHide: true,
  });
  if ((result.status ?? 1) !== 0) return null;
  return (
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? null
  );
}

function codexJsFromCmd(path: string): string | null {
  const content = readFileSync(path, "utf8");
  const match = content.match(
    /"%\w+%\\node_modules\\@openai\\codex\\bin\\codex\.js"/,
  );
  if (!match) return null;
  return resolve(
    dirname(path),
    "node_modules",
    "@openai",
    "codex",
    "bin",
    "codex.js",
  );
}

function parseCodexOptions(value: unknown): CodexOptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const options: CodexOptions = {};
  if (typeof record.fake === "boolean") options.fake = record.fake;
  if (typeof record.command === "string") options.command = record.command;
  if (Array.isArray(record.args))
    options.args = record.args.filter(
      (arg): arg is string => typeof arg === "string",
    );
  const env = parseEnv(record.env);
  if (env) options.env = env;
  if ("approvalPolicy" in record)
    options.approvalPolicy = record.approvalPolicy;
  if (typeof record.threadSandbox === "string")
    options.threadSandbox = record.threadSandbox;
  if ("sandboxPolicy" in record) options.sandboxPolicy = record.sandboxPolicy;
  if (typeof record.responseTimeoutMs === "number")
    options.responseTimeoutMs = record.responseTimeoutMs;
  return options;
}

function parseEnv(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function extractNestedString(value: unknown, path: string[]): string | null {
  let current: unknown = value;
  for (const key of path) {
    const record = asRecord(current);
    if (!record) return null;
    current = record[key];
  }
  return typeof current === "string" ? current : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requireString(value: string | null, name: string): string {
  if (value) return value;
  throw new Error(`${name} is required`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
