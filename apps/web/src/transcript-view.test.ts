import { describe, expect, it } from "vitest";
import type { TranscriptEntry } from "@codexhub/core";

import {
  RECENT_TRANSCRIPT_CURSOR,
  conversationEntries,
  conversationWindow,
} from "./transcript-view.js";

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

  it("uses the latest visible entries from a larger recent transcript fetch", () => {
    const entries = conversationWindow(
      [
        transcriptEntry({
          id: "message:old",
          sequence: 1,
          kind: "message",
          role: "human",
          source: "message",
          text: "Older prompt.",
        }),
        transcriptEntry({
          id: "debug:state",
          sequence: 2,
          kind: "debug",
          role: "debug",
          text: "state changed",
          item_type: "state",
        }),
        transcriptEntry({
          id: "agent:draft",
          sequence: 3,
          kind: "agent_message",
          role: "agent",
          text: "par tial",
          codex_method: "item/agentMessage/delta",
        }),
        transcriptEntry({
          id: "message:latest",
          sequence: 4,
          kind: "message",
          role: "human",
          source: "message",
          text: "Latest prompt.",
        }),
        transcriptEntry({
          id: "agent:latest",
          sequence: 5,
          kind: "agent_message",
          role: "agent",
          text: "Latest answer.",
          codex_method: "item/completed",
        }),
      ],
      2,
    );

    expect(entries.map((entry) => entry.id)).toEqual([
      "message:latest",
      "agent:latest",
    ]);
  });

  it("describes the default cursor as a recent transcript request", () => {
    expect(RECENT_TRANSCRIPT_CURSOR).toEqual({
      afterSequence: null,
      recent: true,
    });
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
