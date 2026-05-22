import { describe, expect, it } from "vitest";

import { projectThreadContext } from "./thread-context.js";
import type { Item, Message, ThreadSummary } from "./types.js";

describe("thread context projection", () => {
  it("builds a compact manager-agent context window with collapsed tool calls", () => {
    const thread = threadSummary();
    const messages = [message({ id: "msg_1", content: "Run tests." })];
    const items = [
      item({
        id: "item_1",
        sequence: 1,
        type: "agentmessage",
        codex_item_id: "agent_1",
        codex_method: "item/completed",
        text_excerpt: "I will run tests.",
      }),
      item({
        id: "item_2",
        sequence: 2,
        type: "toolcall",
        codex_item_id: "tool_1",
        codex_method: "item/tool/call",
        text_excerpt: "pnpm test",
      }),
      item({
        id: "item_3",
        sequence: 3,
        type: "toolresult",
        codex_item_id: "tool_1",
        codex_method: "item/tool/result",
        text_excerpt: "passed",
      }),
    ];

    const context = projectThreadContext(thread, messages, items, {
      limit: 10,
      tools: "collapsed",
    });

    expect(context.thread).toBe(thread);
    expect(context.latest_agent_message).toBe("I will run tests.");
    expect(context.allowed_actions).toContain("send");
    expect(context.attention_reasons).toEqual([]);
    expect(context.transcript.map((entry) => entry.kind)).toEqual([
      "message",
      "agent_message",
      "tool",
      "tool",
    ]);
    expect(context.tool_calls).toEqual([
      {
        id: "tool_1",
        session_id: "sess_1",
        status: "completed",
        text: "pnpm test",
        result_text: "passed",
        item_ids: ["item_2", "item_3"],
        item_sequences: [2, 3],
      },
    ]);
  });

  it("can expand tool calls to their source items and omits stop before runtime starts", () => {
    const thread = threadSummary({
      thread_state: "empty",
      runtime_state: "notStarted",
      last_item_sequence: 0,
    });
    const items = [
      item({
        id: "item_2",
        sequence: 2,
        type: "toolcall",
        codex_item_id: "tool_1",
        codex_method: "item/tool/call",
        text_excerpt: "pnpm test",
      }),
      item({
        id: "item_3",
        sequence: 3,
        type: "toolresult",
        codex_item_id: "tool_1",
        codex_method: "item/tool/result",
        text_excerpt: "passed",
      }),
    ];

    const context = projectThreadContext(thread, [], items, {
      limit: 10,
      tools: "expanded",
    });

    expect(context.allowed_actions).toEqual(["send"]);
    expect(context.tool_calls[0]?.items?.map((entry) => entry.id)).toEqual([
      "item_2",
      "item_3",
    ]);
  });

  it("surfaces failed sends as context attention", () => {
    const thread = threadSummary();
    const context = projectThreadContext(
      thread,
      [
        message({
          id: "msg_failed",
          status: "failed",
          content: "Continue.",
          error: "runtime unavailable",
          sent_at: null,
        }),
      ],
      [],
      { limit: 10 },
    );

    expect(context.thread).toMatchObject({
      id: thread.id,
      conversation_state: "failedToSend",
    });
    expect(context.attention_reasons).toContain("failed_to_send");
    expect(context.transcript[0]).toMatchObject({
      source_id: "msg_failed",
      message_status: "failed",
      text: "Continue.",
    });
  });
});

function threadSummary(input: Partial<ThreadSummary> = {}): ThreadSummary {
  return {
    id: "sess_1",
    session_id: "sess_1",
    project_id: "proj_1",
    workspace_id: "work_1",
    codex_thread_id: null,
    thread_state: "active",
    conversation_state: "ready",
    runtime_state: "ready",
    last_agent_message: "I will run tests.",
    last_agent_message_at: "2026-01-01T00:00:01.000Z",
    last_item_sequence: 3,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:03.000Z",
    ...input,
  };
}

function message(input: Partial<Message> = {}): Message {
  return {
    id: "msg_1",
    session_id: "sess_1",
    mode: "initial",
    content: "Hello.",
    sender_type: "manager_agent",
    sender_id: null,
    status: "sent",
    codex_request_id: null,
    error: null,
    created_at: "2026-01-01T00:00:00.000Z",
    sent_at: "2026-01-01T00:00:00.000Z",
    ...input,
  };
}

function item(input: Partial<Item>): Item {
  return {
    id: "item_1",
    session_id: "sess_1",
    sequence: 1,
    type: "agentmessage",
    codex_method: "item/completed",
    codex_item_id: "agent_1",
    codex_item_type: "agentMessage",
    created_at: `2026-01-01T00:00:${String(input.sequence ?? 1).padStart(
      2,
      "0",
    )}.000Z`,
    raw_payload: {},
    text_excerpt: "done",
    ...input,
  };
}
