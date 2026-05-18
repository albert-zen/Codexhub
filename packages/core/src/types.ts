export type ID = string;

export type WorkerSessionStatus =
  | "starting"
  | "running"
  | "awaiting_input"
  | "completed"
  | "failed"
  | "stopped";

export type WorkspaceStatus =
  | "creating"
  | "ready"
  | "error"
  | "archived"
  | "deleted";
export type WorkspaceSourceType = "git" | "local";
export type MessageMode = "initial" | "steer" | "continue";
export type SenderType = "manager_agent" | "human" | "system";
export type MessageStatus = "queued" | "sent" | "failed";
export type ReviewGateStatusFlag =
  | "implementation_done"
  | "self_validation_done"
  | "review_requested"
  | "review_addressed"
  | "ready_for_human_review";

export type ItemType =
  | "agentmessage"
  | "toolcall"
  | "toolresult"
  | "error"
  | "state"
  | "reasoning"
  | "raw";

export interface Project {
  id: ID;
  name: string;
  default_repo_url: string | null;
  default_workspace_root: string | null;
  default_cwd: string | null;
  default_branch: string | null;
  default_codex_options: unknown | null;
  created_at: string;
  updated_at: string;
}

export interface Workspace {
  id: ID;
  project_id: ID;
  source_type: WorkspaceSourceType;
  repo_url: string | null;
  path: string;
  cwd: string;
  branch: string | null;
  commit_sha: string | null;
  status: WorkspaceStatus;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunGroup {
  id: ID;
  project_id: ID | null;
  name: string;
  purpose: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkerSession {
  id: ID;
  project_id: ID;
  workspace_id: ID;
  status: WorkerSessionStatus;
  codex_thread_id: string | null;
  codex_turn_id: string | null;
  codex_session_key: string | null;
  process_pid: string | null;
  last_agent_message_item_id: ID | null;
  last_agent_message: string | null;
  last_agent_message_at: string | null;
  last_item_sequence: number;
  failure_reason: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskSpecMetadata {
  session_id: ID;
  ref: string | null;
  title: string | null;
  intent: string | null;
  scope: string | null;
  acceptance_criteria: string | null;
  raw: string | null;
  created_at: string;
}

export interface Item {
  id: ID;
  session_id: ID;
  sequence: number;
  type: ItemType;
  codex_method: string | null;
  codex_item_id: string | null;
  codex_item_type: string | null;
  created_at: string;
  raw_payload: unknown;
  text_excerpt: string | null;
}

export interface Message {
  id: ID;
  session_id: ID;
  mode: MessageMode;
  content: string;
  sender_type: SenderType;
  sender_id: string | null;
  status: MessageStatus;
  codex_request_id: string | null;
  error: string | null;
  created_at: string;
  sent_at: string | null;
}

export type TranscriptEntryKind =
  | "message"
  | "agent_message"
  | "tool"
  | "debug";
export type TranscriptEntryRole =
  | "manager_agent"
  | "human"
  | "system"
  | "agent"
  | "tool"
  | "debug";
export type TranscriptEntrySource = "message" | "item";

export interface TranscriptEntry {
  id: ID;
  session_id: ID;
  sequence: number;
  kind: TranscriptEntryKind;
  role: TranscriptEntryRole;
  source: TranscriptEntrySource;
  source_id: ID;
  created_at: string;
  text: string | null;
  message_mode: MessageMode | null;
  message_status: MessageStatus | null;
  sender_type: SenderType | null;
  item_type: ItemType | null;
  codex_method: string | null;
  codex_item_id: string | null;
  codex_item_type: string | null;
  item_ids: ID[];
  item_sequences: number[];
}

export interface ReviewGateStatus {
  session_id: ID;
  implementation_done: boolean;
  self_validation_done: boolean;
  review_requested: boolean;
  review_addressed: boolean;
  ready_for_human_review: boolean;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
  limit: number;
}
