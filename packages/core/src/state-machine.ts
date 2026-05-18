import type { MessageMode, WorkerSessionStatus } from "./types.js";

export function canSendMessage(
  status: WorkerSessionStatus,
  mode: MessageMode,
): boolean {
  if (mode === "initial") return status === "starting";
  if (mode === "steer")
    return status === "running" || status === "awaiting_input";
  if (mode === "continue") return status === "awaiting_input";
  return false;
}

export function statusAfterTurnCompleted(): WorkerSessionStatus {
  return "awaiting_input";
}

export function statusAfterSendMessage(
  mode: MessageMode,
): WorkerSessionStatus | null {
  if (mode === "continue" || mode === "steer") return "running";
  return null;
}

export function isTerminalStatus(status: WorkerSessionStatus): boolean {
  return status === "completed" || status === "failed" || status === "stopped";
}

export function canStartFollowUpSession(status: WorkerSessionStatus): boolean {
  return isTerminalStatus(status);
}
