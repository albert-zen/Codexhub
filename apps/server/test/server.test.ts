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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("resolves unique short session prefixes and returns canonical ids", async () => {
    const project = await post("/api/v1/projects", {
      name: "prefix-demo",
      default_workspace_root: tempDir,
    });
    const started = await createFakeSession(project.project.id, "prefix-one");
    const sessionId = started.session.id;
    const shortPrefix = sessionId.slice(0, 12);
    const uuidPrefix = sessionId.slice("sess_".length, "sess_".length + 12);

    const inspected = await get(`/api/v1/sessions/${shortPrefix}`);
    expect(inspected.session.id).toBe(sessionId);

    const inspectedByUuidPrefix = await get(`/api/v1/sessions/${uuidPrefix}`);
    expect(inspectedByUuidPrefix.session.id).toBe(sessionId);

    const latest = await get(`/api/v1/sessions/${shortPrefix}/latest`);
    expect(latest.session_id).toBe(sessionId);
    expect(latest.last_agent_message).toContain("prefix-one");

    const items = await get(
      `/api/v1/items?session_id=${shortPrefix}&type=agentmessage`,
    );
    expect(items.session_id).toBe(sessionId);
    expect(items.items).toHaveLength(1);

    const continued = await post(`/api/v1/sessions/${shortPrefix}/messages`, {
      mode: "continue",
      content: "Use the canonical id in responses.",
      sender_type: "manager_agent",
    });
    expect(continued.session.id).toBe(sessionId);
    expect(continued.message.session_id).toBe(sessionId);
  });

  it("returns not found for missing uuid-only session prefixes", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/sessions/not-a-session",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toEqual({
      code: "session_not_found",
      message: "session not found",
    });
  });

  it("refuses ambiguous short session prefixes before side effects", async () => {
    const project = await post("/api/v1/projects", {
      name: "ambiguous-prefix-demo",
      default_workspace_root: tempDir,
    });
    const first = await createFakeSession(project.project.id, "ambiguous-one");
    const second = await createFakeSession(project.project.id, "ambiguous-two");
    const ambiguousPrefix = "sess_";

    const send = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${ambiguousPrefix}/messages`,
      payload: {
        mode: "continue",
        content: "This must not be sent.",
        sender_type: "manager_agent",
      },
    });
    expect(send.statusCode).toBe(409);
    expect(send.json().error.code).toBe("session_id_ambiguous");
    expect(send.json().error.candidate_ids).toEqual(
      [first.session.id, second.session.id].sort(),
    );

    const stop = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${ambiguousPrefix}/stop`,
      payload: {},
    });
    expect(stop.statusCode).toBe(409);
    expect(stop.json().error.code).toBe("session_id_ambiguous");

    const runGroup = await post("/api/v1/run-groups", {
      name: "ambiguous-prefix-run-group",
      project_id: project.project.id,
    });
    const addSession = await app.inject({
      method: "POST",
      url: `/api/v1/run-groups/${runGroup.run_group.id}/sessions`,
      payload: { session_id: ambiguousPrefix },
    });
    expect(addSession.statusCode).toBe(409);
    expect(addSession.json().error.code).toBe("session_id_ambiguous");

    for (const sessionId of [first.session.id, second.session.id]) {
      const inspected = await get(`/api/v1/sessions/${sessionId}`);
      expect(inspected.session.status).toBe("awaiting_input");
      const messages = await get(`/api/v1/sessions/${sessionId}/messages`);
      expect(messages.messages).toHaveLength(1);
    }
    const members = await get(
      `/api/v1/run-groups/${runGroup.run_group.id}/sessions`,
    );
    expect(members.sessions).toHaveLength(0);
  });

  it("refuses ambiguous uuid-only session prefixes before side effects", async () => {
    const project = await post("/api/v1/projects", {
      name: "ambiguous-uuid-prefix-demo",
      default_workspace_root: tempDir,
    });
    const sessions = [];
    for (let index = 0; index < 17; index += 1) {
      sessions.push(
        await createFakeSession(project.project.id, `uuid-prefix-${index}`),
      );
    }

    const ambiguousUuidPrefix = duplicatedUuidPrefix(
      sessions.map((session) => session.session.id),
    );
    const matchingSessionIds = sessions
      .map((session) => session.session.id)
      .filter((id) => id.slice("sess_".length).startsWith(ambiguousUuidPrefix))
      .sort();

    const send = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${ambiguousUuidPrefix}/messages`,
      payload: {
        mode: "continue",
        content: "This must not be sent.",
        sender_type: "manager_agent",
      },
    });
    expect(send.statusCode).toBe(409);
    expect(send.json().error).toMatchObject({
      code: "session_id_ambiguous",
      candidate_ids: matchingSessionIds,
    });

    const stop = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${ambiguousUuidPrefix}/stop`,
      payload: {},
    });
    expect(stop.statusCode).toBe(409);
    expect(stop.json().error.candidate_ids).toEqual(matchingSessionIds);

    const runGroup = await post("/api/v1/run-groups", {
      name: "ambiguous-uuid-prefix-run-group",
      project_id: project.project.id,
    });
    const addSession = await app.inject({
      method: "POST",
      url: `/api/v1/run-groups/${runGroup.run_group.id}/sessions`,
      payload: { session_id: ambiguousUuidPrefix },
    });
    expect(addSession.statusCode).toBe(409);
    expect(addSession.json().error.candidate_ids).toEqual(matchingSessionIds);

    for (const sessionId of matchingSessionIds) {
      const inspected = await get(`/api/v1/sessions/${sessionId}`);
      expect(inspected.session.status).toBe("awaiting_input");
      const messages = await get(`/api/v1/sessions/${sessionId}/messages`);
      expect(messages.messages).toHaveLength(1);
    }
    const members = await get(
      `/api/v1/run-groups/${runGroup.run_group.id}/sessions`,
    );
    expect(members.sessions).toHaveLength(0);
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
    repo.appendItem(session.id, {
      method: "turn/completed",
      params: {
        message: "done",
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
      ).toEqual(["tool", "debug"]);

      const latest = await getFrom(
        seeded,
        `/api/v1/sessions/${session.id}/transcript?limit=2&recent=true`,
      );
      expect(
        latest.transcript.map((entry: { kind: string }) => entry.kind),
      ).toEqual(["tool", "debug"]);
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
  }, 15_000);

  it("bounds recent transcript projection to the requested tail window", async () => {
    const dbPath = join(tempDir, "large-recent-transcript.sqlite");
    const database = openDatabase({ path: dbPath });
    const repo = new HubRepository(database.db);
    const project = repo.createProject({ name: "large-transcript-demo" });
    const workspace = repo.createWorkspace({
      project_id: project.id,
      source_type: "local",
      path: join(tempDir, "large-transcript-workspace"),
      cwd: join(tempDir, "large-transcript-workspace"),
    });
    const session = repo.createSession({
      project_id: project.id,
      workspace_id: workspace.id,
    });

    for (let index = 0; index < 180; index += 1) {
      repo.appendItem(session.id, {
        method: "item/tool/call",
        params: {
          item: {
            id: `old_tool_${index}`,
            type: "mcpToolCall",
            text: `old tool ${index}`,
          },
        },
      });
    }
    repo.appendItem(session.id, {
      method: "item/agentMessage/delta",
      params: {
        itemId: "agent_recent",
        textDelta: "partial ",
      },
    });
    repo.appendItem(session.id, {
      method: "item/completed",
      params: {
        item: {
          id: "agent_recent",
          type: "agentMessage",
          text: "recent complete",
        },
      },
    });
    repo.appendItem(session.id, {
      method: "item/completed",
      params: {
        item: {
          id: "tool_recent",
          type: "mcpToolCall",
          text: "tool complete",
        },
      },
    });
    database.close();

    const seeded = await createServer({ dbPath, logger: false });
    const parseSpy = vi.spyOn(JSON, "parse");
    try {
      const latest = await getFrom(
        seeded,
        `/api/v1/sessions/${session.id}/transcript?limit=2&recent=true`,
      );

      expect(
        latest.transcript.map((entry: { kind: string }) => entry.kind),
      ).toEqual(["agent_message", "tool"]);
      expect(latest.transcript[0]).toMatchObject({
        sequence: 181,
        text: "recent complete",
        item_sequences: [181, 182],
      });
      expect(latest.transcript[1]).toMatchObject({
        sequence: 182,
        text: "tool complete",
        item_sequences: [183],
      });
      expect(latest.next_cursor).toBeNull();
      expect(parseSpy.mock.calls.length).toBeLessThan(20);
    } finally {
      parseSpy.mockRestore();
      await seeded.close();
    }
  }, 15_000);

  it("orders recent grouped agent messages by first sequence timestamp", async () => {
    const dbPath = join(tempDir, "skewed-recent-transcript.sqlite");
    const database = openDatabase({ path: dbPath });
    const repo = new HubRepository(database.db);
    const project = repo.createProject({ name: "skewed-transcript-demo" });
    const workspace = repo.createWorkspace({
      project_id: project.id,
      source_type: "local",
      path: join(tempDir, "skewed-transcript-workspace"),
      cwd: join(tempDir, "skewed-transcript-workspace"),
    });
    const session = repo.createSession({
      project_id: project.id,
      workspace_id: workspace.id,
    });

    const before = repo.appendItem(session.id, {
      method: "item/completed",
      params: {
        item: {
          id: "tool_before",
          type: "mcpToolCall",
          text: "before",
        },
      },
    });
    const agentDelta = repo.appendItem(session.id, {
      method: "item/agentMessage/delta",
      params: {
        itemId: "agent_skewed",
        textDelta: "partial ",
      },
    });
    const agentComplete = repo.appendItem(session.id, {
      method: "item/completed",
      params: {
        item: {
          id: "agent_skewed",
          type: "agentMessage",
          text: "complete",
        },
      },
    });
    const middle = repo.appendItem(session.id, {
      method: "item/completed",
      params: {
        item: {
          id: "tool_middle",
          type: "mcpToolCall",
          text: "middle",
        },
      },
    });
    const after = repo.appendItem(session.id, {
      method: "item/completed",
      params: {
        item: {
          id: "tool_after",
          type: "mcpToolCall",
          text: "after",
        },
      },
    });

    const setCreatedAt = database.db.prepare(
      "UPDATE items SET created_at = ? WHERE id = ?",
    );
    setCreatedAt.run("2026-01-01T00:00:01.000Z", before.id);
    setCreatedAt.run("2026-01-01T00:00:03.000Z", agentDelta.id);
    setCreatedAt.run("2026-01-01T00:00:00.000Z", agentComplete.id);
    setCreatedAt.run("2026-01-01T00:00:02.000Z", middle.id);
    setCreatedAt.run("2026-01-01T00:00:04.000Z", after.id);
    database.close();

    const seeded = await createServer({ dbPath, logger: false });
    try {
      const full = await getFrom(
        seeded,
        `/api/v1/sessions/${session.id}/transcript?limit=10`,
      );
      const recent = await getFrom(
        seeded,
        `/api/v1/sessions/${session.id}/transcript?limit=3&recent=true`,
      );

      expect(recent.transcript).toEqual(full.transcript.slice(-3));
      expect(
        recent.transcript.map(
          (entry: { kind: string; text: string | null }) =>
            `${entry.kind}:${entry.text}`,
        ),
      ).toEqual(["tool:middle", "agent_message:complete", "tool:after"]);
      expect(recent.transcript[1]).toMatchObject({
        created_at: "2026-01-01T00:00:03.000Z",
        item_sequences: [2, 3],
      });
      expect(recent.next_cursor).toBeNull();
    } finally {
      await seeded.close();
    }
  }, 15_000);

  it("keeps session latest stable while preserving raw agent deltas", async () => {
    const dbPath = join(tempDir, "latest-agentmessage.sqlite");
    let sessionId = "";

    {
      const database = openDatabase({ path: dbPath });
      const repo = new HubRepository(database.db);
      const project = repo.createProject({ name: "latest-agentmessage-demo" });
      const workspace = repo.createWorkspace({
        project_id: project.id,
        source_type: "local",
        path: join(tempDir, "latest-agentmessage-workspace"),
        cwd: join(tempDir, "latest-agentmessage-workspace"),
      });
      const session = repo.createSession({
        project_id: project.id,
        workspace_id: workspace.id,
      });
      sessionId = session.id;

      repo.appendItem(session.id, {
        method: "item/completed",
        params: {
          item: {
            id: "agent_previous",
            type: "agentMessage",
            text: "Previous complete answer.",
          },
        },
      });
      expect(repo.getSession(session.id)?.last_agent_message).toBe(
        "Previous complete answer.",
      );

      repo.appendItem(session.id, {
        method: "item/agentMessage/delta",
        params: {
          itemId: "agent_current",
          textDelta: "The worktree is clean. The",
        },
      });
      expect(repo.getSession(session.id)?.last_agent_message).toBe(
        "Previous complete answer.",
      );
      expect(repo.latestItem(session.id, "agentmessage")?.text_excerpt).toBe(
        "The worktree is clean. The",
      );

      repo.appendItem(session.id, {
        method: "item/agentMessage/delta",
        params: {
          itemId: "agent_current",
          textDelta: " rest is still drafting.",
        },
      });
      repo.appendItem(session.id, {
        method: "turn/completed",
        params: { mode: "steer" },
      });
      expect(repo.getSession(session.id)?.last_agent_message).toBe(
        "Previous complete answer.",
      );
      database.close();
    }

    let seeded = await createServer({ dbPath, logger: false });
    try {
      const stableLatest = await getFrom(
        seeded,
        `/api/v1/sessions/${sessionId}/latest?type=agentmessage`,
      );
      expect(stableLatest.last_agent_message).toBe(
        "Previous complete answer.",
      );
      expect(stableLatest.item).toMatchObject({
        type: "agentmessage",
        codex_method: "item/completed",
        text_excerpt: "Previous complete answer.",
      });

      const stableLatestAll = await getFrom(
        seeded,
        `/api/v1/sessions/${sessionId}/latest?type=all`,
      );
      expect(stableLatestAll.last_agent_message).toBe(
        "Previous complete answer.",
      );
      expect(stableLatestAll.item).toMatchObject({
        type: "agentmessage",
        codex_method: "item/completed",
        text_excerpt: "Previous complete answer.",
      });

      const rawLatest = await getFrom(
        seeded,
        `/api/v1/sessions/${sessionId}/items/latest?type=agentmessage`,
      );
      expect(rawLatest.item).toMatchObject({
        type: "agentmessage",
        codex_method: "item/agentMessage/delta",
        text_excerpt: " rest is still drafting.",
      });

      const rawLatestAll = await getFrom(
        seeded,
        `/api/v1/sessions/${sessionId}/items/latest?type=all`,
      );
      expect(rawLatestAll.item).toMatchObject({
        type: "state",
        codex_method: "turn/completed",
      });
    } finally {
      await seeded.close();
    }

    {
      const database = openDatabase({ path: dbPath });
      const repo = new HubRepository(database.db);
      repo.appendItem(sessionId, {
        method: "item/completed",
        params: {
          item: {
            id: "agent_current",
            type: "agentMessage",
            text: "The complete final answer.",
          },
        },
      });
      expect(repo.getSession(sessionId)?.last_agent_message).toBe(
        "The complete final answer.",
      );
      database.close();
    }

    seeded = await createServer({ dbPath, logger: false });
    try {
      const latest = await getFrom(
        seeded,
        `/api/v1/sessions/${sessionId}/latest?type=agentmessage`,
      );
      expect(latest.last_agent_message).toBe("The complete final answer.");
      expect(latest.item).toMatchObject({
        type: "agentmessage",
        codex_method: "item/completed",
        text_excerpt: "The complete final answer.",
      });

      const rawItems = await getFrom(
        seeded,
        `/api/v1/sessions/${sessionId}/items?type=agentmessage&limit=10`,
      );
      expect(
        rawItems.items.map(
          (item: { codex_method: string }) => item.codex_method,
        ),
      ).toEqual([
        "item/completed",
        "item/agentMessage/delta",
        "item/agentMessage/delta",
        "item/completed",
      ]);
      expect(rawItems.items[1]).toMatchObject({
        codex_method: "item/agentMessage/delta",
        text_excerpt: "The worktree is clean. The",
      });
      expect(rawItems.items[1].raw_payload.params.textDelta).toBe(
        "The worktree is clean. The",
      );
    } finally {
      await seeded.close();
    }
  });

  it("does not expose a draft-only agent delta as session latest", async () => {
    const dbPath = join(tempDir, "draft-only-latest.sqlite");
    const database = openDatabase({ path: dbPath });
    const repo = new HubRepository(database.db);
    const project = repo.createProject({ name: "draft-only-latest-demo" });
    const workspace = repo.createWorkspace({
      project_id: project.id,
      source_type: "local",
      path: join(tempDir, "draft-only-latest-workspace"),
      cwd: join(tempDir, "draft-only-latest-workspace"),
    });
    const session = repo.createSession({
      project_id: project.id,
      workspace_id: workspace.id,
    });

    repo.appendItem(session.id, {
      method: "item/agentMessage/delta",
      params: {
        itemId: "agent_current",
        textDelta: "The worktree is clean. The",
      },
    });
    expect(repo.getSession(session.id)?.last_agent_message).toBeNull();
    database.close();

    const seeded = await createServer({ dbPath, logger: false });
    try {
      const stableLatest = await getFrom(
        seeded,
        `/api/v1/sessions/${session.id}/latest?type=agentmessage`,
      );
      expect(stableLatest.last_agent_message).toBeNull();
      expect(stableLatest.item).toBeNull();

      const stableLatestAll = await getFrom(
        seeded,
        `/api/v1/sessions/${session.id}/latest?type=all`,
      );
      expect(stableLatestAll.last_agent_message).toBeNull();
      expect(stableLatestAll.item).toBeNull();

      const rawLatest = await getFrom(
        seeded,
        `/api/v1/sessions/${session.id}/items/latest?type=agentmessage`,
      );
      expect(rawLatest.item).toMatchObject({
        type: "agentmessage",
        codex_method: "item/agentMessage/delta",
        text_excerpt: "The worktree is clean. The",
      });
      expect(rawLatest.item.raw_payload.params.textDelta).toBe(
        "The worktree is clean. The",
      );

      const rawLatestAll = await getFrom(
        seeded,
        `/api/v1/sessions/${session.id}/items/latest?type=all`,
      );
      expect(rawLatestAll.item).toMatchObject({
        type: "agentmessage",
        codex_method: "item/agentMessage/delta",
        text_excerpt: "The worktree is clean. The",
      });
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

  it("reconciles persisted active sessions without live processes on startup", async () => {
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

      expect(awaitingInput.session.status).toBe("failed");
      expect(awaitingInput.session.failure_reason).toContain(
        "cannot be continued",
      );
      expect(awaitingInput.session.process_pid).toBeNull();
      expect(awaitingInput.session.ended_at).toEqual(expect.any(String));

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

  it.each(["continue", "steer"] as const)(
    "fails a %s send to an awaiting session without a live process",
    async (mode) => {
      const dbPath = join(tempDir, `orphan-${mode}.sqlite`);
      const instance = await createServer({ dbPath, logger: false });
      const database = openDatabase({ path: dbPath });
      let sessionId: string;
      try {
        const repo = new HubRepository(database.db);
        const project = repo.createProject({ name: `orphan-${mode}` });
        const workspace = repo.createWorkspace({
          project_id: project.id,
          source_type: "local",
          path: join(tempDir, `orphan-${mode}-workspace`),
          cwd: join(tempDir, `orphan-${mode}-workspace`),
        });
        const session = repo.createSession({
          project_id: project.id,
          workspace_id: workspace.id,
        });
        sessionId = session.id;
        repo.updateSession(session.id, {
          status: "awaiting_input",
          codex_thread_id: "thread-orphan",
          codex_turn_id: "turn-orphan",
          codex_session_key: "thread-orphan-turn-orphan",
          process_pid: "pid-orphan",
        });
      } finally {
        database.close();
      }

      try {
        const response = await instance.inject({
          method: "POST",
          url: `/api/v1/sessions/${sessionId}/messages`,
          payload: {
            mode,
            content: "Please continue.",
            sender_type: "manager_agent",
          },
        });
        const body = response.json();
        expect(response.statusCode).toBe(409);
        expect(body.error.code).toBe("session_process_unavailable");
        expect(body.error.message).toContain("live Codex app-server process");

        const inspected = await getFrom(
          instance,
          `/api/v1/sessions/${sessionId}`,
        );
        expect(inspected.session.status).toBe("failed");
        expect(inspected.session.failure_reason).toContain(
          "start a follow-up session",
        );
        expect(inspected.session.process_pid).toBeNull();

        const messages = await getFrom(
          instance,
          `/api/v1/sessions/${sessionId}/messages`,
        );
        expect(messages.messages).toHaveLength(1);
        expect(messages.messages[0]).toMatchObject({
          mode,
          status: "failed",
          error: expect.stringContaining("live Codex app-server process"),
        });
      } finally {
        await instance.close();
      }
    },
  );
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

async function createFakeSession(
  projectId: string,
  workspaceName: string,
): Promise<any> {
  const workspace = await post("/api/v1/workspaces", {
    project_id: projectId,
    source_type: "local",
    path: join(tempDir, workspaceName),
  });
  return post("/api/v1/sessions", {
    workspace_id: workspace.workspace.id,
    initial_message: `Inspect ${workspaceName} and report status.`,
    codex_options: { fake: true },
  });
}

function duplicatedUuidPrefix(sessionIds: string[]): string {
  const counts = new Map<string, number>();
  for (const sessionId of sessionIds) {
    const prefix = sessionId.slice("sess_".length, "sess_".length + 1);
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    if ((counts.get(prefix) ?? 0) > 1) return prefix;
  }
  throw new Error("expected at least one duplicate uuid prefix");
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
