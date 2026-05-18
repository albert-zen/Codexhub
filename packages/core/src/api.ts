import type {
  Item,
  ItemType,
  Message,
  MessageMode,
  Page,
  Project,
  ReviewFinding,
  ReviewFindingSeverity,
  ReviewFindingStatus,
  ReviewGateStatus,
  RunGroup,
  SenderType,
  TaskSpecMetadata,
  TranscriptEntry,
  WorkerSession,
  Workspace,
  WorkerSessionStatus,
} from "./types.js";

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    candidate_ids?: string[] | undefined;
    session_id?: string | undefined;
    follow_up_available?: boolean | undefined;
    follow_up_endpoint?: string | undefined;
  };
}

export interface CreateProjectRequest {
  name: string;
  default_repo_url?: string | null | undefined;
  default_workspace_root?: string | null | undefined;
  default_cwd?: string | null | undefined;
  default_branch?: string | null | undefined;
  default_codex_options?: unknown | null | undefined;
}

export interface CreateWorkspaceRequest {
  project_id?: string | undefined;
  project?: string | undefined;
  source_type?: "git" | "local" | undefined;
  mode?: "standard" | "worktree" | undefined;
  repo_url?: string | null | undefined;
  repo_path?: string | null | undefined;
  path?: string | null | undefined;
  cwd?: string | null | undefined;
  branch?: string | null | undefined;
  commit_sha?: string | null | undefined;
}

export interface CleanupWorkspaceRequest {
  delete_files?: boolean | undefined;
}

export interface StartSessionRequest {
  workspace_id: string;
  project_id?: string | null | undefined;
  prompt?: string | undefined;
  initial_message?: string | undefined;
  task_spec?: CreateTaskSpecMetadataRequest | null | undefined;
  codex_options?: unknown | undefined;
}

export interface StartFollowUpSessionRequest {
  workspace_id?: string | null | undefined;
  prompt?: string | undefined;
  initial_message?: string | undefined;
  task_spec?: CreateTaskSpecMetadataRequest | null | undefined;
  codex_options?: unknown | undefined;
  sender_type?: SenderType | undefined;
  sender_id?: string | null | undefined;
}

export interface CreateRunGroupRequest {
  name: string;
  project_id?: string | null | undefined;
  purpose?: string | null | undefined;
}

export interface AddRunGroupSessionRequest {
  session_id: string;
}

export interface CreateTaskSpecMetadataRequest {
  ref?: string | null | undefined;
  title?: string | null | undefined;
  intent?: string | null | undefined;
  scope?: string | null | undefined;
  acceptance_criteria?: string | null | undefined;
  raw?: string | null | undefined;
}

export interface SendMessageRequest {
  mode: MessageMode;
  content: string;
  sender_type?: SenderType | undefined;
  sender_id?: string | null | undefined;
}

export interface UpdateReviewGateStatusRequest {
  implementation_done?: boolean | undefined;
  self_validation_done?: boolean | undefined;
  review_requested?: boolean | undefined;
  review_addressed?: boolean | undefined;
  ready_for_human_review?: boolean | undefined;
  note?: string | null | undefined;
}

export interface CreateReviewFindingRequest {
  reviewer_session_id: string;
  severity: ReviewFindingSeverity;
  summary: string;
  details?: string | null | undefined;
}

export interface UpdateReviewFindingRequest {
  status?: ReviewFindingStatus | undefined;
  worker_response?: string | null | undefined;
}

export interface SessionListQuery {
  project_id?: string | null | undefined;
  workspace_id?: string | null | undefined;
  status?: WorkerSessionStatus | null | undefined;
  limit?: number | undefined;
  cursor?: string | null | undefined;
}

export interface ItemListQuery {
  session_id?: string | undefined;
  type?: ItemType | "all" | null | undefined;
  limit?: number | undefined;
  cursor?: string | null | undefined;
  after?: number | null | undefined;
  after_sequence?: number | null | undefined;
  before?: number | null | undefined;
  before_sequence?: number | null | undefined;
  recent?: boolean | undefined;
}

export interface TranscriptListQuery {
  session_id?: string | undefined;
  limit?: number | undefined;
  cursor?: string | null | undefined;
  after?: number | null | undefined;
  after_sequence?: number | null | undefined;
  before?: number | null | undefined;
  before_sequence?: number | null | undefined;
  recent?: boolean | undefined;
}

export interface SessionListResponse extends Page<WorkerSession> {
  sessions: WorkerSession[];
}

export interface ProjectResponse {
  project: Project;
}

export interface RunGroupResponse {
  run_group: RunGroup;
}

export interface RunGroupListResponse extends Page<RunGroup> {
  run_groups: RunGroup[];
}

export interface WorkspaceResponse {
  workspace: Workspace;
}

export interface WorkspaceCleanupResponse {
  workspace: Workspace;
  cleanup: {
    status: Workspace["status"];
    deleted_files: boolean;
  };
}

export interface SessionResponse {
  session: WorkerSession;
  workspace?: Workspace;
  task_spec?: TaskSpecMetadata | null;
}

export interface FollowUpSessionResponse extends SessionResponse {
  previous_session_id: string;
  previous_session: WorkerSession;
}

export interface ItemListResponse extends Page<Item> {
  session_id: string;
  type: string;
}

export interface TranscriptListResponse extends Page<TranscriptEntry> {
  session_id: string;
  transcript: TranscriptEntry[];
}

export interface LatestItemResponse {
  session_id: string;
  type: string;
  item: Item | null;
  session?: WorkerSession;
  last_agent_message?: string | null;
}

export interface MessageResponse {
  message: Message;
  session?: WorkerSession;
}

export interface ReviewGateStatusResponse {
  review_status: ReviewGateStatus;
}

export interface ReviewFindingResponse {
  review_finding: ReviewFinding;
}

export interface ReviewFindingListResponse extends Page<ReviewFinding> {
  review_findings: ReviewFinding[];
}
