import type {
  CreateTaskSpecMetadataRequest,
  ID,
  StartFollowUpSessionRequest,
  StartSessionRequest,
  WorkerSessionStatus,
} from "@codexhub/core";
import { canStartFollowUpSession } from "@codexhub/core";

export interface SessionDraft {
  workspaceId: ID | "";
  prompt: string;
  taskRef: string;
  taskTitle: string;
  taskIntent: string;
  taskScope: string;
  taskAcceptance: string;
}

export interface SessionDraftValidationOptions {
  requireWorkspace: boolean;
}

export function createEmptySessionDraft(
  workspaceId: ID | "" = "",
): SessionDraft {
  return {
    workspaceId,
    prompt: "",
    taskRef: "",
    taskTitle: "",
    taskIntent: "",
    taskScope: "",
    taskAcceptance: "",
  };
}

export function validateSessionDraft(
  draft: SessionDraft,
  options: SessionDraftValidationOptions,
): string[] {
  const reasons: string[] = [];
  if (options.requireWorkspace && !draft.workspaceId) {
    reasons.push("Choose a workspace.");
  }
  if (!draft.prompt.trim()) {
    reasons.push("Enter an initial prompt.");
  }
  return reasons;
}

export function buildStartSessionRequest(
  projectId: ID,
  draft: SessionDraft,
): StartSessionRequest {
  return withTaskSpec(
    {
      project_id: projectId,
      workspace_id: draft.workspaceId,
      initial_message: draft.prompt.trim(),
    },
    draft,
  );
}

export function buildFollowUpSessionRequest(
  draft: SessionDraft,
): StartFollowUpSessionRequest {
  return withTaskSpec(
    {
      workspace_id: draft.workspaceId || undefined,
      initial_message: draft.prompt.trim(),
    },
    draft,
  );
}

export function canStartFollowUpFromStatus(
  status: WorkerSessionStatus,
): boolean {
  return canStartFollowUpSession(status);
}

function withTaskSpec<
  T extends StartSessionRequest | StartFollowUpSessionRequest,
>(request: T, draft: SessionDraft): T {
  const taskSpec = taskSpecFromDraft(draft);
  if (!taskSpec) return request;
  return { ...request, task_spec: taskSpec };
}

function taskSpecFromDraft(
  draft: SessionDraft,
): CreateTaskSpecMetadataRequest | undefined {
  const taskSpec: CreateTaskSpecMetadataRequest = {};
  const ref = clean(draft.taskRef);
  const title = clean(draft.taskTitle);
  const intent = clean(draft.taskIntent);
  const scope = clean(draft.taskScope);
  const acceptance = clean(draft.taskAcceptance);

  if (ref) taskSpec.ref = ref;
  if (title) taskSpec.title = title;
  if (intent) taskSpec.intent = intent;
  if (scope) taskSpec.scope = scope;
  if (acceptance) taskSpec.acceptance_criteria = acceptance;

  return Object.keys(taskSpec).length > 0 ? taskSpec : undefined;
}

function clean(value: string): string | undefined {
  const text = value.trim();
  return text ? text : undefined;
}
