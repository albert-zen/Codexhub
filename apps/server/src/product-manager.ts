import type {
  Message,
  MessageMode,
  SenderType,
  TaskSpecMetadata,
  WorkerSession,
  Workspace,
} from "@codexhub/core";
import { canStartFollowUpSession, isTerminalStatus } from "@codexhub/core";
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
    if (isTerminalStatus(session.status)) {
      throw new ProductManagerError(
        "session_terminal",
        `session is ${session.status}`,
      );
    }

    if (command.mode === "steer" && command.content.trim() === "") {
      throw new ProductManagerError(
        "message_required",
        "steer content is required",
      );
    }
    if (command.mode === "continue" && command.content.trim() === "") {
      throw new ProductManagerError(
        "message_required",
        "continue content is required",
      );
    }

    const message = this.repo.createMessage({
      session_id: session.id,
      mode: command.mode,
      content: command.content,
      sender_type: command.senderType,
      sender_id: command.senderId ?? null,
    });

    let updatedSession: WorkerSession;
    try {
      updatedSession = await this.runtime.sendMessage(session, workspace, {
        message,
      });
    } catch (error) {
      if (error instanceof SessionProcessUnavailableError) {
        persistUnavailableSession(this.repo, error.sessionId, message.id, {
          failureReason: error.message,
        });
        throw new ProductManagerError(error.code, error.message, {
          session_id: error.sessionId,
          follow_up_available: true,
        });
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
