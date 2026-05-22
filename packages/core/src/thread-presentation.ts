import type {
  ConversationState,
  RuntimeState,
  ThreadState,
  ThreadSummary,
  WorkerSession,
} from "./types.js";

export function toThreadSummary(session: WorkerSession): ThreadSummary {
  return {
    id: session.id,
    session_id: session.id,
    project_id: session.project_id,
    workspace_id: session.workspace_id,
    codex_thread_id: session.codex_thread_id,
    thread_state: threadState(session),
    conversation_state: conversationState(session),
    runtime_state: runtimeState(session),
    last_agent_message: session.last_agent_message,
    last_agent_message_at: session.last_agent_message_at,
    last_item_sequence: session.last_item_sequence,
    created_at: session.created_at,
    updated_at: session.updated_at,
  };
}

function threadState(session: WorkerSession): ThreadState {
  if (
    session.status === "starting" &&
    session.started_at === null &&
    session.codex_thread_id === null &&
    session.last_item_sequence === 0 &&
    !session.last_agent_message
  ) {
    return "empty";
  }
  return "active";
}

function conversationState(session: WorkerSession): ConversationState {
  if (session.status === "running") return "streamingAssistant";
  if (session.status === "failed") return "failedToSend";
  return "ready";
}

function runtimeState(session: WorkerSession): RuntimeState {
  if (threadState(session) === "empty") return "notStarted";
  switch (session.status) {
    case "starting":
      return "starting";
    case "running":
      return "busy";
    case "awaiting_input":
      return "ready";
    case "failed":
      return "failed";
    case "stopped":
    case "completed":
      return "exited";
  }
}
