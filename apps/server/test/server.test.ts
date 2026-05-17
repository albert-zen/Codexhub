import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

type App = Awaited<ReturnType<typeof createServer>>;

let app: App;
let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "codexhub-server-"));
  app = await createServer({ dbPath: ":memory:", logger: false });
});

afterEach(async () => {
  await app.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("Codexhub API", () => {
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

    const continued = await post(`/api/v1/sessions/${sessionId}/messages`, {
      mode: "continue",
      content: "",
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
