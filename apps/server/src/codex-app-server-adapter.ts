import { statusAfterTurnCompleted } from "@codexhub/core";

export interface CodexAppServerRequest {
  method: string;
  id: number;
  params: unknown;
}

export interface CodexAppServerNotification {
  method: string;
  params: unknown;
}

export type CodexAppServerPayload =
  | CodexAppServerRequest
  | CodexAppServerNotification;

export type CodexAppServerStream = "stdout" | "stderr";

export type CodexAppServerLine =
  | { type: "empty" }
  | { type: "diagnostic"; item: { stream: CodexAppServerStream; line: string } }
  | { type: "payload"; payload: unknown };

export interface CodexResponse {
  id: number;
  result?: unknown;
  error?: unknown;
}

export type CodexNativeEvent =
  | { type: "none" }
  | {
      type: "turn_completed";
      status: ReturnType<typeof statusAfterTurnCompleted>;
    }
  | { type: "turn_failed"; status: "failed"; failureReason: string }
  | { type: "input_required"; status: "awaiting_input" };

export function codexInitializeRequest(id: number): CodexAppServerRequest {
  return {
    method: "initialize",
    id,
    params: {
      capabilities: { experimentalApi: true },
      clientInfo: {
        name: "codexhub",
        title: "Codexhub",
        version: "0.1.0",
      },
    },
  };
}

export function codexInitializedNotification(): CodexAppServerNotification {
  return { method: "initialized", params: {} };
}

export function codexThreadStartRequest(
  id: number,
  options: {
    approvalPolicy: unknown;
    sandbox: string;
    cwd: string;
  },
): CodexAppServerRequest {
  return {
    method: "thread/start",
    id,
    params: {
      approvalPolicy: options.approvalPolicy,
      sandbox: options.sandbox,
      cwd: options.cwd,
      dynamicTools: [],
    },
  };
}

export function codexTurnStartRequest(
  id: number,
  options: {
    threadId: string;
    inputText: string;
    cwd: string;
    approvalPolicy: unknown;
    sandboxPolicy: unknown;
  },
): CodexAppServerRequest {
  return {
    method: "turn/start",
    id,
    params: {
      threadId: options.threadId,
      input: [{ type: "text", text: options.inputText }],
      cwd: options.cwd,
      title: "Codexhub Worker",
      approvalPolicy: options.approvalPolicy,
      sandboxPolicy: options.sandboxPolicy,
    },
  };
}

export function codexTurnSteerRequest(
  id: number,
  options: {
    threadId: string | null;
    expectedTurnId: string | null;
    inputText: string;
  },
): CodexAppServerRequest {
  return {
    method: "turn/steer",
    id,
    params: {
      threadId: options.threadId,
      expectedTurnId: options.expectedTurnId,
      input: [{ type: "text", text: options.inputText }],
    },
  };
}

export function codexAppServerPayloadLine(
  payload: CodexAppServerPayload,
): string {
  return `${JSON.stringify(payload)}\n`;
}

export function normalizeCodexAppServerLine(
  stream: CodexAppServerStream,
  line: string,
): CodexAppServerLine {
  const trimmed = line.trim();
  if (!trimmed) return { type: "empty" };

  try {
    return { type: "payload", payload: JSON.parse(trimmed) as unknown };
  } catch {
    return { type: "diagnostic", item: { stream, line: trimmed } };
  }
}

export function extractCodexResponse(value: unknown): CodexResponse | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== "number") return null;

  const response: CodexResponse = { id: record.id };
  if ("result" in record) response.result = record.result;
  if ("error" in record) response.error = record.error;
  return response;
}

export function extractThreadId(value: unknown): string | null {
  return extractNestedString(value, ["thread", "id"]);
}

export function extractTurnId(value: unknown): string | null {
  return extractNestedString(value, ["turn", "id"]);
}

export function normalizeCodexNativeEvent(value: unknown): CodexNativeEvent {
  const record = asRecord(value);
  if (!record) return { type: "none" };
  const method = typeof record.method === "string" ? record.method : null;

  if (method === "turn/completed") {
    return {
      type: "turn_completed",
      status: statusAfterTurnCompleted(),
    };
  }

  if (method === "turn/failed" || method === "turn/cancelled") {
    return {
      type: "turn_failed",
      status: "failed",
      failureReason: JSON.stringify(record.params ?? record),
    };
  }

  if (method === "turn/input_required" || method === "turn/needs_input") {
    return { type: "input_required", status: "awaiting_input" };
  }

  return { type: "none" };
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
