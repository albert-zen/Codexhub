import type {
  SessionAction,
  TranscriptEntry,
  WorkerSession,
} from "@codexhub/core";

export function isEmptyThreadSession(session: WorkerSession | null): boolean {
  return (
    session !== null &&
    session.status === "starting" &&
    session.started_at === null &&
    session.last_item_sequence === 0 &&
    session.last_agent_message === null
  );
}

export function isResumableThreadSession(
  session: WorkerSession | null,
): boolean {
  return (
    session !== null &&
    session.codex_thread_id !== null &&
    (session.status === "completed" ||
      session.status === "failed" ||
      session.status === "stopped")
  );
}

export function canSendThreadMessage(input: {
  session: WorkerSession | null;
  message: string;
  submitting: SessionAction | null;
  continueDisabled: boolean;
}): boolean {
  return (
    input.session !== null &&
    input.message.trim() !== "" &&
    input.submitting === null &&
    (isEmptyThreadSession(input.session) ||
      isResumableThreadSession(input.session) ||
      !input.continueDisabled)
  );
}

export function conversationPageLabel(entries: TranscriptEntry[]): string {
  if (entries.length === 0) return "No visible messages";
  return `${entries.length} visible ${
    entries.length === 1 ? "message" : "messages"
  }`;
}
