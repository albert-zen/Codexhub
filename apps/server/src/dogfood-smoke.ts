import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  FollowUpSessionResponse,
  LatestItemResponse,
  MessageResponse,
  Project,
  ProjectResponse,
  RunGroup,
  RunGroupResponse,
  SessionResponse,
  TranscriptEntry,
  TranscriptListResponse,
  WorkerSession,
  Workspace,
  WorkspaceResponse,
} from "@codexhub/core";
import { createServer } from "./server.js";

type SmokeMode = "fake" | "real";
type FrictionSeverity = "info" | "medium" | "high";
type SessionRole = "initial" | "continued" | "follow_up";

interface DogfoodSmokeOptions {
  apiBaseUrl?: string;
  mode?: SmokeMode;
  sessionCount?: number;
  workspaceRoot?: string;
  runName?: string;
  timeoutMs?: number;
  pollMs?: number;
  keepArtifacts?: boolean;
  fetchImpl?: typeof fetch;
}

interface CliOptions extends DogfoodSmokeOptions {
  json: boolean;
}

interface SmokeFriction {
  severity: FrictionSeverity;
  area: string;
  message: string;
  session_id?: string;
}

interface SmokeTraceEntry {
  sequence: number;
  kind: string;
  text: string | null;
}

interface SmokeSessionQueries {
  inspect: string;
  latest: string;
  trace: string;
  cli_latest: string;
  cli_trace: string;
}

interface SmokeSessionSummary {
  id: string;
  role: SessionRole;
  previous_session_id: string | null;
  workspace_id: string;
  status: WorkerSession["status"];
  latest_message: string | null;
  last_item_sequence: number;
  trace_excerpt: SmokeTraceEntry[];
  queries: SmokeSessionQueries;
}

interface SmokeQueryExample {
  description: string;
  method?: string;
  path?: string;
  cli?: string;
}

export interface DogfoodSmokeSummary {
  ok: boolean;
  mode: SmokeMode;
  api_base_url: string;
  managed_server: boolean;
  run_root: string;
  workspace_root: string;
  artifacts_kept: boolean;
  project: Pick<Project, "id" | "name">;
  run_group: Pick<RunGroup, "id" | "name" | "purpose">;
  workspaces: Array<Pick<Workspace, "id" | "path" | "cwd" | "status">>;
  sessions: SmokeSessionSummary[];
  query_examples: SmokeQueryExample[];
  friction: SmokeFriction[];
}

const DEFAULT_SESSION_COUNT = 3;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_MS = 1_000;

export async function runDogfoodSmoke(
  input: DogfoodSmokeOptions = {},
): Promise<DogfoodSmokeSummary> {
  const mode = input.mode ?? "fake";
  const sessionCount = positiveInteger(
    input.sessionCount,
    DEFAULT_SESSION_COUNT,
    "sessionCount",
  );
  const timeoutMs = positiveInteger(
    input.timeoutMs,
    DEFAULT_TIMEOUT_MS,
    "timeoutMs",
  );
  const pollMs = positiveInteger(input.pollMs, DEFAULT_POLL_MS, "pollMs");
  const fetchImpl = input.fetchImpl ?? fetch;
  const managedServer = !input.apiBaseUrl;
  const createdRunRoot = await realpath(
    await mkdtemp(join(tmpdir(), "codexhub-dogfood-")),
  );
  const runRoot = createdRunRoot;
  const usesGeneratedWorkspaceRoot = !input.workspaceRoot;
  const workspaceRoot = input.workspaceRoot
    ? resolve(input.workspaceRoot)
    : join(runRoot, "workspaces");
  const keepRunRoot =
    input.keepArtifacts === true ||
    (!managedServer && usesGeneratedWorkspaceRoot);
  const artifactsKept =
    input.keepArtifacts === true ||
    input.workspaceRoot !== undefined ||
    !managedServer;
  await mkdir(workspaceRoot, { recursive: true });

  const dbPath = join(runRoot, "codexhub.sqlite");
  const app = managedServer
    ? await createServer({ dbPath, logger: false })
    : null;
  let apiBaseUrl = input.apiBaseUrl ?? "";

  try {
    if (app) {
      await app.listen({ host: "127.0.0.1", port: 0 });
      const address = app.server.address();
      if (!address || typeof address === "string") {
        throw new Error("managed dogfood server did not expose a TCP address");
      }
      apiBaseUrl = `http://127.0.0.1:${address.port}`;
    }

    const api = new SmokeApi(apiBaseUrl, fetchImpl);
    const friction: SmokeFriction[] = [];
    const workspaces: DogfoodSmokeSummary["workspaces"] = [];
    const sessions: SmokeSessionSummary[] = [];
    const runName =
      input.runName ??
      `Dogfood smoke ${new Date().toISOString().replace(/[:.]/g, "-")}`;

    await api.get("/api/v1/health");
    const project = (
      await api.post<ProjectResponse>("/api/v1/projects", {
        name: runName,
        default_workspace_root: workspaceRoot,
        ...(mode === "fake" ? { default_codex_options: { fake: true } } : {}),
      })
    ).project;
    const runGroup = (
      await api.post<RunGroupResponse>("/api/v1/run-groups", {
        name: runName,
        project_id: project.id,
        purpose: `${mode} dogfood smoke for project/workspace/session control-plane paths.`,
      })
    ).run_group;

    for (let index = 1; index <= sessionCount; index += 1) {
      const workspace = (
        await api.post<WorkspaceResponse>("/api/v1/workspaces", {
          project_id: project.id,
          source_type: "local",
          path: join(workspaceRoot, `worker-${index}`),
        })
      ).workspace;
      workspaces.push(workspaceSummary(workspace));

      const session = await startSession(api, project, workspace, mode, index);
      await addToRunGroup(api, runGroup.id, session.session.id);
      const settled = await waitForSession(api, session.session.id, {
        timeoutMs,
        pollMs,
        friction,
      });
      sessions.push(await summarizeSession(api, settled, "initial", friction));
    }

    await continueFirstSession(api, sessions, mode, {
      timeoutMs,
      pollMs,
      friction,
    });
    await createFollowUpSession(api, runGroup, sessions, mode, {
      timeoutMs,
      pollMs,
      friction,
    });

    const summary: DogfoodSmokeSummary = {
      ok: !friction.some((entry) => entry.severity === "high"),
      mode,
      api_base_url: apiBaseUrl,
      managed_server: managedServer,
      run_root: runRoot,
      workspace_root: workspaceRoot,
      artifacts_kept: artifactsKept,
      project: { id: project.id, name: project.name },
      run_group: {
        id: runGroup.id,
        name: runGroup.name,
        purpose: runGroup.purpose,
      },
      workspaces,
      sessions,
      query_examples: queryExamples(runGroup.id, sessions),
      friction,
    };

    return summary;
  } finally {
    if (app) await app.close();
    if (!keepRunRoot) {
      await rm(runRoot, { recursive: true, force: true });
    }
  }
}

export function formatDogfoodSmokeSummary(
  summary: DogfoodSmokeSummary,
): string {
  const lines = [
    `Codexhub dogfood smoke: ${summary.ok ? "ok" : "friction found"}`,
    `Mode: ${summary.mode}`,
    `API: ${summary.api_base_url}`,
    `Project: ${summary.project.id} ${summary.project.name}`,
    `Run group: ${summary.run_group.id} ${summary.run_group.name}`,
    `Workspace root: ${summary.workspace_root}`,
  ];

  if (!summary.artifacts_kept) {
    lines.push("Artifacts: removed after run");
  } else {
    lines.push(`Artifacts: kept at ${summary.run_root}`);
  }

  lines.push("", "Sessions:");
  for (const session of summary.sessions) {
    lines.push(
      `- ${session.id} ${session.status} role=${session.role} workspace=${session.workspace_id}`,
    );
    if (session.previous_session_id) {
      lines.push(`  previous=${session.previous_session_id}`);
    }
    lines.push(
      `  latest=${session.latest_message ? JSON.stringify(oneLine(session.latest_message, 180)) : "null"}`,
    );
    lines.push(`  trace=${session.queries.cli_trace}`);
  }

  lines.push("", "Query examples:");
  for (const example of summary.query_examples) {
    if (example.cli) lines.push(`- ${example.description}: ${example.cli}`);
    if (example.method && example.path) {
      lines.push(`- ${example.description}: ${example.method} ${example.path}`);
    }
  }

  lines.push("", "Friction:");
  if (summary.friction.length === 0) {
    lines.push("- none discovered");
  } else {
    for (const entry of summary.friction) {
      const session = entry.session_id ? ` session=${entry.session_id}` : "";
      lines.push(
        `- ${entry.severity} ${entry.area}${session}: ${entry.message}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

function workspaceSummary(
  workspace: Workspace,
): Pick<Workspace, "id" | "path" | "cwd" | "status"> {
  return {
    id: workspace.id,
    path: workspace.path,
    cwd: workspace.cwd,
    status: workspace.status,
  };
}

async function startSession(
  api: SmokeApi,
  project: Project,
  workspace: Workspace,
  mode: SmokeMode,
  index: number,
): Promise<SessionResponse> {
  return api.post<SessionResponse>(
    "/api/v1/sessions",
    withCodexOptions(
      {
        project_id: project.id,
        workspace_id: workspace.id,
        initial_message: [
          `Codexhub dogfood smoke worker ${index}.`,
          "Do not edit files or product code.",
          "Report the workspace status and any control-plane friction you notice.",
        ].join("\n"),
        task_spec: {
          ref: "GitHub issue #27",
          title: "Dogfood smoke worker",
          intent:
            "Exercise Codexhub project, run group, workspace, session, latest, and trace APIs.",
          scope:
            "Read-only worker prompt for smoke validation; do not change product code.",
          acceptance_criteria:
            "Session reaches a readable status and exposes latest message plus trace.",
        },
      },
      mode,
    ),
  );
}

async function continueFirstSession(
  api: SmokeApi,
  sessions: SmokeSessionSummary[],
  mode: SmokeMode,
  options: PollOptions,
): Promise<void> {
  const first = sessions.find((session) => session.role === "initial");
  if (!first) return;
  if (first.status !== "awaiting_input") {
    options.friction.push({
      severity: "medium",
      area: "continue",
      session_id: first.id,
      message: `skipped continue because status was ${first.status}`,
    });
    return;
  }

  await api.post<MessageResponse>(
    `/api/v1/sessions/${encodeURIComponent(first.id)}/messages`,
    withCodexOptions(
      {
        mode: "continue",
        content:
          "Continue the dogfood smoke without editing files. Report whether the session controls remain clear.",
        sender_type: "manager_agent",
      },
      mode,
    ),
  );
  const settled = await waitForSession(api, first.id, options);
  const updated = await summarizeSession(
    api,
    settled,
    "continued",
    options.friction,
  );
  const index = sessions.findIndex((session) => session.id === first.id);
  if (index >= 0) sessions[index] = updated;
}

async function createFollowUpSession(
  api: SmokeApi,
  runGroup: RunGroup,
  sessions: SmokeSessionSummary[],
  mode: SmokeMode,
  options: PollOptions,
): Promise<void> {
  const source = [...sessions]
    .reverse()
    .find((session) => session.role !== "follow_up");
  if (!source) return;
  if (source.status !== "awaiting_input") {
    options.friction.push({
      severity: "medium",
      area: "follow_up",
      session_id: source.id,
      message: `skipped follow-up because source status was ${source.status}`,
    });
    return;
  }

  const stopped = await api.post<SessionResponse>(
    `/api/v1/sessions/${encodeURIComponent(source.id)}/stop`,
    {},
  );
  const sourceIndex = sessions.findIndex((session) => session.id === source.id);
  if (sourceIndex >= 0) {
    sessions[sourceIndex] = await summarizeSession(
      api,
      stopped.session,
      source.role,
      options.friction,
    );
  }

  const followUp = await api.post<FollowUpSessionResponse>(
    `/api/v1/sessions/${encodeURIComponent(source.id)}/follow-up`,
    withCodexOptions(
      {
        initial_message:
          "Start a follow-up dogfood smoke session. Do not edit files; report status and any handoff friction.",
        task_spec: {
          title: "Dogfood smoke follow-up",
          scope:
            "Verify terminal-session follow-up uses a new worker session without mutating code.",
        },
      },
      mode,
    ),
  );
  await addToRunGroup(api, runGroup.id, followUp.session.id);
  const settled = await waitForSession(api, followUp.session.id, options);
  sessions.push(
    await summarizeSession(api, settled, "follow_up", options.friction),
  );
}

async function addToRunGroup(
  api: SmokeApi,
  runGroupId: string,
  sessionId: string,
): Promise<void> {
  await api.post(
    `/api/v1/run-groups/${encodeURIComponent(runGroupId)}/sessions`,
    {
      session_id: sessionId,
    },
  );
}

interface PollOptions {
  timeoutMs: number;
  pollMs: number;
  friction: SmokeFriction[];
}

async function waitForSession(
  api: SmokeApi,
  sessionId: string,
  options: PollOptions,
): Promise<WorkerSession> {
  const deadline = Date.now() + options.timeoutMs;
  let inspected = await api.get<SessionResponse>(
    `/api/v1/sessions/${encodeURIComponent(sessionId)}`,
  );

  while (
    (inspected.session.status === "starting" ||
      inspected.session.status === "running") &&
    Date.now() < deadline
  ) {
    await delay(options.pollMs);
    inspected = await api.get<SessionResponse>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}`,
    );
  }

  if (
    inspected.session.status === "starting" ||
    inspected.session.status === "running"
  ) {
    options.friction.push({
      severity: "high",
      area: "poll",
      session_id: sessionId,
      message: `timed out after ${options.timeoutMs}ms waiting for session to settle`,
    });
  }
  if (inspected.session.status === "failed") {
    options.friction.push({
      severity: "high",
      area: "session",
      session_id: sessionId,
      message: inspected.session.failure_reason ?? "session failed",
    });
  }

  return inspected.session;
}

async function summarizeSession(
  api: SmokeApi,
  session: WorkerSession,
  role: SessionRole,
  friction: SmokeFriction[],
): Promise<SmokeSessionSummary> {
  const latest = await api.get<LatestItemResponse>(
    `/api/v1/sessions/${encodeURIComponent(session.id)}/latest`,
  );
  const transcript = await api.get<TranscriptListResponse>(
    `/api/v1/sessions/${encodeURIComponent(session.id)}/transcript?limit=6&recent=true`,
  );
  const latestMessage =
    latest.last_agent_message ??
    latest.item?.text_excerpt ??
    session.last_agent_message;
  if (!latestMessage && session.status !== "failed") {
    friction.push({
      severity: "medium",
      area: "latest",
      session_id: session.id,
      message: "no latest agent message was available",
    });
  }

  return {
    id: session.id,
    role,
    previous_session_id: session.previous_session_id,
    workspace_id: session.workspace_id,
    status: session.status,
    latest_message: latestMessage,
    last_item_sequence: session.last_item_sequence,
    trace_excerpt: transcript.transcript.map(traceSummary),
    queries: sessionQueries(session.id),
  };
}

function traceSummary(entry: TranscriptEntry): SmokeTraceEntry {
  return {
    sequence: entry.sequence,
    kind: entry.kind,
    text: entry.text ? oneLine(entry.text, 220) : null,
  };
}

function withCodexOptions(
  body: Record<string, unknown>,
  mode: SmokeMode,
): Record<string, unknown> {
  if (mode === "fake") return { ...body, codex_options: { fake: true } };
  return body;
}

function sessionQueries(sessionId: string): SmokeSessionQueries {
  const encoded = encodeURIComponent(sessionId);
  return {
    inspect: `/api/v1/sessions/${encoded}`,
    latest: `/api/v1/sessions/${encoded}/latest`,
    trace: `/api/v1/sessions/${encoded}/transcript?limit=20&recent=true`,
    cli_latest: `pnpm --filter @codexhub/cli dev -- session latest ${sessionId}`,
    cli_trace: `pnpm --filter @codexhub/cli dev -- session trace ${sessionId} --limit 20`,
  };
}

function queryExamples(
  runGroupId: string,
  sessions: SmokeSessionSummary[],
): SmokeQueryExample[] {
  const firstSession = sessions[0];
  const examples: SmokeQueryExample[] = [
    {
      description: "List run-group sessions",
      method: "GET",
      path: `/api/v1/run-groups/${encodeURIComponent(runGroupId)}/sessions`,
    },
    {
      description: "List run-group sessions with CLI",
      cli: `pnpm --filter @codexhub/cli dev -- run-group sessions ${runGroupId}`,
    },
  ];
  if (firstSession) {
    examples.push(
      {
        description: "Read stable latest message",
        method: "GET",
        path: firstSession.queries.latest,
      },
      {
        description: "Read bounded transcript trace",
        method: "GET",
        path: firstSession.queries.trace,
      },
      {
        description: "Read bounded transcript trace with CLI",
        cli: firstSession.queries.cli_trace,
      },
    );
  }
  return examples;
}

class SmokeApi {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly fetchImpl: typeof fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async get<T = unknown>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  async post<T = unknown>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const init: RequestInit = { method };
    if (body) {
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify(body);
    }

    const response = await this.fetchImpl(
      `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`,
      init,
    );
    const responseBody = await readResponseBody(response);
    if (!response.ok) {
      throw new Error(
        `${method} ${path} failed with HTTP ${response.status}: ${errorText(responseBody)}`,
      );
    }
    return responseBody as T;
  }
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.message === "string") return record.message;
    const error = record.error;
    if (error && typeof error === "object") {
      const errorRecord = error as Record<string, unknown>;
      if (typeof errorRecord.message === "string") {
        return errorRecord.message;
      }
    }
  }
  return JSON.stringify(value);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const candidate = value ?? fallback;
  if (!Number.isInteger(candidate) || candidate < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return candidate;
}

function oneLine(value: string, maxLength: number): string {
  const line = value.replace(/\s+/g, " ").trim();
  if (line.length <= maxLength) return line;
  return `${line.slice(0, maxLength - 3)}...`;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--real") {
      options.mode = "real";
    } else if (arg === "--fake") {
      options.mode = "fake";
    } else if (arg === "--keep-artifacts") {
      options.keepArtifacts = true;
    } else if (arg === "--api") {
      options.apiBaseUrl = requiredArg(argv, index, arg);
      index += 1;
    } else if (arg === "--workspace-root") {
      options.workspaceRoot = requiredArg(argv, index, arg);
      index += 1;
    } else if (arg === "--run-name") {
      options.runName = requiredArg(argv, index, arg);
      index += 1;
    } else if (arg === "--sessions") {
      options.sessionCount = parsePositiveInt(
        requiredArg(argv, index, arg),
        arg,
      );
      index += 1;
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = parsePositiveInt(requiredArg(argv, index, arg), arg);
      index += 1;
    } else if (arg === "--poll-ms") {
      options.pollMs = parsePositiveInt(requiredArg(argv, index, arg), arg);
      index += 1;
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return options;
}

function requiredArg(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parsePositiveInt(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function printHelp(): void {
  process.stdout.write(`Usage: pnpm smoke:dogfood -- [options]

Options:
  --json                   Print the stable JSON summary
  --real                   Use real Codex app-server sessions (explicit opt-in)
  --fake                   Use fake Codex sessions (default)
  --api <url>              Target an already running Codexhub API
  --workspace-root <path>  Root for created local smoke workspaces
  --run-name <name>        Project and run-group name
  --sessions <n>           Initial worker sessions to create (default 3)
  --timeout-ms <n>         Session settle timeout (default 120000)
  --poll-ms <n>            Session poll interval (default 1000)
  --keep-artifacts         Keep temp DB and workspaces for inspection
  --help                   Show this help
`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const summary = await runDogfoodSmoke(options);
  process.stdout.write(
    options.json
      ? `${JSON.stringify(summary, null, 2)}\n`
      : formatDogfoodSmokeSummary(summary),
  );
  if (!summary.ok) process.exitCode = 1;
}

function isMain(): boolean {
  const entry = process.argv[1];
  return Boolean(entry && import.meta.url === pathToFileURL(entry).href);
}

if (isMain()) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
