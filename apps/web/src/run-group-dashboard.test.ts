import type { RunGroupSessionSummary } from "@codexhub/core";
import { describe, expect, it } from "vitest";

import {
  attentionLabels,
  reviewStateLabel,
  runGroupDashboardCounts,
} from "./run-group-dashboard.js";

describe("run group dashboard helpers", () => {
  it("counts attention states without inspecting raw history", () => {
    const summaries = [
      summary({
        attention_reasons: ["failed"],
        attention_required: true,
      }),
      summary({
        attention_reasons: ["review_needed", "open_review_findings"],
        attention_required: true,
        open_review_finding_count: 2,
        review_finding_count: 3,
        review_status: {
          review_requested: true,
          ready_for_human_review: true,
        },
      }),
      summary(),
    ];

    expect(runGroupDashboardCounts(summaries)).toEqual({
      total: 3,
      attention: 2,
      failed: 1,
      awaitingInput: 0,
      reviewNeeded: 1,
      openReviewFindings: 1,
    });
  });

  it("formats review and attention labels", () => {
    const openFindings = summary({
      attention_reasons: ["review_needed", "open_review_findings"],
      attention_required: true,
      open_review_finding_count: 1,
      review_finding_count: 1,
      review_status: {
        review_requested: true,
      },
    });
    const addressed = summary({
      review_status: {
        review_addressed: true,
      },
    });

    expect(reviewStateLabel(openFindings)).toBe("1 open finding");
    expect(attentionLabels(openFindings)).toEqual([
      "Review Needed",
      "Open Findings",
    ]);
    expect(reviewStateLabel(addressed)).toBe("Review addressed");
  });
});

type SummaryOverrides = Omit<
  Partial<RunGroupSessionSummary>,
  "review_status" | "session"
> & {
  review_status?: Partial<RunGroupSessionSummary["review_status"]>;
  session?: Partial<RunGroupSessionSummary["session"]>;
};

function summary(overrides: SummaryOverrides = {}): RunGroupSessionSummary {
  const { review_status, session, ...rest } = overrides;
  return {
    session: {
      id: "sess_1",
      project_id: "proj_1",
      workspace_id: "work_1",
      previous_session_id: null,
      status: "completed",
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
      ...session,
    },
    review_status: {
      session_id: "sess_1",
      implementation_done: false,
      self_validation_done: false,
      review_requested: false,
      review_addressed: false,
      ready_for_human_review: false,
      note: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      ...review_status,
    },
    review_finding_count: 0,
    open_review_finding_count: 0,
    attention_required: false,
    attention_reasons: [],
    ...rest,
  };
}
