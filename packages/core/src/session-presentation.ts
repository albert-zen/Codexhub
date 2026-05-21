import { canSendMessage, isTerminalStatus } from "./state-machine.js";
import type { MessageMode, WorkerSessionStatus } from "./types.js";

export type SendSessionAction = Exclude<MessageMode, "initial">;
export type SessionAction = SendSessionAction | "stop" | "complete";

export interface SessionActionAvailability {
  action: SessionAction;
  label: string;
  disabled: boolean;
  reasons: string[];
}

export type SessionActionAvailabilityMap = Record<
  SessionAction,
  SessionActionAvailability
>;

export interface SessionActionAvailabilityInput {
  status: WorkerSessionStatus;
  message: string;
  submitting: SessionAction | null;
}

export const SESSION_ACTIONS: SessionAction[] = [
  "steer",
  "continue",
  "stop",
  "complete",
];

const ACTION_LABELS: Record<SessionAction, string> = {
  steer: "Send Steer",
  continue: "Continue",
  stop: "Stop",
  complete: "Complete",
};

export function getSessionActionAvailability({
  status,
  message,
  submitting,
}: SessionActionAvailabilityInput): SessionActionAvailabilityMap {
  return {
    steer: actionAvailability("steer", status, message, submitting),
    continue: actionAvailability("continue", status, message, submitting),
    stop: actionAvailability("stop", status, message, submitting),
    complete: actionAvailability("complete", status, message, submitting),
  };
}

function actionAvailability(
  action: SessionAction,
  status: WorkerSessionStatus,
  message: string,
  submitting: SessionAction | null,
): SessionActionAvailability {
  const reasons = actionReasons(action, status, message, submitting);

  return {
    action,
    label: ACTION_LABELS[action],
    disabled: reasons.length > 0,
    reasons,
  };
}

function actionReasons(
  action: SessionAction,
  status: WorkerSessionStatus,
  message: string,
  submitting: SessionAction | null,
): string[] {
  const reasons: string[] = [];

  if ((action === "steer" || action === "continue") && !message.trim()) {
    reasons.push(
      `A non-empty message is required for ${ACTION_LABELS[action]}.`,
    );
  }

  const statusReason =
    action === "steer" || action === "continue"
      ? sendStatusReason(status, action)
      : finishStatusReason(status, action);
  if (statusReason) reasons.push(statusReason);

  if (submitting) {
    reasons.push(`Waiting for ${ACTION_LABELS[submitting]} to finish.`);
  }

  return reasons;
}

function sendStatusReason(
  status: WorkerSessionStatus,
  action: SendSessionAction,
): string | null {
  if (canSendMessage(status, action)) return null;
  if (isTerminalStatus(status)) {
    return `This session is ${statusLabel(status)}. Start a follow-up session to send more instructions.`;
  }
  if (action === "steer") {
    return `Send Steer is available when this session is running or awaiting input; it is ${statusLabel(status)}.`;
  }
  return `Continue is available when this session is awaiting input; it is ${statusLabel(status)}.`;
}

function finishStatusReason(
  status: WorkerSessionStatus,
  action: "stop" | "complete",
): string | null {
  if (canFinish(status)) return null;
  return `This session is ${statusLabel(status)}, so ${ACTION_LABELS[action]} is unavailable.`;
}

function canFinish(status: WorkerSessionStatus): boolean {
  return (
    status === "starting" || status === "running" || status === "awaiting_input"
  );
}

function statusLabel(status: WorkerSessionStatus): string {
  return status.replace("_", " ");
}
