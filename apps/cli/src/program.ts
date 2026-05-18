import { readFile } from "node:fs/promises";
import { Command, InvalidArgumentError } from "commander";
import type {
  CreateProjectRequest,
  CreateRunGroupRequest,
  CreateWorkspaceRequest,
  CleanupWorkspaceRequest,
  ItemListQuery,
  ItemType,
  MessageMode,
  SendMessageRequest,
  SenderType,
  SessionListQuery,
  StartSessionRequest,
  TranscriptListQuery,
  UpdateReviewGateStatusRequest,
  WorkerSessionStatus,
} from "@codexhub/core";
import { ApiClient, ApiError, type FetchLike, type JsonObject } from "./api.js";

type WriteFn = (text: string) => void;
type ReadFileFn = (path: string, encoding: BufferEncoding) => Promise<string>;

export interface CliEnvironment {
  fetch?: FetchLike;
  stdout?: WriteFn;
  stderr?: WriteFn;
  readFile?: ReadFileFn;
  setExitCode?: (code: number) => void;
}

interface BaseCommandOptions {
  json?: boolean;
}

interface ProjectCreateOptions extends BaseCommandOptions {
  name: string;
  repoUrl?: string;
  workspaceRoot?: string;
  cwd?: string;
  branch?: string;
  codexOptions?: string;
}

interface WorkspaceCreateOptions extends BaseCommandOptions {
  project: string;
  source: string;
  mode?: string;
  repoUrl?: string;
  repoPath?: string;
  path: string;
  cwd?: string;
  branch?: string;
  commitSha?: string;
}

interface WorkspaceCleanupOptions extends BaseCommandOptions {
  deleteFiles?: boolean;
}

interface RunGroupCreateOptions extends BaseCommandOptions {
  name: string;
  project?: string;
  purpose?: string;
}

interface RunGroupsListOptions extends BaseCommandOptions {
  project?: string;
}

interface RunGroupAddSessionOptions extends BaseCommandOptions {
  session: string;
}

interface SessionStartOptions extends BaseCommandOptions {
  project: string;
  workspace: string;
  message?: string;
  prompt?: string;
  file?: string;
  taskSpecRef?: string;
  taskSpecTitle?: string;
  taskSpecIntent?: string;
  taskSpecScope?: string;
  taskSpecAcceptance?: string;
  taskSpecFile?: string;
  codexOptions?: string;
}

interface SessionsListOptions extends BaseCommandOptions {
  project?: string;
  workspace?: string;
  status?: string;
  limit?: number;
  cursor?: string;
}

interface SessionItemsOptions extends BaseCommandOptions {
  type?: string;
  limit?: number;
  cursor?: string;
  afterSequence?: number;
  beforeSequence?: number;
  recent?: boolean;
}

interface SessionLatestOptions extends BaseCommandOptions {
  type?: string;
}

interface SessionTraceOptions extends BaseCommandOptions {
  type?: string;
  limit?: number;
  cursor?: string;
  afterSequence?: number;
  beforeSequence?: number;
  recent?: boolean;
}

interface SessionSendOptions extends BaseCommandOptions {
  message?: string;
  file?: string;
  mode: string;
  sender: string;
  senderId?: string;
}

interface ReviewStatusSetOptions extends BaseCommandOptions {
  implementationDone?: boolean;
  selfValidationDone?: boolean;
  reviewRequested?: boolean;
  reviewAddressed?: boolean;
  readyForHumanReview?: boolean;
  note?: string;
}

const DEFAULT_API = process.env.CODEXHUB_API ?? "http://127.0.0.1:4317";
const SESSION_REF_DESCRIPTION =
  "Session ID, unique id prefix, or unique UUID prefix";

export function createProgram(env: CliEnvironment = {}): Command {
  const program = new Command();

  program
    .name("codexhub")
    .description("Codexhub worker control plane CLI")
    .version("0.1.0")
    .showHelpAfterError()
    .option("--api <url>", "Codexhub API base URL", DEFAULT_API);

  jsonOption(program.command("health").description("Check API health")).action(
    (opts: BaseCommandOptions) =>
      runAction(env, opts, async () => {
        const api = client(program, env);
        const body = await api.get("/health");
        printResult(env, opts, body, () => {
          const record = asRecord(body);
          return record?.ok === true
            ? `Codexhub is healthy at ${program.opts<{ api: string }>().api}`
            : "Codexhub is not healthy";
        });
      }),
  );

  const project = new Command("project").description("Manage projects");
  jsonOption(project.command("create").description("Create a project"))
    .requiredOption("--name <name>", "Project name")
    .option("--repo-url <url>", "Default repository URL")
    .option("--workspace-root <path>", "Default workspace root")
    .option("--cwd <path>", "Default worker cwd")
    .option("--branch <branch>", "Default branch")
    .option("--codex-options <json>", "Default Codex options as JSON")
    .action((opts: ProjectCreateOptions) =>
      runAction(env, opts, async () => {
        const body = omitUndefined<CreateProjectRequest>({
          name: opts.name,
          default_repo_url: opts.repoUrl,
          default_workspace_root: opts.workspaceRoot,
          default_cwd: opts.cwd,
          default_branch: opts.branch,
          default_codex_options: parseJsonOption(
            opts.codexOptions,
            "--codex-options",
          ),
        });
        const result = await client(program, env).post("/projects", body);
        printResult(env, opts, result, () =>
          formatCreated("Project", unwrapRecord(result, "project"), "name"),
        );
      }),
    );
  program.addCommand(project);

  const runGroup = new Command("run-group").description("Manage a run group");
  jsonOption(runGroup.command("create").description("Create a run group"))
    .requiredOption("--name <name>", "Run group name")
    .option("--project <id>", "Project ID")
    .option("--purpose <text>", "Run group purpose")
    .action((opts: RunGroupCreateOptions) =>
      runAction(env, opts, async () => {
        const body = omitUndefined<CreateRunGroupRequest>({
          name: opts.name,
          project_id: opts.project,
          purpose: opts.purpose,
        });
        const result = await client(program, env).post("/run-groups", body);
        printResult(env, opts, result, () =>
          formatRunGroup(unwrapRecord(result, "run_group")),
        );
      }),
    );
  jsonOption(runGroup.command("inspect").description("Inspect a run group"))
    .argument("<run-group-id>", "Run group ID")
    .action((runGroupId: string, opts: BaseCommandOptions) =>
      runAction(env, opts, async () => {
        const result = await client(program, env).get(
          `/run-groups/${encodeURIComponent(runGroupId)}`,
        );
        printResult(env, opts, result, () =>
          formatRunGroup(unwrapRecord(result, "run_group")),
        );
      }),
    );
  jsonOption(runGroup.command("add-session").description("Add session"))
    .argument("<run-group-id>", "Run group ID")
    .requiredOption("--session <id>", SESSION_REF_DESCRIPTION)
    .action((runGroupId: string, opts: RunGroupAddSessionOptions) =>
      runAction(env, opts, async () => {
        const result = await client(program, env).post(
          `/run-groups/${encodeURIComponent(runGroupId)}/sessions`,
          { session_id: opts.session },
        );
        printResult(
          env,
          opts,
          result,
          () => formatSessions(result) || "Session added.",
        );
      }),
    );
  jsonOption(runGroup.command("sessions").description("List sessions"))
    .argument("<run-group-id>", "Run group ID")
    .action((runGroupId: string, opts: BaseCommandOptions) =>
      runAction(env, opts, async () => {
        const result = await client(program, env).get(
          `/run-groups/${encodeURIComponent(runGroupId)}/sessions`,
        );
        printResult(env, opts, result, () => formatSessions(result));
      }),
    );
  program.addCommand(runGroup);

  const runGroups = new Command("run-groups").description("List run groups");
  jsonOption(runGroups.command("list").description("List run groups"))
    .option("--project <id>", "Project ID filter")
    .action((opts: RunGroupsListOptions) =>
      runAction(env, opts, async () => {
        const result = await client(program, env).get("/run-groups", {
          query: omitQuery({ project_id: opts.project }),
        });
        printResult(env, opts, result, () => formatRunGroups(result));
      }),
    );
  program.addCommand(runGroups);

  const workspace = new Command("workspace").description("Manage workspaces");
  jsonOption(workspace.command("create").description("Create a workspace"))
    .requiredOption("--project <id>", "Project ID")
    .option("--source <local|git>", "Workspace source type", "local")
    .option("--mode <standard|worktree>", "Workspace creation mode", "standard")
    .option("--repo-url <url>", "Repository URL")
    .option("--repo-path <path>", "Local repository path for worktree mode")
    .requiredOption("--path <path>", "Workspace path")
    .option("--cwd <path>", "Worker cwd inside the workspace")
    .option("--branch <branch>", "Workspace branch")
    .option("--commit-sha <sha>", "Workspace commit SHA")
    .action((opts: WorkspaceCreateOptions) =>
      runAction(env, opts, async () => {
        const body = omitUndefined<CreateWorkspaceRequest>({
          project_id: opts.project,
          source_type: parseWorkspaceSource(opts.source),
          mode: parseWorkspaceMode(opts.mode),
          repo_url: opts.repoUrl,
          repo_path: opts.repoPath,
          path: opts.path,
          cwd: opts.cwd,
          branch: opts.branch,
          commit_sha: opts.commitSha,
        });
        const result = await client(program, env).post("/workspaces", body);
        printResult(env, opts, result, () =>
          formatCreated("Workspace", unwrapRecord(result, "workspace"), "path"),
        );
      }),
    );
  jsonOption(workspace.command("cleanup").description("Clean up a workspace"))
    .argument("<workspace-id>", "Workspace ID")
    .option(
      "--delete-files",
      "Delete the workspace directory after safety checks",
    )
    .action((workspaceId: string, opts: WorkspaceCleanupOptions) =>
      runAction(env, opts, async () => {
        const result = await client(program, env).post(
          `/workspaces/${encodeURIComponent(workspaceId)}/cleanup`,
          {
            delete_files: opts.deleteFiles === true,
          } satisfies CleanupWorkspaceRequest,
        );
        printResult(env, opts, result, () =>
          formatWorkspaceCleanup(unwrapRecord(result, "workspace"), result),
        );
      }),
    );
  program.addCommand(workspace);

  const session = new Command("session").description("Manage a worker session");
  jsonOption(session.command("start").description("Start a session"))
    .requiredOption("--project <id>", "Project ID")
    .requiredOption("--workspace <id>", "Workspace ID")
    .option("-m, --message <text>", "Initial message")
    .option("--prompt <text>", "Initial prompt")
    .option("--file <path>", "Read initial message from a file")
    .option("--task-spec-ref <ref>", "Task spec path or external reference")
    .option("--task-spec-title <title>", "Task spec title")
    .option("--task-spec-intent <text>", "Task spec intent")
    .option("--task-spec-scope <text>", "Task spec scope")
    .option("--task-spec-acceptance <text>", "Task spec acceptance criteria")
    .option("--task-spec-file <path>", "Read raw task spec snapshot")
    .option("--codex-options <json>", "Session Codex options as JSON")
    .argument("[message...]", "Initial message")
    .action((messageParts: string[], opts: SessionStartOptions) =>
      runAction(env, opts, async () => {
        const initialMessage = await readContent(
          env,
          [opts.message, opts.prompt],
          opts.file,
          messageParts,
        );
        const taskSpecRaw = opts.taskSpecFile
          ? await (env.readFile ?? readFile)(opts.taskSpecFile, "utf8")
          : undefined;
        const body = omitUndefined<StartSessionRequest>({
          project_id: opts.project,
          workspace_id: opts.workspace,
          initial_message: initialMessage,
          task_spec: taskSpecRaw
            ? omitUndefined({
                ref: opts.taskSpecRef,
                title: opts.taskSpecTitle,
                intent: opts.taskSpecIntent,
                scope: opts.taskSpecScope,
                acceptance_criteria: opts.taskSpecAcceptance,
                raw: taskSpecRaw,
              })
            : taskSpecFromOptions(opts),
          codex_options: parseJsonOption(opts.codexOptions, "--codex-options"),
        });
        const result = await client(program, env).post("/sessions", body);
        printResult(env, opts, result, () =>
          formatSessionStarted(unwrapRecord(result, "session")),
        );
      }),
    );

  jsonOption(session.command("inspect").description("Inspect a session"))
    .argument("<session-id>", SESSION_REF_DESCRIPTION)
    .action((sessionId: string, opts: BaseCommandOptions) =>
      runAction(env, opts, async () => {
        const result = await client(program, env).get(
          `/sessions/${encodeURIComponent(sessionId)}`,
        );
        printResult(env, opts, result, () =>
          formatSessionInspectResult(result),
        );
      }),
    );

  jsonOption(
    session.command("latest").description("Print the latest agent message"),
  )
    .argument("<session-id>", SESSION_REF_DESCRIPTION)
    .option("--type <type>", "Item type filter")
    .action((sessionId: string, opts: SessionLatestOptions) =>
      runAction(env, opts, async () => {
        const result = await client(program, env).get(
          `/sessions/${encodeURIComponent(sessionId)}/latest`,
          {
            query: omitQuery({ type: parseOptionalItemType(opts.type) }),
          },
        );
        printResult(env, opts, result, () => formatLatest(result));
      }),
    );

  jsonOption(
    session
      .command("result")
      .description("Print a compact result for the latest agent message"),
  )
    .argument("<session-id>", SESSION_REF_DESCRIPTION)
    .option("--type <type>", "Item type filter")
    .action((sessionId: string, opts: SessionLatestOptions) =>
      runAction(env, opts, async () => {
        const result = await client(program, env).get(
          `/sessions/${encodeURIComponent(sessionId)}/latest`,
          {
            query: omitQuery({ type: parseOptionalItemType(opts.type) }),
          },
        );
        printResult(env, opts, result, () => formatLatest(result));
      }),
    );

  jsonOption(session.command("trace").description("Print a readable trace"))
    .argument("<session-id>", SESSION_REF_DESCRIPTION)
    .option("--type <type>", "Item type filter", "all")
    .option(
      "--limit <n>",
      "Maximum number of transcript entries",
      parsePositiveInt,
      20,
    )
    .option(
      "--recent",
      "Read the latest transcript window (default without cursor or sequence filters)",
    )
    .option("--cursor <cursor>", "Page cursor from non-recent pagination")
    .option(
      "--after-sequence <n>",
      "Only entries after this sequence; disables the default recent window",
      parseNonNegativeInt,
    )
    .option(
      "--before-sequence <n>",
      "Only entries before this sequence; disables the default recent window",
      parseNonNegativeInt,
    )
    .option(
      "--no-recent",
      "Read forward from the beginning and allow cursor pagination",
    )
    .action((sessionId: string, opts: SessionTraceOptions) =>
      runAction(env, opts, async () => {
        const api = client(program, env);
        if (usesFilteredItemTrace(opts)) {
          const [messages, items] = await Promise.all([
            api.get(`/sessions/${encodeURIComponent(sessionId)}/messages`),
            api.get(`/sessions/${encodeURIComponent(sessionId)}/items`, {
              query: omitQuery<ItemListQuery>({
                type: parseOptionalItemType(opts.type),
                limit: opts.limit,
                cursor: opts.cursor,
                after_sequence: opts.afterSequence,
                before_sequence: opts.beforeSequence,
                recent: traceRecentQuery(opts),
              }),
            }),
          ]);
          const result = {
            session_id: sessionIdFromResponses(sessionId, items, messages),
            messages,
            items,
          };
          printResult(env, opts, result, () => formatTrace(messages, items));
          return;
        }

        parseOptionalItemType(opts.type);
        const result = await api.get(
          `/sessions/${encodeURIComponent(sessionId)}/transcript`,
          {
            query: omitQuery<TranscriptListQuery>({
              limit: opts.limit,
              cursor: opts.cursor,
              after_sequence: opts.afterSequence,
              before_sequence: opts.beforeSequence,
              recent: traceRecentQuery(opts),
            }),
          },
        );
        const traceResult = transcriptResult(sessionId, result);
        printResult(env, opts, traceResult, () =>
          formatTranscript(traceResult),
        );
      }),
    );

  jsonOption(
    session
      .command("watch")
      .description("Print the latest readable trace window"),
  )
    .argument("<session-id>", SESSION_REF_DESCRIPTION)
    .option("--type <type>", "Item type filter", "all")
    .option(
      "--limit <n>",
      "Maximum number of transcript entries",
      parsePositiveInt,
      20,
    )
    .option(
      "--after-sequence <n>",
      "Only items after this sequence",
      parseNonNegativeInt,
    )
    .action((sessionId: string, opts: SessionTraceOptions) =>
      runAction(env, opts, async () => {
        const api = client(program, env);
        const [sessionDetail, trace] = await Promise.all([
          api.get(`/sessions/${encodeURIComponent(sessionId)}`),
          usesFilteredItemTrace(opts)
            ? Promise.all([
                api.get(`/sessions/${encodeURIComponent(sessionId)}/messages`),
                api.get(`/sessions/${encodeURIComponent(sessionId)}/items`, {
                  query: omitQuery<ItemListQuery>({
                    type: parseOptionalItemType(opts.type),
                    limit: opts.limit,
                    after_sequence: opts.afterSequence,
                    recent: opts.afterSequence === undefined,
                  }),
                }),
              ]).then(([messages, items]) => ({
                session_id: sessionIdFromResponses(sessionId, items, messages),
                messages,
                items,
              }))
            : api.get(`/sessions/${encodeURIComponent(sessionId)}/transcript`, {
                query: omitQuery<TranscriptListQuery>({
                  limit: opts.limit,
                  after_sequence: opts.afterSequence,
                  recent: opts.afterSequence === undefined,
                }),
              }),
        ]);
        const sessionRecord = unwrapRecord(sessionDetail, "session");
        const traceRecord = asRecord(trace);
        const result = usesFilteredItemTrace(opts)
          ? {
              session_id: sessionIdFromResponses(
                sessionId,
                traceRecord,
                sessionRecord,
              ),
              session: sessionRecord,
              messages: traceRecord?.messages,
              items: traceRecord?.items,
            }
          : transcriptResult(sessionId, trace, sessionRecord);
        printResult(env, opts, result, () => {
          const traceText = usesFilteredItemTrace(opts)
            ? formatTrace(result.messages, result.items)
            : formatTranscript(result);
          return [formatSessionInspect(sessionRecord), "", traceText].join(
            "\n",
          );
        });
      }),
    );

  jsonOption(session.command("items").description("List session items"))
    .argument("<session-id>", SESSION_REF_DESCRIPTION)
    .option("--type <type>", "Item type filter")
    .option("--limit <n>", "Maximum number of items", parsePositiveInt)
    .option("--cursor <cursor>", "Page cursor")
    .option(
      "--after-sequence <n>",
      "Only items after this sequence",
      parseNonNegativeInt,
    )
    .option(
      "--before-sequence <n>",
      "Only items before this sequence",
      parseNonNegativeInt,
    )
    .option("--recent", "Read the latest matching items")
    .action((sessionId: string, opts: SessionItemsOptions) =>
      runAction(env, opts, async () => {
        const result = await client(program, env).get(
          `/sessions/${encodeURIComponent(sessionId)}/items`,
          {
            query: omitQuery<ItemListQuery>({
              type: parseOptionalItemType(opts.type),
              limit: opts.limit,
              cursor: opts.cursor,
              after_sequence: opts.afterSequence,
              before_sequence: opts.beforeSequence,
              recent: opts.recent,
            }),
          },
        );
        printResult(env, opts, result, () => formatItems(result));
      }),
    );

  jsonOption(session.command("send").description("Send a follow-up message"))
    .argument("<session-id>", SESSION_REF_DESCRIPTION)
    .argument("[message...]", "Message content")
    .option("-m, --message <text>", "Message content")
    .option("--file <path>", "Read message content from a file")
    .option("--mode <steer|continue>", "Message mode", "steer")
    .option("--sender <manager_agent|human|system>", "Sender type", "human")
    .option("--sender-id <id>", "Sender ID")
    .action(
      (sessionId: string, messageParts: string[], opts: SessionSendOptions) =>
        runAction(env, opts, async () => {
          const content = await readContent(
            env,
            [opts.message],
            opts.file,
            messageParts,
          );
          if (!content || content.trim() === "")
            throw new Error("message content is required");

          const body = omitUndefined<SendMessageRequest>({
            mode: parseMessageMode(opts.mode),
            content,
            sender_type: parseSenderType(opts.sender),
            sender_id: opts.senderId,
          });
          const result = await client(program, env).post(
            `/sessions/${encodeURIComponent(sessionId)}/messages`,
            body,
          );
          printResult(env, opts, result, () =>
            formatMessageQueued(unwrapRecord(result, "message")),
          );
        }),
    );

  const reviewStatus = new Command("review-status").description(
    "Inspect or update review-gate status metadata",
  );
  jsonOption(reviewStatus.command("get").description("Get review status"))
    .argument("<session-id>", SESSION_REF_DESCRIPTION)
    .action((sessionId: string, opts: BaseCommandOptions) =>
      runAction(env, opts, async () => {
        const result = await client(program, env).get(
          `/sessions/${encodeURIComponent(sessionId)}/review-status`,
        );
        printResult(env, opts, result, () => formatReviewStatus(result));
      }),
    );
  jsonOption(reviewStatus.command("set").description("Set review status"))
    .argument("<session-id>", SESSION_REF_DESCRIPTION)
    .option("--implementation-done", "Implementation pass is done")
    .option("--self-validation-done", "Worker ran its own validation")
    .option("--review-requested", "Review subagent has been requested")
    .option("--review-addressed", "Review findings have been addressed")
    .option("--ready-for-human-review", "Ready for human review")
    .option("--note <text>", "Short review status note")
    .action((sessionId: string, opts: ReviewStatusSetOptions) =>
      runAction(env, opts, async () => {
        const body = omitUndefined<UpdateReviewGateStatusRequest>({
          implementation_done: opts.implementationDone,
          self_validation_done: opts.selfValidationDone,
          review_requested: opts.reviewRequested,
          review_addressed: opts.reviewAddressed,
          ready_for_human_review: opts.readyForHumanReview,
          note: opts.note,
        });
        const result = await client(program, env).put(
          `/sessions/${encodeURIComponent(sessionId)}/review-status`,
          body,
        );
        printResult(env, opts, result, () => formatReviewStatus(result));
      }),
    );
  session.addCommand(reviewStatus);

  jsonOption(session.command("stop").description("Stop a session"))
    .argument("<session-id>", SESSION_REF_DESCRIPTION)
    .action((sessionId: string, opts: BaseCommandOptions) =>
      runAction(env, opts, async () => {
        const result = await client(program, env).post(
          `/sessions/${encodeURIComponent(sessionId)}/stop`,
          {},
        );
        printResult(env, opts, result, () =>
          formatSessionStopped(unwrapRecord(result, "session"), sessionId),
        );
      }),
    );
  program.addCommand(session);

  const sessions = new Command("sessions").description(
    "Manage worker sessions",
  );
  jsonOption(sessions.command("list").description("List sessions"))
    .option("--project <id>", "Project ID filter")
    .option("--workspace <id>", "Workspace ID filter")
    .option("--status <status>", "Session status filter")
    .option("--limit <n>", "Maximum number of sessions", parsePositiveInt)
    .option("--cursor <cursor>", "Page cursor")
    .action((opts: SessionsListOptions) =>
      runAction(env, opts, async () => {
        const result = await client(program, env).get("/sessions", {
          query: omitQuery<SessionListQuery>({
            project_id: opts.project,
            workspace_id: opts.workspace,
            status: parseOptionalSessionStatus(opts.status),
            limit: opts.limit,
            cursor: opts.cursor,
          }),
        });
        printResult(env, opts, result, () => formatSessions(result));
      }),
    );
  jsonOption(sessions.command("recent").description("List recent sessions"))
    .option("--project <id>", "Project ID filter")
    .option("--workspace <id>", "Workspace ID filter")
    .option("--status <status>", "Session status filter")
    .option("--limit <n>", "Maximum number of sessions", parsePositiveInt, 10)
    .option("--cursor <cursor>", "Page cursor")
    .action((opts: SessionsListOptions) =>
      runAction(env, opts, async () => {
        const result = await client(program, env).get("/sessions", {
          query: omitQuery<SessionListQuery>({
            project_id: opts.project,
            workspace_id: opts.workspace,
            status: parseOptionalSessionStatus(opts.status),
            limit: opts.limit,
            cursor: opts.cursor,
          }),
        });
        printResult(env, opts, result, () => formatSessions(result));
      }),
    );
  program.addCommand(sessions);

  return program;
}

export async function runCli(
  argv: string[],
  env: CliEnvironment = {},
): Promise<void> {
  await createProgram(env).parseAsync(argv);
}

function client(program: Command, env: CliEnvironment): ApiClient {
  return new ApiClient(program.opts<{ api: string }>().api, env.fetch);
}

function jsonOption(command: Command): Command {
  return command.option("--json", "Print JSON");
}

async function runAction(
  env: CliEnvironment,
  opts: BaseCommandOptions,
  action: () => Promise<void>,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    writeError(env, opts, error);
    setExitCode(env, 1);
  }
}

function printResult(
  env: CliEnvironment,
  opts: BaseCommandOptions,
  result: unknown,
  human: () => string,
): void {
  if (opts.json) {
    writeLine(env, JSON.stringify(result ?? null, null, 2));
    return;
  }

  writeLine(env, human());
}

function writeError(
  env: CliEnvironment,
  opts: BaseCommandOptions,
  error: unknown,
): void {
  const message = error instanceof Error ? error.message : String(error);
  if (opts.json) {
    const details =
      error instanceof ApiError ? apiErrorDetails(error.responseBody) : {};
    const body =
      error instanceof ApiError
        ? omitUndefined({
            error: details.message ?? message,
            code: details.code,
            status: error.status,
            candidate_ids: details.candidate_ids,
            response: error.responseBody,
          })
        : { error: message };
    writeLine(env, JSON.stringify(body, null, 2), "stderr");
    return;
  }

  writeLine(env, `Error: ${message}`, "stderr");
}

function writeLine(
  env: CliEnvironment,
  text: string,
  stream: "stdout" | "stderr" = "stdout",
): void {
  const writer = stream === "stdout" ? env.stdout : env.stderr;
  (writer ?? defaultWriter(stream))(`${text}\n`);
}

function defaultWriter(stream: "stdout" | "stderr"): WriteFn {
  return stream === "stdout"
    ? process.stdout.write.bind(process.stdout)
    : process.stderr.write.bind(process.stderr);
}

function setExitCode(env: CliEnvironment, code: number): void {
  if (env.setExitCode) {
    env.setExitCode(code);
    return;
  }

  process.exitCode = code;
}

function omitUndefined<T extends object>(value: T): JsonObject {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as JsonObject;
}

function omitQuery<T extends object>(
  value: T,
): Record<string, string | number | boolean | null | undefined> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Record<string, string | number | boolean | null | undefined>;
}

function apiErrorDetails(value: unknown): {
  code?: string;
  message?: string;
  candidate_ids?: string[];
} {
  const record = asRecord(value);
  const error = asRecord(record?.error);
  if (!error) {
    return typeof record?.error === "string" ? { message: record.error } : {};
  }

  const candidateIds = error.candidate_ids;
  const details: {
    code?: string;
    message?: string;
    candidate_ids?: string[];
  } = {};
  const code = stringField(error, "code");
  const message = stringField(error, "message");
  if (code) details.code = code;
  if (message) details.message = message;
  if (Array.isArray(candidateIds)) {
    details.candidate_ids = candidateIds.filter(
      (candidate): candidate is string => typeof candidate === "string",
    );
  }
  return details;
}

function parseJsonOption(
  value: string | undefined,
  optionName: string,
): unknown {
  if (value === undefined) return undefined;

  try {
    return JSON.parse(value);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${optionName} must be valid JSON: ${detail}`, {
      cause: error,
    });
  }
}

function taskSpecFromOptions(
  opts: SessionStartOptions,
): JsonObject | undefined {
  const taskSpec = omitUndefined({
    ref: opts.taskSpecRef,
    title: opts.taskSpecTitle,
    intent: opts.taskSpecIntent,
    scope: opts.taskSpecScope,
    acceptance_criteria: opts.taskSpecAcceptance,
  });
  return Object.keys(taskSpec).length > 0 ? taskSpec : undefined;
}

function parsePositiveInt(value: string): number {
  return parseInteger(value, 1);
}

function parseNonNegativeInt(value: string): number {
  return parseInteger(value, 0);
}

function parseInteger(value: string, min: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new InvalidArgumentError(`expected an integer >= ${min}`);
  }

  return parsed;
}

function parseWorkspaceSource(value: string): "local" | "git" {
  if (value === "local" || value === "git") return value;
  throw new Error("--source must be local or git");
}

function parseWorkspaceMode(
  value: string | undefined,
): "standard" | "worktree" | undefined {
  if (value === undefined || value === "standard") return undefined;
  if (value === "worktree") return value;
  throw new Error("--mode must be standard or worktree");
}

function parseMessageMode(value: string): MessageMode {
  if (value === "steer" || value === "continue") return value;
  throw new Error("--mode must be steer or continue");
}

function parseSenderType(value: string): SenderType {
  if (value === "manager_agent" || value === "human" || value === "system")
    return value;
  throw new Error("--sender must be manager_agent, human, or system");
}

function parseOptionalItemType(
  value: string | undefined,
): ItemType | "all" | undefined {
  if (value === undefined) return undefined;
  if (
    value === "all" ||
    value === "agentmessage" ||
    value === "toolcall" ||
    value === "toolresult" ||
    value === "error" ||
    value === "state" ||
    value === "reasoning" ||
    value === "raw"
  ) {
    return value;
  }
  throw new Error("--type is not a supported item type");
}

function parseOptionalSessionStatus(
  value: string | undefined,
): WorkerSessionStatus | undefined {
  if (value === undefined) return undefined;
  if (
    value === "starting" ||
    value === "running" ||
    value === "awaiting_input" ||
    value === "completed" ||
    value === "failed" ||
    value === "stopped"
  ) {
    return value;
  }
  throw new Error("--status is not a supported session status");
}

function usesFilteredItemTrace(opts: SessionTraceOptions): boolean {
  const type = parseOptionalItemType(opts.type);
  return type !== undefined && type !== "all";
}

function traceRecentQuery(opts: SessionTraceOptions): boolean | undefined {
  if (
    opts.afterSequence !== undefined ||
    opts.beforeSequence !== undefined ||
    opts.cursor !== undefined
  ) {
    return undefined;
  }

  return opts.recent !== false;
}

async function readContent(
  env: CliEnvironment,
  optionValues: Array<string | undefined>,
  file: string | undefined,
  parts: string[],
): Promise<string | undefined> {
  const values = optionValues.filter(
    (value): value is string => value !== undefined,
  );
  if (file) {
    values.push(await (env.readFile ?? readFile)(file, "utf8"));
  }
  if (parts.length > 0) {
    values.push(parts.join(" "));
  }

  if (values.length > 1) throw new Error("provide message content only once");
  const value = values[0];
  return value === undefined ? undefined : value.trimEnd();
}

function formatCreated(
  label: string,
  record: Record<string, unknown> | null,
  detailField: string,
): string {
  const id = stringField(record, "id") ?? "(unknown id)";
  const detail = stringField(record, detailField);
  return detail
    ? `${label} ${id} created: ${detail}`
    : `${label} ${id} created`;
}

function formatSessionStarted(record: Record<string, unknown> | null): string {
  const id = stringField(record, "id") ?? "(unknown id)";
  const status = stringField(record, "status");
  return status ? `Session ${id} started: ${status}` : `Session ${id} started`;
}

function formatSessionStopped(
  record: Record<string, unknown> | null,
  fallbackId: string,
): string {
  const id = stringField(record, "id") ?? fallbackId;
  const status = stringField(record, "status");
  return status ? `Session ${id} ${status}` : `Session ${id} stopped`;
}

function formatWorkspaceCleanup(
  record: Record<string, unknown> | null,
  result: unknown,
): string {
  const id = stringField(record, "id") ?? "(unknown id)";
  const status = stringField(record, "status") ?? "unknown";
  const cleanup = unwrapRecord(result, "cleanup");
  const deletedFiles =
    cleanup?.deleted_files === true ? "files deleted" : "files preserved";
  return `Workspace ${id} ${status}; ${deletedFiles}`;
}

function formatRunGroup(record: Record<string, unknown> | null): string {
  if (!record) return "Run group not found.";
  const id = stringField(record, "id") ?? "(unknown id)";
  const name = stringField(record, "name") ?? "(unnamed)";
  const purpose = stringField(record, "purpose");
  return purpose ? `${id} ${name} - ${purpose}` : `${id} ${name}`;
}

function formatMessageQueued(record: Record<string, unknown> | null): string {
  const id = stringField(record, "id") ?? "(unknown id)";
  const status = stringField(record, "status");
  return status ? `Message ${id} ${status}` : `Message ${id} queued`;
}

function formatReviewStatus(value: unknown): string {
  const record = unwrapRecord(value, "review_status");
  if (!record) return "No review status.";
  const flags = [
    "implementation_done",
    "self_validation_done",
    "review_requested",
    "review_addressed",
    "ready_for_human_review",
  ]
    .map((field) => `${field}=${record[field] === true ? "yes" : "no"}`)
    .join(" ");
  const note = stringField(record, "note");
  return note ? `${flags}\nnote: ${note}` : flags;
}

function formatSessionInspectResult(value: unknown): string {
  const sessionText = formatSessionInspect(unwrapRecord(value, "session"));
  const taskSpec = unwrapRecord(value, "task_spec");
  if (!taskSpec) return sessionText;
  const details = [
    stringField(taskSpec, "title"),
    stringField(taskSpec, "ref"),
  ].filter((entry): entry is string => Boolean(entry));
  return details.length > 0
    ? `${sessionText}\nTask spec: ${details.join(" - ")}`
    : `${sessionText}\nTask spec: attached`;
}

function formatSessionInspect(record: Record<string, unknown> | null): string {
  if (!record) return "Session not found.";

  const lines = [
    `Session ${stringField(record, "id") ?? "(unknown id)"}`,
    `Status: ${stringField(record, "status") ?? "unknown"}`,
    `Project: ${stringField(record, "project_id") ?? "unknown"}`,
    `Workspace: ${stringField(record, "workspace_id") ?? "unknown"}`,
  ];

  const sequence = numberField(record, "last_item_sequence");
  if (sequence !== null) lines.push(`Last item: ${sequence}`);

  const message = stringField(record, "last_agent_message");
  if (message) lines.push(`Latest: ${oneLine(message, 240)}`);

  const failure = stringField(record, "failure_reason");
  if (failure) lines.push(`Failure: ${oneLine(failure, 240)}`);

  return lines.join("\n");
}

function formatLatest(value: unknown): string {
  if (value === null || value === undefined) return "No agent message.";
  if (typeof value === "string") return value;

  const envelope = asRecord(value);
  const envelopeType = stringField(envelope, "type");
  const managerMessage =
    stringField(envelope, "last_agent_message") ??
    stringField(asRecord(envelope?.session), "last_agent_message");
  const itemRecord = asRecord(envelope?.item);
  const latestRecord = asRecord(envelope?.latest);
  if (
    managerMessage &&
    (envelopeType === null ||
      envelopeType === "agentmessage" ||
      isAgentMessageItem(itemRecord) ||
      isAgentMessageItem(latestRecord))
  ) {
    return managerMessage;
  }

  if (
    (envelopeType === "agentmessage" || envelopeType === "all") &&
    !managerMessage &&
    (isAgentMessageDelta(itemRecord) || isAgentMessageDelta(latestRecord))
  ) {
    return "No agent message.";
  }

  const sessionRecord = asRecord(envelope?.session);
  const record =
    itemRecord ??
    latestRecord ??
    (envelopeType === null || envelopeType === "agentmessage"
      ? (sessionRecord ?? envelope)
      : null);
  const text =
    stringField(record, "last_agent_message") ??
    stringField(record, "text_excerpt") ??
    stringField(record, "text") ??
    stringField(record, "content") ??
    stringField(record, "message");

  return text && text.trim() !== "" ? text : "No agent message.";
}

function formatItems(value: unknown): string {
  const items = extractItems(value, "items");
  if (items.length === 0) return "No items.";

  return items
    .map((item) => {
      const sequence = numberField(item, "sequence");
      const type = stringField(item, "type") ?? "raw";
      const created = stringField(item, "created_at");
      const text = stringField(item, "text_excerpt");
      return [
        sequence === null ? "?" : String(sequence),
        type,
        created,
        text ? oneLine(text, 160) : null,
      ]
        .filter(Boolean)
        .join(" ");
    })
    .join("\n");
}

function transcriptResult(
  sessionId: string,
  value: unknown,
  session?: Record<string, unknown> | null,
): Record<string, unknown> {
  const record = asRecord(value) ?? {};
  const result: Record<string, unknown> = {
    ...record,
    session_id: stringField(record, "session_id") ?? sessionId,
    transcript: extractItems(record, "transcript"),
  };
  if (session !== undefined) result.session = session;
  return result;
}

function sessionIdFromResponses(
  fallback: string,
  ...values: unknown[]
): string {
  for (const value of values) {
    const record = asRecord(value);
    const sessionId =
      stringField(record, "session_id") ??
      stringField(asRecord(record?.session), "id");
    if (sessionId) return sessionId;

    const id = stringField(record, "id");
    if (id?.startsWith("sess_")) return id;
  }
  return fallback;
}

function formatTrace(messagesValue: unknown, itemsValue: unknown): string {
  const messages = extractItems(messagesValue, "messages").map((message) => ({
    kind: "message" as const,
    created_at: stringField(message, "created_at") ?? "",
    mode: stringField(message, "mode") ?? "message",
    sender: stringField(message, "sender_type") ?? "unknown",
    id: stringField(message, "id") ?? "",
    text: stringField(message, "content") ?? "",
  }));
  const itemEntries = itemTraceEntries(extractItems(itemsValue, "items"));
  const entries = [...messages, ...itemEntries].sort((left, right) => {
    const byTime = left.created_at.localeCompare(right.created_at);
    if (byTime !== 0) return byTime;
    if (left.kind === right.kind) return 0;
    return left.kind === "message" ? -1 : 1;
  });

  if (entries.length === 0) return "No trace entries.";

  return entries
    .map((entry) => {
      if (entry.kind === "message") {
        return [
          `[input ${entry.mode} ${entry.sender} ${shortToken(entry.id)}]`,
          entry.text,
        ].join("\n");
      }

      if (entry.type === "agentmessage") {
        return [`[agent ${entry.sequenceLabel}]`, entry.text].join("\n");
      }

      return `[${entry.type} ${entry.sequenceLabel}] ${entry.summary}`;
    })
    .join("\n\n");
}

function formatTranscript(value: unknown): string {
  const entries = extractItems(value, "transcript");
  if (entries.length === 0) return "No trace entries.";

  return entries
    .map((entry) => {
      const kind = stringField(entry, "kind");
      if (kind === "message") {
        const mode = stringField(entry, "message_mode") ?? "message";
        const sender = stringField(entry, "sender_type") ?? "unknown";
        const sourceId = stringField(entry, "source_id") ?? "";
        return [
          `[input ${mode} ${sender} ${shortToken(sourceId)}]`,
          stringField(entry, "text") ?? "",
        ].join("\n");
      }

      if (kind === "agent_message") {
        return [
          `[agent ${transcriptSequenceLabel(entry)}]`,
          stringField(entry, "text") ?? "(empty agent message)",
        ].join("\n");
      }

      const type = stringField(entry, "item_type") ?? kind ?? "debug";
      return `[${type} ${transcriptSequenceLabel(entry)}] ${transcriptSummary(
        entry,
      )}`;
    })
    .join("\n\n");
}

function itemTraceEntries(items: Array<Record<string, unknown>>): Array<{
  kind: "item";
  created_at: string;
  type: string;
  sequenceLabel: string;
  text: string;
  summary: string;
}> {
  const entries: Array<{
    kind: "item";
    created_at: string;
    type: string;
    sequenceLabel: string;
    text: string;
    summary: string;
  }> = [];
  const consumed = new Set<string>();

  for (const item of items) {
    const id = stringField(item, "id") ?? "";
    if (id && consumed.has(id)) continue;

    const type = stringField(item, "type") ?? "raw";
    const sequence = numberField(item, "sequence");
    const created = stringField(item, "created_at") ?? "";
    if (type !== "agentmessage") {
      entries.push({
        kind: "item",
        created_at: created,
        type,
        sequenceLabel: sequence === null ? "?" : `#${sequence}`,
        text: "",
        summary: itemSummary(item),
      });
      continue;
    }

    const codexItemId = stringField(item, "codex_item_id");
    const group = codexItemId
      ? items.filter(
          (candidate) =>
            stringField(candidate, "type") === "agentmessage" &&
            stringField(candidate, "codex_item_id") === codexItemId,
        )
      : [item];
    for (const grouped of group) {
      const groupedId = stringField(grouped, "id");
      if (groupedId) consumed.add(groupedId);
    }

    const sequences = group
      .map((entry) => numberField(entry, "sequence"))
      .filter((entry): entry is number => entry !== null);
    const fullText =
      [...group]
        .reverse()
        .find(
          (entry) =>
            stringField(entry, "codex_method") !== "item/agentMessage/delta" &&
            stringField(entry, "text_excerpt"),
        ) ?? null;
    const text =
      stringField(fullText, "text_excerpt") ??
      group
        .map((entry) => stringField(entry, "text_excerpt") ?? "")
        .join("")
        .trim();

    entries.push({
      kind: "item",
      created_at: created,
      type,
      sequenceLabel: sequenceRange(sequences),
      text: text || "(empty agent message)",
      summary: text ? oneLine(text, 160) : "(empty agent message)",
    });
  }

  return entries;
}

function itemSummary(item: Record<string, unknown>): string {
  const text = stringField(item, "text_excerpt");
  if (text) return oneLine(text, 180);
  const method = stringField(item, "codex_method");
  const itemType = stringField(item, "codex_item_type");
  return (
    method ?? itemType ?? oneLine(JSON.stringify(item.raw_payload) ?? "", 180)
  );
}

function transcriptSummary(entry: Record<string, unknown>): string {
  const text = stringField(entry, "text");
  if (text) return oneLine(text, 180);
  return (
    stringField(entry, "codex_method") ??
    stringField(entry, "codex_item_type") ??
    "(no details)"
  );
}

function formatSessions(value: unknown): string {
  const sessions = extractItems(value, "sessions");
  if (sessions.length === 0) return "No sessions.";

  return sessions
    .map((session) => {
      const id = stringField(session, "id") ?? "(unknown id)";
      const status = stringField(session, "status") ?? "unknown";
      const workspace = stringField(session, "workspace_id");
      const latest = stringField(session, "last_agent_message");
      const base = workspace
        ? `${id} ${status} workspace=${workspace}`
        : `${id} ${status}`;
      return latest ? `${base} latest="${oneLine(latest, 120)}"` : base;
    })
    .join("\n");
}

function formatRunGroups(value: unknown): string {
  const runGroups = extractItems(value, "run_groups");
  if (runGroups.length === 0) return "No run groups.";
  return runGroups.map(formatRunGroup).join("\n");
}

function extractItems(
  value: unknown,
  envelopeKey: string,
): Array<Record<string, unknown>> {
  if (Array.isArray(value))
    return value
      .map(asRecord)
      .filter((entry): entry is Record<string, unknown> => entry !== null);

  const record = asRecord(value);
  const candidates =
    envelopeKey === "items"
      ? [record?.items]
      : [record?.[envelopeKey], record?.items];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate
        .map(asRecord)
        .filter((entry): entry is Record<string, unknown> => entry !== null);
    }
  }

  return [];
}

function unwrapRecord(
  value: unknown,
  envelopeKey: string,
): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) return null;

  return asRecord(record[envelopeKey]) ?? record;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(
  record: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = record?.[key];
  return typeof value === "string" ? value : null;
}

function numberField(
  record: Record<string, unknown> | null,
  key: string,
): number | null {
  const value = record?.[key];
  return typeof value === "number" ? value : null;
}

function numberArrayField(
  record: Record<string, unknown> | null,
  key: string,
): number[] {
  const value = record?.[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is number => typeof entry === "number")
    : [];
}

function isAgentMessageDelta(record: Record<string, unknown> | null): boolean {
  return stringField(record, "codex_method") === "item/agentMessage/delta";
}

function isAgentMessageItem(record: Record<string, unknown> | null): boolean {
  return stringField(record, "type") === "agentmessage";
}

function oneLine(value: string, maxLength: number): string {
  const line = value.replace(/\s+/g, " ").trim();
  if (line.length <= maxLength) return line;
  return `${line.slice(0, maxLength - 3)}...`;
}

function shortToken(value: string): string {
  return value.length > 10 ? value.slice(0, 10) : value || "-";
}

function sequenceRange(values: number[]): string {
  if (values.length === 0) return "#?";
  const first = Math.min(...values);
  const last = Math.max(...values);
  return first === last ? `#${first}` : `#${first}-#${last}`;
}

function transcriptSequenceLabel(entry: Record<string, unknown>): string {
  const itemSequences = numberArrayField(entry, "item_sequences");
  if (itemSequences.length > 0) return sequenceRange(itemSequences);

  const sequence = numberField(entry, "sequence");
  return sequence === null ? "#?" : `#${sequence}`;
}
