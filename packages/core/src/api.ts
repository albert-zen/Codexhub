import type {
  Item,
  Message,
  Page,
  Project,
  WorkerSession,
  Workspace,
} from "./types.js";

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

export interface CreateProjectRequest {
  name: string;
  default_repo_url?: string | null;
  default_workspace_root?: string | null;
  default_cwd?: string | null;
  default_branch?: string | null;
  default_codex_options?: unknown | null;
}

export interface CreateWorkspaceRequest {
  project_id?: string;
  project?: string;
  source_type?: "git" | "local";
  repo_url?: string | null;
  path?: string | null;
  cwd?: string | null;
  branch?: string | null;
}

export interface StartSessionRequest {
  workspace_id: string;
  prompt: string;
  codex_options?: unknown;
}

export interface SendMessageRequest {
  mode: "initial" | "steer" | "continue";
  content: string;
  sender_type?: "manager_agent" | "human" | "system";
  sender_id?: string | null;
}

export interface ProjectResponse {
  project: Project;
}

export interface WorkspaceResponse {
  workspace: Workspace;
}

export interface SessionResponse {
  session: WorkerSession;
  workspace?: Workspace;
}

export interface ItemListResponse extends Page<Item> {
  session_id: string;
  type: string;
}

export interface LatestItemResponse {
  session_id: string;
  type: string;
  item: Item | null;
}

export interface MessageResponse {
  message: Message;
  session?: WorkerSession;
}
