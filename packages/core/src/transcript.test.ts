import { describe, expect, it } from "vitest";
import type { Item, Message } from "./types.js";
import { projectTranscriptEntries } from "./transcript.js";

describe("transcript projection", () => {
  it("aggregates agent message deltas into one transcript entry", () => {
    const items = Array.from({ length: 25 }, (_, index) =>
      item({
        id: `item_${index + 1}`,
        sequence: index + 1,
        codex_item_id: "agent_1",
        codex_method: "item/agentMessage/delta",
        text_excerpt: `${index + 1} `,
      }),
    );

    const page = projectTranscriptEntries("sess_1", [], items, { limit: 20 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: "agent:agent_1",
      kind: "agent_message",
      text: items.map((entry) => entry.text_excerpt).join(""),
      item_sequences: Array.from({ length: 25 }, (_, index) => index + 1),
    });
    expect(page.next_cursor).toBeNull();
  });

  it("prefers completed agent message text over accumulated deltas", () => {
    const page = projectTranscriptEntries(
      "sess_1",
      [],
      [
        item({
          id: "item_1",
          sequence: 1,
          codex_item_id: "agent_1",
          codex_method: "item/agentMessage/delta",
          text_excerpt: "partial ",
        }),
        item({
          id: "item_2",
          sequence: 2,
          codex_item_id: "agent_1",
          codex_method: "item/completed",
          text_excerpt: "Complete answer.",
        }),
      ],
    );

    expect(page.items[0]?.text).toBe("Complete answer.");
    expect(page.items[0]?.source_id).toBe("item_2");
  });

  it("paginates by transcript entries rather than raw item count", () => {
    const messages = [message({ id: "msg_1", content: "Start." })];
    const items = [
      ...Array.from({ length: 25 }, (_, index) =>
        item({
          id: `item_${index + 1}`,
          sequence: index + 1,
          codex_item_id: "agent_1",
          codex_method: "item/agentMessage/delta",
          text_excerpt: `${index + 1} `,
        }),
      ),
      item({
        id: "item_26",
        sequence: 26,
        type: "toolcall",
        codex_method: "item/tool/call",
        text_excerpt: "tool",
      }),
    ];
    const page = projectTranscriptEntries("sess_1", messages, items, {
      limit: 2,
    });

    expect(page.items.map((entry) => entry.kind)).toEqual([
      "message",
      "agent_message",
    ]);
    expect(page.next_cursor).toBe("2");

    const nextPage = projectTranscriptEntries("sess_1", messages, items, {
      after: Number(page.next_cursor),
      limit: 2,
    });
    expect(nextPage.items.map((entry) => entry.kind)).toEqual(["tool"]);
  });
});

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
    codex_method: "item/agentMessage/delta",
    codex_item_id: "agent_1",
    codex_item_type: "agentMessage",
    created_at: `2026-01-01T00:00:${String(input.sequence ?? 1).padStart(
      2,
      "0",
    )}.000Z`,
    raw_payload: {},
    text_excerpt: "delta",
    ...input,
  };
}
