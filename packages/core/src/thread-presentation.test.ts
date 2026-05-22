import { describe, expect, it } from "vitest";

import { toThreadSummary } from "./thread-presentation.js";
import type { WorkerSession } from "./types.js";

describe("thread presentation", () => {
  it("projects existing sessions into thread-facing state without failed thread lifecycle", () => {
    const failedSession = session({
      status: "failed",
      failure_reason: "process unavailable",
      last_item_sequence: 3,
      last_agent_message: "Partial result.",
    });

    expect(toThreadSummary(failedSession)).toMatchObject({
      id: "sess_1",
      session_id: "sess_1",
      project_id: "proj_1",
      workspace_id: "work_1",
      codex_thread_id: null,
      thread_state: "active",
      conversation_state: "failedToSend",
      runtime_state: "failed",
      last_agent_message: "Partial result.",
      last_item_sequence: 3,
    });
  });

  it("treats sessions with no sent message or item as empty threads", () => {
    expect(
      toThreadSummary(
        session({
          status: "starting",
          last_item_sequence: 0,
          last_agent_message: null,
        }),
      ),
    ).toMatchObject({
      thread_state: "empty",
      conversation_state: "ready",
      runtime_state: "notStarted",
    });
  });
});

function session(input: Partial<WorkerSession> = {}): WorkerSession {
  return {
    id: "sess_1",
    project_id: "proj_1",
    workspace_id: "work_1",
    previous_session_id: null,
    status: "awaiting_input",
    codex_thread_id: null,
    codex_turn_id: null,
    codex_session_key: null,
    process_pid: null,
    last_agent_message_item_id: null,
    last_agent_message: null,
    last_agent_message_at: null,
    last_item_sequence: 0,
    failure_reason: null,
    started_at: null,
    ended_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...input,
  };
}
