import { describe, expect, it } from "vitest";
import type { TranscriptEntry, WorkerSession } from "@codexhub/core";

import {
  canSendThreadMessage,
  conversationPageLabel,
  isEmptyThreadSession,
  isResumableThreadSession,
} from "./thread-ui-state.js";

describe("thread UI state", () => {
  it("treats a project-scoped empty thread as immediately sendable", () => {
    const thread = session({
      status: "starting",
      started_at: null,
      codex_thread_id: null,
      last_item_sequence: 0,
      last_agent_message: null,
    });

    expect(isEmptyThreadSession(thread)).toBe(true);
    expect(
      canSendThreadMessage({
        session: thread,
        message: "Start here.",
        submitting: null,
        continueDisabled: true,
      }),
    ).toBe(true);
  });

  it("keeps exited Codex threads sendable so the API can resume them invisibly", () => {
    const thread = session({
      status: "completed",
      codex_thread_id: "thread_1",
      process_pid: null,
      ended_at: "2026-05-22T00:00:00.000Z",
    });

    expect(isResumableThreadSession(thread)).toBe(true);
    expect(
      canSendThreadMessage({
        session: thread,
        message: "Continue.",
        submitting: null,
        continueDisabled: true,
      }),
    ).toBe(true);
  });

  it("labels the visible conversation without leaking cursor internals", () => {
    expect(conversationPageLabel([])).toBe("No visible messages");
    expect(
      conversationPageLabel([transcriptEntry(1), transcriptEntry(8)]),
    ).toBe("2 visible messages");
  });
});

function session(overrides: Partial<WorkerSession>): WorkerSession {
  return {
    id: "sess_1",
    project_id: "proj_1",
    workspace_id: "work_1",
    previous_session_id: null,
    status: "awaiting_input",
    codex_thread_id: "thread_1",
    codex_turn_id: null,
    codex_session_key: null,
    process_pid: "pid",
    last_agent_message_item_id: null,
    last_agent_message: "Ready.",
    last_agent_message_at: null,
    last_item_sequence: 1,
    failure_reason: null,
    started_at: "2026-05-22T00:00:00.000Z",
    ended_at: null,
    created_at: "2026-05-22T00:00:00.000Z",
    updated_at: "2026-05-22T00:00:00.000Z",
    ...overrides,
  };
}

function transcriptEntry(sequence: number): TranscriptEntry {
  return {
    id: `entry_${sequence}`,
    session_id: "sess_1",
    sequence,
    kind: "agent_message",
    role: "agent",
    source: "item",
    source_id: `item_${sequence}`,
    created_at: "2026-05-22T00:00:00.000Z",
    text: "Ready.",
    message_mode: null,
    message_status: null,
    sender_type: null,
    item_type: "agentmessage",
    codex_method: "item/completed",
    codex_item_id: null,
    codex_item_type: "agent_message",
    item_ids: [`item_${sequence}`],
    item_sequences: [sequence],
  };
}
