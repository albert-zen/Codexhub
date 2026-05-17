import { access, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { WorkerSessionStatus } from "@codexhub/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/database.js";
import { HubRepository } from "../src/repository.js";
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
      codex_options: { fake: true },
    });
    const sessionId = started.session.id;

    expect(started.session.status).toBe("awaiting_input");
    expect(started.session.last_agent_message).toContain("Inspect this repo");

    const latest = await get(`/api/v1/sessions/${sessionId}/items/latest`);
    expect(latest.item.type).toBe("agentmessage");
    expect(latest.item.raw_payload.method).toBe("item/completed");

    const agentItems = await get(`/api/v1/sessions/${sessionId}/items`);
    expect(agentItems.items).toHaveLength(1);
    expect(agentItems.type).toBe("agentmessage");

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
