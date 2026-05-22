import type {
  Message,
  MessageMode,
  SenderType,
  TaskSpecMetadata,
  ThreadSummary,
  WorkerSession,
  Workspace,
} from "@codexhub/core";
import {
  canSendMessage,
  canStartFollowUpSession,
  isTerminalStatus,
  toThreadSummary,
} from "@codexhub/core";
import { type CreateTaskSpecInput, type HubRepository } from "./repository.js";
import {
  SessionProcessUnavailableError,
  type CodexRuntimeController,
} from "./runtime.js";

export interface ProductManagerDependencies {
  repo: HubRepository;
  runtime: CodexRuntimeController;
}

export interface StartWorkerCommand {
  workspaceId: string;
  projectId?: string | null;
  prompt?: string | null;
  taskSpec?: Record<string, unknown> | null;
  senderType: SenderType;
  senderId?: string | null;
  codexOptions?: unknown;
}

export interface StartFollowUpWorkerCommand {
  previousSessionReference: string;
  workspaceId?: string | null;
  prompt?: string | null;
  taskSpec?: Record<string, unknown> | null;
  senderType: SenderType;
  senderId?: string | null;
  codexOptions?: unknown;
}

export interface SendWorkerMessageCommand {
  sessionReference: string;
  mode: MessageMode;
  content: string;
  senderType: SenderType;
  senderId?: string | null;
  idempotencyKey?: string | null;
  keepThreadReadableOnRuntimeUnavailable?: boolean;
  ensureRuntimeReady?: boolean;
}

export interface CreateThreadCommand {
  projectId: string;
  workspaceId: string;
  idempotencyKey?: string | null;
}

export interface StartWorkerResult {
  session: WorkerSession;
  workspace: Workspace;
}

export interface StartFollowUpWorkerResult {
  session: WorkerSession;
  previous_session_id: string;
  previous_session: WorkerSession;
  workspace: Workspace;
  task_spec: TaskSpecMetadata | null;
}

export interface SendWorkerMessageResult {
  message: Message;
  session: WorkerSession;
  thread?: ThreadSummary;
}

export interface CreateThreadResult {
  thread: ThreadSummary;
  session: WorkerSession;
  workspace: Workspace;
}

export class ProductManagerError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export class ProductManager {
  private readonly repo: HubRepository;
  private readonly runtime: CodexRuntimeController;
  private readonly inFlightSends = new Set<string>();

  constructor(dependencies: ProductManagerDependencies) {
    this.repo = dependencies.repo;
    this.runtime = dependencies.runtime;
  }

  async startWorker(command: StartWorkerCommand): Promise<StartWorkerResult> {
    const workspace = this.repo.getWorkspace(command.workspaceId);
    if (!workspace) {
      throw new ProductManagerError(
        "workspace_not_found",
        "workspace not found",
      );
    }

    const project = this.repo.getProject(
      command.projectId ?? workspace.project_id,
    );
    if (!project) {
      throw new ProductManagerError("project_not_found", "project not found");
    }

    const prompt = requirePrompt(command.prompt);
    const session = this.repo.createSession({
      project_id: project.id,
      workspace_id: workspace.id,
    });
    const taskSpec = parseTaskSpec(command.taskSpec ?? null);
    if (taskSpec) {
      this.repo.createTaskSpec({ session_id: session.id, ...taskSpec });
    }
    const message = this.repo.createMessage({
      session_id: session.id,
      mode: "initial",
      content: prompt,
      sender_type: command.senderType,
      sender_id: command.senderId ?? null,
    });

    const started = await this.runtime.startSession(session, workspace, {
      initialMessage: message,
      codexOptions: command.codexOptions ?? project.default_codex_options,
    });
    return { session: started, workspace };
  }

  async createThread(
    command: CreateThreadCommand,
  ): Promise<CreateThreadResult> {
    const project = this.repo.getProject(command.projectId);
    if (!project) {
      throw new ProductManagerError("project_not_found", "project not found");
    }

    const workspace = this.repo.getWorkspace(command.workspaceId);
    if (!workspace) {
      throw new ProductManagerError(
        "workspace_not_found",
        "workspace not found",
      );
    }
    if (workspace.project_id !== project.id) {
      throw new ProductManagerError(
        "workspace_project_mismatch",
        "thread workspace must belong to the project",
      );
    }

    const session = this.repo.createSession({
      project_id: project.id,
      workspace_id: workspace.id,
      idempotency_key: command.idempotencyKey ?? null,
    });
    return { thread: toThreadSummary(session), session, workspace };
  }

  async startFollowUpWorker(
    command: StartFollowUpWorkerCommand,
  ): Promise<StartFollowUpWorkerResult> {
    const previousSession = this.requireSession(
      command.previousSessionReference,
    );
    if (!canStartFollowUpSession(previousSession.status)) {
      throw new ProductManagerError(
        "session_not_terminal",
        `session is ${previousSession.status}; follow-up sessions require a stopped, completed, or failed source session`,
      );
    }

    const workspaceId = command.workspaceId ?? previousSession.workspace_id;
    const workspace = this.repo.getWorkspace(workspaceId);
    if (!workspace) {
      throw new ProductManagerError(
        "workspace_not_found",
        "workspace not found",
      );
    }
    if (workspace.project_id !== previousSession.project_id) {
      throw new ProductManagerError(
        "workspace_project_mismatch",
        "follow-up workspace must belong to the previous session project",
      );
    }

    const project = this.repo.getProject(previousSession.project_id);
    if (!project) {
      throw new ProductManagerError("project_not_found", "project not found");
    }

    const prompt = requirePrompt(command.prompt);
    const session = this.repo.createSession({
      project_id: previousSession.project_id,
      workspace_id: workspace.id,
      previous_session_id: previousSession.id,
    });
    const taskSpec = mergeTaskSpec(
      this.repo.getTaskSpec(previousSession.id),
      command.taskSpec ?? null,
    );
    if (taskSpec) {
      this.repo.createTaskSpec({ session_id: session.id, ...taskSpec });
    }
    const message = this.repo.createMessage({
      session_id: session.id,
      mode: "initial",
      content: prompt,
      sender_type: command.senderType,
      sender_id: command.senderId ?? null,
    });

    const started = await this.runtime.startSession(session, workspace, {
      initialMessage: message,
      codexOptions: command.codexOptions ?? project.default_codex_options,
    });
    return {
      session: started,
      previous_session_id: previousSession.id,
      previous_session: previousSession,
      workspace,
      task_spec: this.repo.getTaskSpec(session.id),
    };
  }

  async sendWorkerMessage(
    command: SendWorkerMessageCommand,
  ): Promise<SendWorkerMessageResult> {
    const session = this.requireSession(command.sessionReference);
    const workspace = this.repo.getWorkspace(session.workspace_id);
    if (!workspace) {
      throw new ProductManagerError(
        "workspace_not_found",
        "workspace not found",
      );
    }
    const canResumeTerminalThread =
      command.ensureRuntimeReady === true &&
      command.mode === "continue" &&
      session.codex_thread_id !== null;
    if (isTerminalStatus(session.status) && !canResumeTerminalThread) {
      throw new ProductManagerError(
        "session_terminal",
        `session is ${session.status}`,
      );
    }

    if (command.content.trim() === "") {
      throw new ProductManagerError(
        "message_required",
        "thread message content is required",
      );
    }

    if (command.idempotencyKey) {
      const existing = this.repo.getMessageByIdempotencyKey(
        session.id,
        command.idempotencyKey,
      );
      if (existing) {
        if (
          existing.status === "failed" &&
          command.keepThreadReadableOnRuntimeUnavailable
        ) {
          this.repo.deleteMessageIdempotencyKey(
            session.id,
            command.idempotencyKey,
          );
        } else {
          return {
            message: existing,
            session,
            thread: toThreadSummary(session),
          };
        }
      }
    }

    if (isThreadTurnInProgress(command, session)) {
      throw new ProductManagerError(
        "thread_turn_in_progress",
        "thread already has a turn in progress",
        { session_id: session.id },
      );
    }

    if (isUnsupportedThreadSend(command, session)) {
      throw new ProductManagerError(
        "thread_not_ready",
        `thread is ${session.status}`,
        { session_id: session.id },
      );
    }

    if (command.idempotencyKey) {
      const existing = this.repo.getMessageByIdempotencyKey(
        session.id,
        command.idempotencyKey,
      );
      if (existing) {
        return {
          message: existing,
          session,
          thread: toThreadSummary(session),
        };
      }
    }

    if (this.inFlightSends.has(session.id)) {
      throw new ProductManagerError(
        "thread_turn_in_progress",
        "thread already has a turn in progress",
        { session_id: session.id },
      );
    }

    this.inFlightSends.add(session.id);
    try {
      return await this.sendWorkerMessageAfterGuard(
        command,
        session,
        workspace,
      );
    } finally {
      this.inFlightSends.delete(session.id);
    }
  }

  private async sendWorkerMessageAfterGuard(
    command: SendWorkerMessageCommand,
    session: WorkerSession,
    workspace: Workspace,
  ): Promise<SendWorkerMessageResult> {
    if (isEmptyThreadSession(session)) {
      const project = this.repo.getProject(session.project_id);
      if (!project) {
        throw new ProductManagerError("project_not_found", "project not found");
      }
      const message = this.repo.createMessage({
        session_id: session.id,
        mode: "initial",
        content: command.content,
        sender_type: command.senderType,
        sender_id: command.senderId ?? null,
        idempotency_key: command.idempotencyKey ?? null,
      });
      let started: WorkerSession;
      try {
        started = await this.runtime.startSession(session, workspace, {
          initialMessage: message,
          codexOptions: project.default_codex_options,
        });
      } catch (error) {
        if (command.keepThreadReadableOnRuntimeUnavailable) {
          const failure =
            error instanceof Error ? error : new Error(String(error));
          persistUnavailableSend(this.repo, session, message.id, {
            failureReason: failure.message,
          });
          throw new ProductManagerError(
            "session_process_unavailable",
            failure.message,
            {
              session_id: session.id,
              follow_up_available: false,
              retryable: true,
            },
          );
        }
        throw error;
      }
      return {
        message:
          this.repo
            .listMessages(session.id)
            .find((entry) => entry.id === message.id) ?? message,
        session: started,
        thread: toThreadSummary(started),
      };
    }

    const message = this.repo.createMessage({
      session_id: session.id,
      mode: command.mode,
      content: command.content,
      sender_type: command.senderType,
      sender_id: command.senderId ?? null,
      idempotency_key: command.idempotencyKey ?? null,
    });

    let updatedSession: WorkerSession;
    let runtimeSession = session;
    let attemptedResumeBeforeSend = false;
    try {
      if (command.ensureRuntimeReady) {
        if (await this.runtime.hasLiveSession(session)) {
          runtimeSession = session;
        } else if (session.codex_thread_id) {
          attemptedResumeBeforeSend = true;
          runtimeSession = await this.resumeRuntimeSession(session, workspace);
        }
      }
      updatedSession = await this.runtime.sendMessage(
        runtimeSession,
        workspace,
        {
          message,
        },
      );
    } catch (error) {
      if (error instanceof SessionProcessUnavailableError) {
        if (!command.ensureRuntimeReady) {
          persistUnavailableSession(this.repo, error.sessionId, message.id, {
            failureReason: error.message,
          });
          throw new ProductManagerError(error.code, error.message, {
            session_id: error.sessionId,
            follow_up_available: true,
          });
        }
        if (attemptedResumeBeforeSend) {
          if (command.keepThreadReadableOnRuntimeUnavailable) {
            persistUnavailableSend(this.repo, session, message.id, {
              failureReason: error.message,
            });
          } else {
            persistUnavailableSession(this.repo, error.sessionId, message.id, {
              failureReason: error.message,
            });
          }
          throw new ProductManagerError(error.code, error.message, {
            session_id: error.sessionId,
            follow_up_available:
              command.keepThreadReadableOnRuntimeUnavailable !== true,
            retryable: command.keepThreadReadableOnRuntimeUnavailable === true,
          });
        }
        try {
          runtimeSession = await this.resumeRuntimeSession(session, workspace);
          updatedSession = await this.runtime.sendMessage(
            runtimeSession,
            workspace,
            { message },
          );
        } catch (resumeError) {
          const failure = resumeError instanceof Error ? resumeError : error;
          if (command.keepThreadReadableOnRuntimeUnavailable) {
            persistUnavailableSend(this.repo, session, message.id, {
              failureReason: failure.message,
            });
          } else {
            persistUnavailableSession(this.repo, error.sessionId, message.id, {
              failureReason: failure.message,
            });
          }
          throw new ProductManagerError(error.code, failure.message, {
            session_id: error.sessionId,
            follow_up_available:
              command.keepThreadReadableOnRuntimeUnavailable !== true,
            retryable: command.keepThreadReadableOnRuntimeUnavailable === true,
          });
        }
      }
      if (
        command.ensureRuntimeReady &&
        command.keepThreadReadableOnRuntimeUnavailable
      ) {
        const failure =
          error instanceof Error ? error : new Error(String(error));
        persistUnavailableSend(this.repo, session, message.id, {
          failureReason: failure.message,
        });
        throw new ProductManagerError(
          "session_process_unavailable",
          failure.message,
          {
            session_id: session.id,
            follow_up_available: false,
            retryable: true,
          },
        );
      }
      throw error;
    }

    return {
      message:
        this.repo
          .listMessages(session.id)
          .find((entry) => entry.id === message.id) ?? message,
      session: updatedSession,
    };
  }

  private async resumeRuntimeSession(
    session: WorkerSession,
    workspace: Workspace,
  ): Promise<WorkerSession> {
    const project = this.repo.getProject(session.project_id);
    if (!project) {
      throw new ProductManagerError("project_not_found", "project not found");
    }
    return this.runtime.resumeSession(session, workspace, {
      codexOptions: project.default_codex_options,
    });
  }

  async stopWorker(sessionReference: string): Promise<WorkerSession> {
    const session = this.requireSession(sessionReference);
    await this.runtime.stopSession(session.id);
    return this.requireSession(session.id);
  }

  async completeWorker(sessionReference: string): Promise<WorkerSession> {
    const session = this.requireSession(sessionReference);
    return this.runtime.completeSession(session.id);
  }

  private requireSession(reference: string): WorkerSession {
    const result = this.repo.resolveSession(reference);
    if (result.status === "found") return result.session;
    if (result.status === "ambiguous") {
      throw new ProductManagerError(
        "session_id_ambiguous",
        `session id prefix "${result.reference}" is ambiguous; pass a longer prefix or canonical session id`,
        {
          candidate_ids: result.matches.map((session) => session.id),
        },
      );
    }
    throw new ProductManagerError("session_not_found", "session not found");
  }
}

function isEmptyThreadSession(session: WorkerSession): boolean {
  return (
    session.status === "starting" &&
    session.started_at === null &&
    session.last_item_sequence === 0 &&
    session.last_agent_message === null
  );
}

function isThreadTurnInProgress(
  command: SendWorkerMessageCommand,
  session: WorkerSession,
): boolean {
  return (
    command.ensureRuntimeReady === true &&
    command.mode === "continue" &&
    (session.status === "starting" || session.status === "running") &&
    !isEmptyThreadSession(session)
  );
}

function isUnsupportedThreadSend(
  command: SendWorkerMessageCommand,
  session: WorkerSession,
): boolean {
  if (command.ensureRuntimeReady !== true) return false;
  if (isEmptyThreadSession(session)) return false;
  if (canSendMessage(session.status, command.mode)) return false;
  return !(command.mode === "continue" && session.codex_thread_id !== null);
}

function requirePrompt(prompt: string | null | undefined): string {
  if (prompt && prompt.trim() !== "") return prompt;
  throw new ProductManagerError(
    "prompt_required",
    "initial_message or prompt is required",
  );
}

function persistUnavailableSession(
  repo: HubRepository,
  sessionId: string,
  messageId: string,
  options: { failureReason: string },
): void {
  repo.markMessageFailed(messageId, options.failureReason);
  repo.updateSession(sessionId, {
    status: "failed",
    failure_reason: options.failureReason,
    process_pid: null,
    ended_at: new Date().toISOString(),
  });
}

function persistUnavailableSend(
  repo: HubRepository,
  session: WorkerSession,
  messageId: string,
  options: { failureReason: string },
): void {
  repo.markMessageFailed(messageId, options.failureReason);
  repo.updateSession(session.id, {
    status: session.status,
    codex_thread_id: session.codex_thread_id,
    codex_turn_id: session.codex_turn_id,
    codex_session_key: session.codex_session_key,
    failure_reason: null,
    process_pid: null,
    started_at: session.started_at,
    ended_at: session.ended_at,
  });
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
      throw new ProductManagerError(
        "invalid_task_spec",
        `${field} must be string`,
      );
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
  throw new ProductManagerError("invalid_task_spec", `${key} must be string`);
}
