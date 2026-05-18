import { describe, expect, it } from "vitest";
import type { TranscriptEntry } from "@codexhub/core";

import { conversationEntries } from "./transcript-view.js";

describe("conversationEntries", () => {
  it("keeps sent user messages, completed agent messages, and tools", () => {
    const entries = conversationEntries([
      transcriptEntry({
        id: "message:1",
        kind: "message",
        role: "manager_agent",
        source: "message",
        text: "Build the thing.",
        message_mode: "initial",
        message_status: "sent",
      }),
      transcriptEntry({
        id: "agent:1",
        kind: "agent_message",
        role: "agent",
        text: "Done.",
        codex_method: "item/completed",
      }),
      transcriptEntry({
        id: "tool:1",
        kind: "tool",
        role: "tool",
        text: null,
        item_type: "toolcall",
      }),
    ]);

    expect(entries.map((entry) => entry.id)).toEqual([
      "message:1",
      "agent:1",
      "tool:1",
    ]);
  });

  it("does not show delta-backed agent drafts as normal messages", () => {
    const entries = conversationEntries([
      transcriptEntry({
        id: "agent:draft",
        kind: "agent_message",
        role: "agent",
        text: "part ial wor ds",
        codex_method: "item/agentMessage/delta",
      }),
      transcriptEntry({
        id: "debug:1",
        kind: "debug",
        role: "debug",
        text: "state changed",
        item_type: "state",
      }),
    ]);

    expect(entries).toEqual([]);
  });
});

function transcriptEntry(
  input: Partial<TranscriptEntry> = {},
): TranscriptEntry {
  return {
    id: "entry_1",
    session_id: "sess_1",
    sequence: 1,
    kind: "message",
    role: "human",
    source: "item",
    source_id: "source_1",
    created_at: "2026-01-01T00:00:00.000Z",
    text: "Hello",
    message_mode: null,
    message_status: null,
    sender_type: null,
    item_type: null,
    codex_method: null,
    codex_item_id: null,
    codex_item_type: null,
    item_ids: [],
    item_sequences: [],
    ...input,
  };
}
