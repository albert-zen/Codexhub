import { statusAfterTurnCompleted } from "@codexhub/core";
import { describe, expect, it } from "vitest";
import {
  codexAppServerPayloadLine,
  codexInitializedNotification,
  codexInitializeRequest,
  codexThreadStartRequest,
  codexTurnStartRequest,
  codexTurnSteerRequest,
  extractCodexResponse,
  extractThreadId,
  extractTurnId,
  normalizeCodexAppServerLine,
  normalizeCodexNativeEvent,
} from "../src/codex-app-server-adapter.js";

describe("Codex app-server protocol adapter", () => {
  it("builds JSON-RPC request and notification payloads", () => {
    expect(codexInitializeRequest(1)).toEqual({
      method: "initialize",
      id: 1,
      params: {
        capabilities: { experimentalApi: true },
        clientInfo: {
          name: "codexhub",
          title: "Codexhub",
          version: "0.1.0",
        },
      },
    });
    expect(codexInitializedNotification()).toEqual({
      method: "initialized",
      params: {},
    });
    expect(
      codexThreadStartRequest(2, {
        approvalPolicy: "never",
        sandbox: "workspace-write",
        cwd: "D:\\work",
      }),
    ).toEqual({
      method: "thread/start",
      id: 2,
      params: {
        approvalPolicy: "never",
        sandbox: "workspace-write",
        cwd: "D:\\work",
        dynamicTools: [],
      },
    });
    expect(
      codexTurnStartRequest(3, {
        threadId: "thread-1",
        inputText: "Continue.",
        cwd: "D:\\work",
        approvalPolicy: "never",
        sandboxPolicy: { type: "workspaceWrite" },
      }),
    ).toEqual({
      method: "turn/start",
      id: 3,
      params: {
        threadId: "thread-1",
        input: [{ type: "text", text: "Continue." }],
        cwd: "D:\\work",
        title: "Codexhub Worker",
        approvalPolicy: "never",
        sandboxPolicy: { type: "workspaceWrite" },
      },
    });
    expect(
      codexTurnSteerRequest(4, {
        threadId: "thread-1",
        expectedTurnId: "turn-1",
        inputText: "Steer.",
      }),
    ).toEqual({
      method: "turn/steer",
      id: 4,
      params: {
        threadId: "thread-1",
        expectedTurnId: "turn-1",
        input: [{ type: "text", text: "Steer." }],
      },
    });
  });

  it("serializes payloads as newline-delimited JSON", () => {
    expect(
      codexAppServerPayloadLine({ method: "initialized", params: {} }),
    ).toBe('{"method":"initialized","params":{}}\n');
  });

  it("extracts JSON-RPC responses and nested Codex ids", () => {
    expect(
      extractCodexResponse({
        id: 7,
        result: { thread: { id: "thread-1" }, turn: { id: "turn-1" } },
      }),
    ).toEqual({
      id: 7,
      result: { thread: { id: "thread-1" }, turn: { id: "turn-1" } },
    });
    expect(
      extractCodexResponse({ id: 8, error: { message: "failed" } }),
    ).toEqual({ id: 8, error: { message: "failed" } });
    expect(extractCodexResponse({ id: "not-number", result: {} })).toBeNull();
    expect(extractThreadId({ thread: { id: "thread-1" } })).toBe("thread-1");
    expect(extractTurnId({ turn: { id: "turn-1" } })).toBe("turn-1");
  });

  it("normalizes stdout and stderr lines into JSON payloads or diagnostics", () => {
    expect(normalizeCodexAppServerLine("stdout", "   ")).toEqual({
      type: "empty",
    });
    expect(
      normalizeCodexAppServerLine("stderr", "warning: using fallback"),
    ).toEqual({
      type: "diagnostic",
      item: { stream: "stderr", line: "warning: using fallback" },
    });
    expect(
      normalizeCodexAppServerLine("stdout", '{"method":"turn/completed"}'),
    ).toEqual({
      type: "payload",
      payload: { method: "turn/completed" },
    });
  });

  it("normalizes native turn events into session-state effects", () => {
    expect(normalizeCodexNativeEvent({ method: "turn/completed" })).toEqual({
      type: "turn_completed",
      status: statusAfterTurnCompleted(),
    });
    expect(
      normalizeCodexNativeEvent({
        method: "turn/failed",
        params: { error: { message: "model failed" } },
      }),
    ).toEqual({
      type: "turn_failed",
      status: "failed",
      failureReason: '{"error":{"message":"model failed"}}',
    });
    expect(normalizeCodexNativeEvent({ method: "turn/cancelled" })).toEqual({
      type: "turn_failed",
      status: "failed",
      failureReason: '{"method":"turn/cancelled"}',
    });
    expect(
      normalizeCodexNativeEvent({ method: "turn/input_required" }),
    ).toEqual({ type: "input_required", status: "awaiting_input" });
    expect(normalizeCodexNativeEvent({ method: "turn/needs_input" })).toEqual({
      type: "input_required",
      status: "awaiting_input",
    });
    expect(normalizeCodexNativeEvent({ method: "item/completed" })).toEqual({
      type: "none",
    });
  });
});
