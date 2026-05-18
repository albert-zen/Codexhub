import { spawnSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { WorkerSessionStatus, Workspace } from "@codexhub/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/database.js";
import { HubRepository } from "../src/repository.js";
import {
  codexWorkerEnvironment,
  defaultWorkspaceSandboxPolicy,
} from "../src/runtime.js";
import { createServer } from "../src/server.js";

type App = Awaited<ReturnType<typeof createServer>>;

let app: App;
let tempDir: string;

beforeEach(async () => {
  tempDir = await realpath(await mkdtemp(join(tmpdir(), "codexhub-server-")));
  app = await createServer({ dbPath: ":memory:", logger: false });
});

afterEach(async () => {
  await app.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("Codexhub API", () => {
  it("supports /api/v1 as canonical routes and root routes as local aliases", async () => {
    const canonical = await post("/api/v1/projects", { name: "canonical" });
    const alias = await post("/projects", { name: "alias" });

    expect(canonical.project.name).toBe("canonical");
    expect(alias.project.name).toBe("alias");

    const canonicalList = await get("/api/v1/projects");
    const aliasList = await get("/projects");
    expect(canonicalList.items).toHaveLength(2);
    expect(aliasList.items).toHaveLength(2);
  });

  it("runs the minimum fake worker control loop", async () => {
    const project = await post("/api/v1/projects", {
      name: "demo",
      default_workspace_root: tempDir,
    });
    const projectId = project.project.id;

    const workspacePath = join(tempDir, "demo-workspace");
    const workspace = await post("/api/v1/workspaces", {
      project_id: projectId,
      source_type: "local",
      path: workspacePath,
    });

    const started = await post("/api/v1/sessions", {
      workspace_id: workspace.workspace.id,
      initial_message: "Inspect this repo and report status.",
      task_spec: {
        ref: "docs/task-specs/demo.md",
        title: "Inspect demo workspace",
        intent: "Verify task spec metadata persistence.",
        acceptance_criteria: "Session detail returns task_spec.",
      },
      codex_options: { fake: true },
    });
    const sessionId = started.session.id;

    expect(started.session.status).toBe("awaiting_input");
    expect(started.session.last_agent_message).toContain("Inspect this repo");

    const inspected = await get(`/api/v1/sessions/${sessionId}`);
    expect(inspected.task_spec).toMatchObject({
      ref: "docs/task-specs/demo.md",
      title: "Inspect demo workspace",
      intent: "Verify task spec metadata persistence.",
      acceptance_criteria: "Session detail returns task_spec.",
    });

    const runGroup = await post("/api/v1/run-groups", {
      name: "parallel-demo",
      project_id: projectId,
      purpose: "Observe a batch of workers.",
    });
    expect(runGroup.run_group.name).toBe("parallel-demo");

    const runGroupMembership = await post(
      `/api/v1/run-groups/${runGroup.run_group.id}/sessions`,
      { session_id: sessionId },
    );
    expect(runGroupMembership.sessions).toHaveLength(1);
    expect(runGroupMembership.sessions[0].id).toBe(sessionId);

    const runGroupSessions = await get(
      `/api/v1/run-groups/${runGroup.run_group.id}/sessions`,
    );
    expect(runGroupSessions.sessions[0].id).toBe(sessionId);

    const latest = await get(`/api/v1/sessions/${sessionId}/items/latest`);
    expect(latest.item.type).toBe("agentmessage");
    expect(latest.item.raw_payload.method).toBe("item/completed");

    const agentItems = await get(`/api/v1/sessions/${sessionId}/items`);
    expect(agentItems.items).toHaveLength(1);
    expect(agentItems.type).toBe("agentmessage");

    const transcript = await get(`/api/v1/sessions/${sessionId}/transcript`);
    expect(transcript.session_id).toBe(sessionId);
    expect(
      transcript.transcript.map((entry: { kind: string }) => entry.kind),
    ).toEqual(["message", "agent_message", "debug"]);
    expect(transcript.transcript[1].text).toContain("Inspect this repo");

    const stateItems = await get(
      `/api/v1/sessions/${sessionId}/items?type=state`,
    );
    expect(stateItems.items[0].codex_method).toBe("turn/completed");

    const firstPage = await get(
      `/api/v1/sessions/${sessionId}/items?type=all&limit=1`,
    );
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.next_cursor).toBe("1");
    const secondPage = await get(
      `/api/v1/sessions/${sessionId}/items?type=all&after=${firstPage.next_cursor}`,
    );
    expect(secondPage.items[0].sequence).toBe(2);

    const emptyContinue = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sessionId}/messages`,
      payload: {
        mode: "continue",
        content: "",
        sender_type: "manager_agent",
      },
    });
    expect(emptyContinue.statusCode).toBe(400);
    expect(emptyContinue.json().error.code).toBe("message_required");

    const continued = await post(`/api/v1/sessions/${sessionId}/messages`, {
      mode: "continue",
      content: "Please continue.",
      sender_type: "manager_agent",
    });
    expect(continued.message.status).toBe("sent");
    expect(continued.message.content).toBe("Please continue.");
    expect(continued.session.status).toBe("awaiting_input");

    const initialReviewStatus = await get(
      `/api/v1/sessions/${sessionId}/review-status`,
    );
    expect(initialReviewStatus.review_status.implementation_done).toBe(false);

    const reviewStatus = await put(
      `/api/v1/sessions/${sessionId}/review-status`,
      {
        implementation_done: true,
        self_validation_done: true,
        review_requested: true,
        note: "Worker is ready for review.",
      },
    );
    expect(reviewStatus.review_status).toMatchObject({
      implementation_done: true,
      self_validation_done: true,
      review_requested: true,
      review_addressed: false,
      ready_for_human_review: false,
      note: "Worker is ready for review.",
    });

    const invalidReviewStatus = await app.inject({
      method: "PUT",
      url: `/api/v1/sessions/${sessionId}/review-status`,
      payload: { implementation_done: "yes" },
    });
    expect(invalidReviewStatus.statusCode).toBe(400);
    expect(invalidReviewStatus.json().error.code).toBe("invalid_review_status");
  });

  it("returns complete transcript entries across raw item page boundaries", async () => {
    const dbPath = join(tempDir, "transcript.sqlite");
    const database = openDatabase({ path: dbPath });
    const repo = new HubRepository(database.db);
    const project = repo.createProject({ name: "transcript-demo" });
    const workspace = repo.createWorkspace({
      project_id: project.id,
      source_type: "local",
      path: join(tempDir, "transcript-workspace"),
      cwd: join(tempDir, "transcript-workspace"),
    });
    const session = repo.createSession({
      project_id: project.id,
      workspace_id: workspace.id,
    });
    const message = repo.createMessage({
      session_id: session.id,
      mode: "initial",
      content: "Summarize the repo.",
      sender_type: "manager_agent",
    });
    repo.markMessageSent(message.id, "req_1");

    const expectedText = Array.from(
      { length: 25 },
      (_, index) => `part-${index + 1} `,
    ).join("");
    for (const textDelta of Array.from(
      { length: 25 },
      (_, index) => `part-${index + 1} `,
    )) {
      repo.appendItem(session.id, {
        method: "item/agentMessage/delta",
        params: {
          itemId: "agent_1",
          textDelta,
        },
      });
    }
    repo.appendItem(session.id, {
      method: "item/tool/call",
      params: {
        item: {
          id: "tool_1",
          type: "mcpToolCall",
          tool: "list_issues",
        },
      },
    });
    database.close();

    const seeded = await createServer({ dbPath, logger: false });
    try {
      const firstPage = await getFrom(
        seeded,
        `/api/v1/sessions/${session.id}/transcript?limit=2`,
      );
      expect(firstPage.transcript).toHaveLength(2);
      expect(firstPage.next_cursor).toBe("2");
      expect(firstPage.transcript[0]).toMatchObject({
        kind: "message",
        text: "Summarize the repo.",
      });
      expect(firstPage.transcript[1]).toMatchObject({
        kind: "agent_message",
        text: expectedText,
        item_sequences: Array.from({ length: 25 }, (_, index) => index + 1),
      });

      const secondPage = await getFrom(
        seeded,
        `/api/v1/sessions/${session.id}/transcript?cursor=${firstPage.next_cursor}&limit=2`,
      );
      expect(
        secondPage.transcript.map((entry: { kind: string }) => entry.kind),
      ).toEqual(["tool"]);

      const latest = await getFrom(
        seeded,
        `/api/v1/sessions/${session.id}/transcript?limit=2&recent=true`,
      );
      expect(
        latest.transcript.map((entry: { kind: string }) => entry.kind),
      ).toEqual(["agent_message", "tool"]);
      expect(latest.next_cursor).toBeNull();

      const rawItems = await getFrom(
        seeded,
        `/api/v1/sessions/${session.id}/items?type=all&limit=20`,
      );
      expect(rawItems.items).toHaveLength(20);
      expect(rawItems.next_cursor).toBe("20");
      expect(rawItems.items[0].raw_payload.params.textDelta).toBe("part-1 ");
    } finally {
      await seeded.close();
    }
  });

  it("rejects cwd paths outside the workspace", async () => {
    const project = await post("/api/v1/projects", {
      name: "demo",
      default_workspace_root: tempDir,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/workspaces",
      payload: {
        project_id: project.project.id,
        source_type: "local",
        path: join(tempDir, "workspace"),
        cwd: join(tempDir, "..", "outside"),
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("workspace_build_failed");
  });

  it("creates git worktree workspaces with isolated branches and writable commit metadata", async () => {
    const project = await post("/api/v1/projects", {
      name: "worktree-demo",
      default_workspace_root: tempDir,
    });
    const repoPath = join(tempDir, "source repo");
    await initGitRepo(repoPath);

    const worktreePath = join(tempDir, "worker one");
    const workspace = await post("/api/v1/workspaces", {
      project_id: project.project.id,
      source_type: "git",
      mode: "worktree",
      repo_path: repoPath,
      path: worktreePath,
      branch: "codexhub/worktree-one",
    });

    expect(workspace.workspace.source_type).toBe("git");
    expect(workspace.workspace.repo_url).toBe(await realpath(repoPath));
    expect(workspace.workspace.path).toBe(await realpath(worktreePath));
    expect(workspace.workspace.branch).toBe("codexhub/worktree-one");
    await expect(access(join(worktreePath, ".git"))).resolves.toBeUndefined();

    const sandboxPolicy = defaultWorkspaceSandboxPolicy(workspace.workspace);
    expect(sandboxPolicy.writableRoots).toEqual(
      expect.arrayContaining([
        await realpath(worktreePath),
        await realpath(join(repoPath, ".git")),
      ]),
    );

    const workerEnv = codexWorkerEnvironment(workspace.workspace, {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "user.email",
      GIT_CONFIG_VALUE_0: "existing@example.test",
    });
    expect(workerEnv.GIT_CONFIG_COUNT).toBe("2");
    expect(workerEnv.GIT_CONFIG_KEY_1).toBe("safe.directory");
    expect(workerEnv.GIT_CONFIG_VALUE_1).toBe(await realpath(worktreePath));
    expect(
      gitOutput(["-C", worktreePath, "status", "--short"], workerEnv),
    ).toBe("");

    await writeFile(
      join(worktreePath, "worker.txt"),
      "worker change\n",
      "utf8",
    );
    runGit(["-C", worktreePath, "add", "worker.txt"]);
    runGit([
      "-C",
      worktreePath,
      "-c",
      "user.name=Codexhub Test",
      "-c",
      "user.email=codexhub@example.test",
      "commit",
      "-m",
      "worker commit",
    ]);
    expect(gitOutput(["-C", worktreePath, "log", "-1", "--pretty=%s"])).toBe(
      "worker commit",
    );

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/workspaces",
      payload: {
        project_id: project.project.id,
        source_type: "git",
        mode: "worktree",
        repo_path: repoPath,
        path: join(tempDir, "worker two"),
        branch: "codexhub/worktree-one",
      },
    });
    expect(duplicate.statusCode).toBe(400);
    expect(duplicate.json().error.code).toBe("workspace_build_failed");
  });

  it("does not grant source git metadata writes for non-worktree .git indirection", async () => {
    const repoPath = join(tempDir, "source repo");
    await initGitRepo(repoPath);
    const workspacePath = join(tempDir, "not a worktree");
    await mkdir(workspacePath);
    await writeFile(
      join(workspacePath, ".git"),
      `gitdir: ${join(repoPath, ".git")}\n`,
      "utf8",
    );

    const sandboxPolicy = defaultWorkspaceSandboxPolicy({
      id: "work_fake",
      project_id: "proj_fake",
      source_type: "git",
      repo_url: repoPath,
      path: workspacePath,
      cwd: workspacePath,
      branch: null,
      commit_sha: null,
      status: "ready",
      last_error: null,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
    } satisfies Workspace);

    expect(sandboxPolicy.writableRoots).toEqual([
      await realpath(workspacePath),
    ]);
  });

  it("does not grant source git metadata writes when gitdir is outside commondir", async () => {
    const repoPath = join(tempDir, "source repo");
    await initGitRepo(repoPath);
    const workspacePath = join(tempDir, "crafted workspace");
    const outsideGitDir = join(tempDir, "outside git metadata");
    await mkdir(workspacePath);
    await mkdir(outsideGitDir);
    await writeFile(
      join(workspacePath, ".git"),
      `gitdir: ${outsideGitDir}\n`,
      "utf8",
    );
    await writeFile(
      join(outsideGitDir, "commondir"),
      `${join(repoPath, ".git")}\n`,
      "utf8",
    );

    const sandboxPolicy = defaultWorkspaceSandboxPolicy({
      id: "work_fake",
      project_id: "proj_fake",
      source_type: "git",
      repo_url: repoPath,
      path: workspacePath,
      cwd: workspacePath,
      branch: null,
      commit_sha: null,
      status: "ready",
      last_error: null,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
    } satisfies Workspace);

    expect(sandboxPolicy.writableRoots).toEqual([
      await realpath(workspacePath),
    ]);
  });

  it("archives or deletes workspaces only when no active sessions remain", async () => {
    const project = await post("/api/v1/projects", {
      name: "cleanup-demo",
      default_workspace_root: tempDir,
    });

    const archivedPath = join(tempDir, "archive-workspace");
    const archived = await post("/api/v1/workspaces", {
      project_id: project.project.id,
      source_type: "local",
      path: archivedPath,
    });
    const archivedCleanup = await post(
      `/api/v1/workspaces/${archived.workspace.id}/cleanup`,
      {},
    );
    expect(archivedCleanup.workspace.status).toBe("archived");
    await expect(access(archivedPath)).resolves.toBeUndefined();

    const deletePath = join(tempDir, "delete-workspace");
    const deleted = await post("/api/v1/workspaces", {
      project_id: project.project.id,
      source_type: "local",
      path: deletePath,
    });
    await writeFile(join(deletePath, "note.txt"), "delete me", "utf8");
    const deletedCleanup = await post(
      `/api/v1/workspaces/${deleted.workspace.id}/cleanup`,
      { delete_files: true },
    );
    expect(deletedCleanup.workspace.status).toBe("deleted");
    expect(deletedCleanup.cleanup.deleted_files).toBe(true);
    await expect(access(deletePath)).rejects.toThrow();

    const active = await post("/api/v1/workspaces", {
      project_id: project.project.id,
      source_type: "local",
      path: join(tempDir, "active-workspace"),
    });
    await post("/api/v1/sessions", {
      workspace_id: active.workspace.id,
      initial_message: "Keep this workspace active.",
      codex_options: { fake: true },
    });
    const activeCleanup = await app.inject({
      method: "POST",
      url: `/api/v1/workspaces/${active.workspace.id}/cleanup`,
      payload: { delete_files: true },
    });
    expect(activeCleanup.statusCode).toBe(409);
    expect(activeCleanup.json().error.code).toBe(
      "workspace_has_active_sessions",
    );
  });

  it("reconciles only persisted starting and running sessions on startup", async () => {
    const dbPath = join(tempDir, "codexhub.sqlite");
    const database = openDatabase({ path: dbPath });
    const repo = new HubRepository(database.db);
    const project = repo.createProject({ name: "restart-demo" });
    const workspace = repo.createWorkspace({
      project_id: project.id,
      source_type: "local",
      path: join(tempDir, "workspace"),
      cwd: join(tempDir, "workspace"),
    });
    const seeded = new Map<WorkerSessionStatus, string>();

    for (const status of [
      "starting",
      "running",
      "awaiting_input",
      "completed",
      "failed",
      "stopped",
    ] satisfies WorkerSessionStatus[]) {
      const session = repo.createSession({
        project_id: project.id,
        workspace_id: workspace.id,
      });
      seeded.set(status, session.id);
      repo.updateSession(session.id, {
        status,
        process_pid: `pid-${status}`,
        failure_reason: status === "failed" ? "already failed" : null,
        ended_at:
          status === "completed" || status === "failed" || status === "stopped"
            ? new Date().toISOString()
            : null,
      });
    }
    database.close();

    const restarted = await createServer({ dbPath, logger: false });
    try {
      const starting = await getFrom(
        restarted,
        `/api/v1/sessions/${requiredSeeded(seeded, "starting")}`,
      );
      const running = await getFrom(
        restarted,
        `/api/v1/sessions/${requiredSeeded(seeded, "running")}`,
      );
      const awaitingInput = await getFrom(
        restarted,
        `/api/v1/sessions/${requiredSeeded(seeded, "awaiting_input")}`,
      );
      const completed = await getFrom(
        restarted,
        `/api/v1/sessions/${requiredSeeded(seeded, "completed")}`,
      );
      const failed = await getFrom(
        restarted,
        `/api/v1/sessions/${requiredSeeded(seeded, "failed")}`,
      );
      const stopped = await getFrom(
        restarted,
        `/api/v1/sessions/${requiredSeeded(seeded, "stopped")}`,
      );

      expect(starting.session.status).toBe("failed");
      expect(starting.session.failure_reason).toContain("Server restarted");
      expect(starting.session.process_pid).toBeNull();
      expect(starting.session.ended_at).toEqual(expect.any(String));

      expect(running.session.status).toBe("failed");
      expect(running.session.failure_reason).toContain("Server restarted");
      expect(running.session.process_pid).toBeNull();
      expect(running.session.ended_at).toEqual(expect.any(String));

      expect(awaitingInput.session.status).toBe("awaiting_input");
      expect(awaitingInput.session.failure_reason).toBeNull();
      expect(awaitingInput.session.process_pid).toBe("pid-awaiting_input");

      expect(completed.session.status).toBe("completed");
      expect(completed.session.failure_reason).toBeNull();
      expect(completed.session.process_pid).toBe("pid-completed");

      expect(failed.session.status).toBe("failed");
      expect(failed.session.failure_reason).toBe("already failed");
      expect(failed.session.process_pid).toBe("pid-failed");

      expect(stopped.session.status).toBe("stopped");
      expect(stopped.session.failure_reason).toBeNull();
      expect(stopped.session.process_pid).toBe("pid-stopped");
    } finally {
      await restarted.close();
    }
  });
});

async function post(url: string, payload: unknown): Promise<any> {
  const response = await app.inject({ method: "POST", url, payload });
  expect(response.statusCode).toBeGreaterThanOrEqual(200);
  expect(response.statusCode).toBeLessThan(300);
  return response.json();
}

async function get(url: string): Promise<any> {
  const response = await app.inject({ method: "GET", url });
  expect(response.statusCode).toBe(200);
  return response.json();
}

async function put(url: string, payload: unknown): Promise<any> {
  const response = await app.inject({ method: "PUT", url, payload });
  expect(response.statusCode).toBeGreaterThanOrEqual(200);
  expect(response.statusCode).toBeLessThan(300);
  return response.json();
}

async function getFrom(instance: App, url: string): Promise<any> {
  const response = await instance.inject({ method: "GET", url });
  expect(response.statusCode).toBe(200);
  return response.json();
}

function requiredSeeded(
  seeded: Map<WorkerSessionStatus, string>,
  status: WorkerSessionStatus,
): string {
  const id = seeded.get(status);
  if (!id) throw new Error(`missing seeded ${status} session`);
  return id;
}

async function initGitRepo(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
  runGit(["init", path]);
  await writeFile(join(path, "README.md"), "# demo\n", "utf8");
  runGit(["-C", path, "add", "README.md"]);
  runGit([
    "-C",
    path,
    "-c",
    "user.name=Codexhub Test",
    "-c",
    "user.email=codexhub@example.test",
    "commit",
    "-m",
    "initial",
  ]);
}

function runGit(args: string[]): void {
  gitOutput(args);
}

function gitOutput(args: string[], env?: NodeJS.ProcessEnv): string {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    env,
    windowsHide: true,
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout.trim();
}
