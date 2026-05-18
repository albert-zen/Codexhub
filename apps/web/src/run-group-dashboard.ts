import type {
  RunGroupAttentionReason,
  RunGroupSessionSummary,
} from "@codexhub/core";

export interface RunGroupDashboardCounts {
  total: number;
  attention: number;
  failed: number;
  awaitingInput: number;
  reviewNeeded: number;
  openReviewFindings: number;
}

const ATTENTION_LABELS: Record<RunGroupAttentionReason, string> = {
  failed: "Failed",
  awaiting_input: "Awaiting Input",
  review_needed: "Review Needed",
  open_review_findings: "Open Findings",
};

export function runGroupDashboardCounts(
  summaries: RunGroupSessionSummary[],
): RunGroupDashboardCounts {
  return summaries.reduce<RunGroupDashboardCounts>(
    (counts, summary) => ({
      total: counts.total + 1,
      attention: counts.attention + (summary.attention_required ? 1 : 0),
      failed: counts.failed + (hasAttention(summary, "failed") ? 1 : 0),
      awaitingInput:
        counts.awaitingInput +
        (hasAttention(summary, "awaiting_input") ? 1 : 0),
      reviewNeeded:
        counts.reviewNeeded + (hasAttention(summary, "review_needed") ? 1 : 0),
      openReviewFindings:
        counts.openReviewFindings +
        (hasAttention(summary, "open_review_findings") ? 1 : 0),
    }),
    {
      total: 0,
      attention: 0,
      failed: 0,
      awaitingInput: 0,
      reviewNeeded: 0,
      openReviewFindings: 0,
    },
  );
}

export function attentionLabels(summary: RunGroupSessionSummary): string[] {
  return summary.attention_reasons.map((reason) => ATTENTION_LABELS[reason]);
}

export function reviewStateLabel(summary: RunGroupSessionSummary): string {
  if (summary.open_review_finding_count > 0) {
    return `${summary.open_review_finding_count} open finding${summary.open_review_finding_count === 1 ? "" : "s"}`;
  }
  if (summary.review_status.review_addressed) return "Review addressed";
  if (
    summary.review_status.review_requested ||
    summary.review_status.ready_for_human_review
  ) {
    return "Review needed";
  }
  if (summary.review_status.self_validation_done) return "Self validated";
  if (summary.review_status.implementation_done) return "Implemented";
  return "No review state";
}

function hasAttention(
  summary: RunGroupSessionSummary,
  reason: RunGroupAttentionReason,
): boolean {
  return summary.attention_reasons.includes(reason);
}
