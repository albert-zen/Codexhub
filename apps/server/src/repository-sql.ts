import { randomUUID } from "node:crypto";
import type {
  Item,
  ItemType,
  Message,
  MessageMode,
  MessageStatus,
  Project,
  ReviewFinding,
  ReviewFindingSeverity,
  ReviewFindingStatus,
  ReviewGateStatus,
  RunGroup,
  RunGroupSessionSummary,
  SenderType,
  TaskSpecMetadata,
  WorkerSession,
  Workspace,
} from "@codexhub/core";

export type TranscriptUnitSource = "message" | "agent" | "item";

export interface RecentTranscriptUnit {
  unit_source: TranscriptUnitSource;
  entry_id: string;
  codex_item_id: string | null;
  source_id: string | null;
  transcript_sequence: number;
}

export function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function encodeJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

export function clampLimit(
  value: number | undefined,
  fallback: number,
  max: number,
): number {
  if (!Number.isInteger(value) || value === undefined || value < 1) {
    return fallback;
  }
  return Math.min(value, max);
}

export function parseCursor(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function placeholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(", ");
}

export function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function requiredUnitSourceId(unit: RecentTranscriptUnit): string {
  if (unit.source_id === null) {
    throw new Error(`missing source id for transcript unit ${unit.entry_id}`);
  }
  return unit.source_id;
}

export function projectFromRow(row: unknown): Project {
  const record = asRow(row);
  return {
    id: requiredString(record, "id"),
    name: requiredString(record, "name"),
    default_repo_url: string(record, "default_repo_url"),
    default_workspace_root: string(record, "default_workspace_root"),
    default_cwd: string(record, "default_cwd"),
    default_branch: string(record, "default_branch"),
    default_codex_options: parseJson(
      string(record, "default_codex_options_json"),
    ),
    created_at: requiredString(record, "created_at"),
    updated_at: requiredString(record, "updated_at"),
  };
}

export function workspaceFromRow(row: unknown): Workspace {
  const record = asRow(row);
  return {
    id: requiredString(record, "id"),
    project_id: requiredString(record, "project_id"),
    source_type: requiredString(
      record,
      "source_type",
    ) as Workspace["source_type"],
    repo_url: string(record, "repo_url"),
    path: requiredString(record, "path"),
    cwd: requiredString(record, "cwd"),
    branch: string(record, "branch"),
    commit_sha: string(record, "commit_sha"),
    status: requiredString(record, "status") as Workspace["status"],
    last_error: string(record, "last_error"),
    created_at: requiredString(record, "created_at"),
    updated_at: requiredString(record, "updated_at"),
  };
}

export function runGroupFromRow(row: unknown): RunGroup {
  const record = asRow(row);
  return {
    id: requiredString(record, "id"),
    project_id: string(record, "project_id"),
    name: requiredString(record, "name"),
    purpose: string(record, "purpose"),
    created_at: requiredString(record, "created_at"),
    updated_at: requiredString(record, "updated_at"),
  };
}

export function sessionFromRow(row: unknown): WorkerSession {
  const record = asRow(row);
  return {
    id: requiredString(record, "id"),
    project_id: requiredString(record, "project_id"),
    workspace_id: requiredString(record, "workspace_id"),
    previous_session_id: string(record, "previous_session_id"),
    status: requiredString(record, "status") as WorkerSession["status"],
    codex_thread_id: string(record, "codex_thread_id"),
    codex_turn_id: string(record, "codex_turn_id"),
    codex_session_key: string(record, "codex_session_key"),
    process_pid: string(record, "process_pid"),
    last_agent_message_item_id: string(record, "last_agent_message_item_id"),
    last_agent_message: string(record, "last_agent_message"),
    last_agent_message_at: string(record, "last_agent_message_at"),
    last_item_sequence: number(record, "last_item_sequence"),
    failure_reason: string(record, "failure_reason"),
    started_at: string(record, "started_at"),
    ended_at: string(record, "ended_at"),
    created_at: requiredString(record, "created_at"),
    updated_at: requiredString(record, "updated_at"),
  };
}

export function taskSpecFromRow(row: unknown): TaskSpecMetadata {
  const record = asRow(row);
  return {
    session_id: requiredString(record, "session_id"),
    ref: string(record, "ref"),
    title: string(record, "title"),
    intent: string(record, "intent"),
    scope: string(record, "scope"),
    acceptance_criteria: string(record, "acceptance_criteria"),
    raw: string(record, "raw"),
    created_at: requiredString(record, "created_at"),
  };
}

export function itemFromRow(row: unknown): Item {
  const record = asRow(row);
  return {
    id: requiredString(record, "id"),
    session_id: requiredString(record, "session_id"),
    sequence: number(record, "sequence"),
    type: requiredString(record, "type") as ItemType,
    codex_method: string(record, "codex_method"),
    codex_item_id: string(record, "codex_item_id"),
    codex_item_type: string(record, "codex_item_type"),
    created_at: requiredString(record, "created_at"),
    raw_payload: JSON.parse(requiredString(record, "raw_payload_json")),
    text_excerpt: string(record, "text_excerpt"),
  };
}

export function messageFromRow(row: unknown): Message {
  const record = asRow(row);
  return {
    id: requiredString(record, "id"),
    session_id: requiredString(record, "session_id"),
    mode: requiredString(record, "mode") as MessageMode,
    content: requiredString(record, "content"),
    sender_type: requiredString(record, "sender_type") as SenderType,
    sender_id: string(record, "sender_id"),
    status: requiredString(record, "status") as MessageStatus,
    codex_request_id: string(record, "codex_request_id"),
    error: string(record, "error"),
    created_at: requiredString(record, "created_at"),
    sent_at: string(record, "sent_at"),
  };
}

export function recentTranscriptUnitFromRow(
  row: unknown,
): RecentTranscriptUnit {
  const record = asRow(row);
  const unitSource = requiredString(record, "unit_source");
  if (
    unitSource !== "message" &&
    unitSource !== "agent" &&
    unitSource !== "item"
  ) {
    throw new Error(`invalid transcript unit source: ${unitSource}`);
  }

  return {
    unit_source: unitSource,
    entry_id: requiredString(record, "entry_id"),
    codex_item_id: string(record, "codex_item_id"),
    source_id: string(record, "source_id"),
    transcript_sequence: number(record, "transcript_sequence"),
  };
}

export function reviewGateStatusFromRow(row: unknown): ReviewGateStatus {
  const record = asRow(row);
  return {
    session_id: requiredString(record, "session_id"),
    implementation_done: boolean(record, "implementation_done"),
    self_validation_done: boolean(record, "self_validation_done"),
    review_requested: boolean(record, "review_requested"),
    review_addressed: boolean(record, "review_addressed"),
    ready_for_human_review: boolean(record, "ready_for_human_review"),
    note: string(record, "note"),
    created_at: requiredString(record, "created_at"),
    updated_at: requiredString(record, "updated_at"),
  };
}

export function runGroupSessionSummaryFromRow(
  row: unknown,
): RunGroupSessionSummary {
  const session = sessionFromRow(row);
  const reviewStatus = reviewGateStatusFromSummaryRow(row, session);
  const reviewFindingCount = number(asRow(row), "review_finding_count");
  const openReviewFindingCount = number(
    asRow(row),
    "open_review_finding_count",
  );
  const attentionReasons = runGroupAttentionReasons(
    session,
    reviewStatus,
    openReviewFindingCount,
  );
  return {
    session,
    review_status: reviewStatus,
    review_finding_count: reviewFindingCount,
    open_review_finding_count: openReviewFindingCount,
    attention_required: attentionReasons.length > 0,
    attention_reasons: attentionReasons,
  };
}

export function reviewFindingFromRow(row: unknown): ReviewFinding {
  const record = asRow(row);
  return {
    id: requiredString(record, "id"),
    session_id: requiredString(record, "session_id"),
    reviewer_session_id: string(record, "reviewer_session_id"),
    severity: requiredString(record, "severity") as ReviewFindingSeverity,
    status: requiredString(record, "status") as ReviewFindingStatus,
    summary: requiredString(record, "summary"),
    details: string(record, "details"),
    worker_response: string(record, "worker_response"),
    created_at: requiredString(record, "created_at"),
    updated_at: requiredString(record, "updated_at"),
  };
}

function parseJson(value: string | null): unknown | null {
  if (!value) return null;
  return JSON.parse(value);
}

function reviewGateStatusFromSummaryRow(
  row: unknown,
  session: WorkerSession,
): ReviewGateStatus {
  const record = asRow(row);
  if (typeof record.review_status_session_id !== "string") {
    return {
      session_id: session.id,
      implementation_done: false,
      self_validation_done: false,
      review_requested: false,
      review_addressed: false,
      ready_for_human_review: false,
      note: null,
      created_at: session.created_at,
      updated_at: session.updated_at,
    };
  }

  return {
    session_id: requiredString(record, "review_status_session_id"),
    implementation_done: prefixedBoolean(record, "review_implementation_done"),
    self_validation_done: prefixedBoolean(
      record,
      "review_self_validation_done",
    ),
    review_requested: prefixedBoolean(record, "review_requested"),
    review_addressed: prefixedBoolean(record, "review_addressed"),
    ready_for_human_review: prefixedBoolean(
      record,
      "review_ready_for_human_review",
    ),
    note: string(record, "review_note"),
    created_at: requiredString(record, "review_created_at"),
    updated_at: requiredString(record, "review_updated_at"),
  };
}

function runGroupAttentionReasons(
  session: WorkerSession,
  reviewStatus: ReviewGateStatus,
  openReviewFindingCount: number,
): RunGroupSessionSummary["attention_reasons"] {
  const reasons: RunGroupSessionSummary["attention_reasons"] = [];
  if (session.status === "failed") reasons.push("failed");
  if (session.status === "awaiting_input") reasons.push("awaiting_input");
  if (
    (reviewStatus.review_requested || reviewStatus.ready_for_human_review) &&
    !reviewStatus.review_addressed
  ) {
    reasons.push("review_needed");
  }
  if (openReviewFindingCount > 0) reasons.push("open_review_findings");
  return reasons;
}

function asRow(row: unknown): Record<string, unknown> {
  if (row && typeof row === "object" && !Array.isArray(row)) {
    return row as Record<string, unknown>;
  }
  throw new Error("invalid database row");
}

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value === "string") return value;
  throw new Error(`database field ${key} is not a string`);
}

function string(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function number(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value === "number") return value;
  throw new Error(`database field ${key} is not a number`);
}

function boolean(row: Record<string, unknown>, key: string): boolean {
  return number(row, key) === 1;
}

function prefixedBoolean(row: Record<string, unknown>, key: string): boolean {
  return number(row, key) === 1;
}
