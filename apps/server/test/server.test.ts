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
import type { AddressInfo } from "node:net";
import type {
  WorkerSession,
  WorkerSessionStatus,
  Workspace,
} from "@codexhub/core";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/database.js";
import { HubRepository } from "../src/repository.js";
import {
  SessionProcessUnavailableError,
  codexWorkerEnvironment,
  defaultWorkspaceSandboxPolicy,
  type CodexRuntimeController,
  type SendOptions,
  type StartOptions,
} from "../src/runtime.js";
import { createRuntimeSupervisorServer } from "../src/runtime-supervisor.js";
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

  it("creates empty project-scoped threads without starting runtime work", async () => {
    const project = await post("/api/v1/projects", {
      name: "thread-demo",
      default_workspace_root: tempDir,
    });
    const workspace = await post("/api/v1/workspaces", {
      project_id: project.project.id,
      source_type: "local",
      path: join(tempDir, "thread-demo-workspace"),
    });

    const created = await post(
      `/api/v1/projects/${project.project.id}/threads`,
      {
        workspace_id: workspace.workspace.id,
        idempotency_key: "create-thread-key",
      },
    );
    const retried = await post(
      `/api/v1/projects/${project.project.id}/threads`,
      {
        workspace_id: workspace.workspace.id,
        idempotency_key: "create-thread-key",
      },
    );

    expect(created.thread).toMatchObject({
      id: created.thread.session_id,
      project_id: project.project.id,
      workspace_id: workspace.workspace.id,
      thread_state: "empty",
      conversation_state: "ready",
    });
    expect(retried.thread.id).toBe(created.thread.id);

    const listed = await get(`/api/v1/projects/${project.project.id}/threads`);
    expect(listed.threads).toHaveLength(1);
    expect(listed.threads[0].id).toBe(created.thread.id);
  });

  it("preserves empty project-scoped threads across API server restart", async () => {
    await app.close();
    const dbPath = join(tempDir, "empty-thread-restart.sqlite");
    app = await createServer({ dbPath, logger: false });

    const project = await post("/api/v1/projects", {
      name: "thread-restart-demo",
      default_workspace_root: tempDir,
    });
    const workspace = await post("/api/v1/workspaces", {
      project_id: project.project.id,
      source_type: "local",
      path: join(tempDir, "thread-restart-workspace"),
    });
    const created = await post(
      `/api/v1/projects/${project.project.id}/threads`,
      {
        workspace_id: workspace.workspace.id,
      },
    );
    expect(created.thread).toMatchObject({
      thread_state: "empty",
      runtime_state: "notStarted",
    });

    await app.close();
    app = await createServer({ dbPath, logger: false });

    const inspected = await get(`/api/v1/threads/${created.thread.id}`);
    expect(inspected.thread).toMatchObject({
      id: created.thread.id,
      thread_state: "empty",
      conversation_state: "ready",
      runtime_state: "notStarted",
    });
    expect(inspected.session).toMatchObject({
      status: "starting",
      process_pid: null,
      failure_reason: null,
      started_at: null,
      ended_at: null,
    });
  });

  it("starts runtime automatically when sending the first message to an empty thread", async () => {
    const project = await post("/api/v1/projects", {
      name: "thread-send-demo",
      default_workspace_root: tempDir,
      default_codex_options: { fake: true },
    });
    const workspace = await post("/api/v1/workspaces", {
      project_id: project.project.id,
      source_type: "local",
      path: join(tempDir, "thread-send-workspace"),
    });
    const created = await post(
      `/api/v1/projects/${project.project.id}/threads`,
      {
        workspace_id: workspace.workspace.id,
      },
    );

    const sent = await post(`/api/v1/threads/${created.thread.id}/messages`, {
      content: "Inspect the project and report status.",
      sender_type: "manager_agent",
      idempotency_key: "first-thread-send",
      wait: "turn-complete",
      timeout: "5s",
    });
    const retried = await post(
      `/api/v1/threads/${created.thread.id}/messages`,
      {
        content: "Inspect the project and report status.",
        sender_type: "manager_agent",
        idempotency_key: "first-thread-send",
      },
    );

    expect(sent.message).toMatchObject({
      mode: "initial",
      status: "sent",
      content: "Inspect the project and report status.",
    });
    expect(retried.message.id).toBe(sent.message.id);
    expect(sent.thread).toMatchObject({
      id: created.thread.id,
      thread_state: "active",
      conversation_state: "ready",
    });
    expect(sent.session.status).toBe("awaiting_input");
    expect(sent.wait).toBe("turn-complete");
    expect(sent.session.last_agent_message).toContain("Inspect the project");
    const messages = await get(
      `/api/v1/sessions/${created.thread.id}/messages`,
    );
    expect(messages.messages).toHaveLength(1);
  });

  it("keeps an empty thread retryable when first runtime start is unavailable", async () => {
    await app.close();
    const dbPath = join(tempDir, "thread-first-send-unavailable.sqlite");
    const database = openDatabase({ path: dbPath });
    const repo = new HubRepository(database.db);
    const project = repo.createProject({
      name: "thread-first-send-unavailable",
    });
    const workspace = repo.createWorkspace({
      project_id: project.id,
      source_type: "local",
      path: join(tempDir, "thread-first-send-unavailable-workspace"),
      cwd: join(tempDir, "thread-first-send-unavailable-workspace"),
    });
    const session = repo.createSession({
      project_id: project.id,
      workspace_id: workspace.id,
    });
    database.close();

    const unavailableOnStartSessionIds = new Set([session.id]);
    app = await createServer({
      dbPath,
      logger: false,
      runtimeFactory: (runtimeRepo) =>
        new RegistryRuntime(runtimeRepo, new Set(), {
          unavailableOnStartSessionIds,
        }),
    });

    const failed = await app.inject({
      method: "POST",
      url: `/api/v1/threads/${session.id}/messages`,
      payload: {
        content: "Start the thread.",
        sender_type: "manager_agent",
        idempotency_key: "start-retry-key",
      },
    });
    expect(failed.statusCode).toBe(409);
    expect(failed.json().error).toMatchObject({
      code: "session_process_unavailable",
      session_id: session.id,
      retryable: true,
      follow_up_available: false,
    });

    const inspected = await get(`/api/v1/threads/${session.id}`);
    expect(inspected.thread).toMatchObject({
      thread_state: "empty",
      runtime_state: "notStarted",
    });
    expect(inspected.session).toMatchObject({
      status: "starting",
      codex_thread_id: null,
      process_pid: null,
      failure_reason: null,
      started_at: null,
      ended_at: null,
    });

    const context = await get(`/api/v1/threads/${session.id}/context`);
    expect(context.thread).toMatchObject({
      thread_state: "empty",
      conversation_state: "failedToSend",
    });
    expect(context.attention_reasons).toContain("failed_to_send");
    expect(context.transcript[0]).toMatchObject({
      message_status: "failed",
      text: "Start the thread.",
    });

    unavailableOnStartSessionIds.delete(session.id);
    const retried = await app.inject({
      method: "POST",
      url: `/api/v1/threads/${session.id}/messages`,
      payload: {
        content: "Retry the thread.",
        sender_type: "manager_agent",
        idempotency_key: "start-retry-key",
      },
    });
    expect(retried.statusCode).toBe(200);
    expect(retried.json()).toMatchObject({
      message: {
        mode: "initial",
        status: "sent",
        content: "Retry the thread.",
      },
    });
  });

  it("rejects empty thread messages even when clients request initial mode", async () => {
    const project = await post("/api/v1/projects", {
      name: "thread-empty-message",
      default_workspace_root: tempDir,
    });
    const workspace = await post("/api/v1/workspaces", {
      project_id: project.project.id,
      source_type: "local",
      path: join(tempDir, "thread-empty-message-workspace"),
    });
    const created = await post(
      `/api/v1/projects/${project.project.id}/threads`,
      {
        workspace_id: workspace.workspace.id,
      },
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/threads/${created.thread.id}/messages`,
      payload: {
        mode: "initial",
        content: "",
        sender_type: "human",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatchObject({
      code: "message_required",
    });

    const messages = await get(
      `/api/v1/sessions/${created.thread.id}/messages`,
    );
    expect(messages.messages).toHaveLength(0);
  });

  it("returns a compact thread context window for manager agents", async () => {
    const project = await post("/api/v1/projects", {
      name: "thread-context-demo",
      default_workspace_root: tempDir,
    });
    const started = await createFakeSession(
      project.project.id,
      "thread-context-workspace",
    );
    const sessionId = started.session.id;

    const context = await get(
      `/api/v1/threads/${sessionId}/context?limit=10&tools=collapsed`,
    );

    expect(context.thread).toMatchObject({
      id: sessionId,
      thread_state: "active",
    });
    expect(context.latest_agent_message).toContain(
      "Inspect thread-context-workspace",
    );
    expect(context.allowed_actions).toContain("send");
    expect(context.transcript.length).toBeGreaterThan(0);
    expect(context.tool_calls).toEqual([]);
  });

  it("can expand thread tool calls to raw item details", async () => {
    await app.close();
    const dbPath = join(tempDir, "thread-tool-calls.sqlite");
    const database = openDatabase({ path: dbPath });
    const repo = new HubRepository(database.db);
    const project = repo.createProject({ name: "thread-tool-demo" });
    const workspace = repo.createWorkspace({
      project_id: project.id,
      source_type: "local",
      path: join(tempDir, "thread-tool-workspace"),
      cwd: join(tempDir, "thread-tool-workspace"),
    });
    const session = repo.createSession({
      project_id: project.id,
      workspace_id: workspace.id,
    });
    repo.updateSession(session.id, { status: "awaiting_input" });
    const call = repo.appendItem(session.id, {
      method: "item/tool/call",
      params: {
        item: {
          id: "tool-expanded",
          type: "toolCall",
          text: "pnpm test",
        },
      },
    });
    const result = repo.appendItem(session.id, {
      method: "item/tool/result",
      params: {
        item: {
          id: "tool-expanded",
          type: "toolResult",
          text: "passed",
        },
      },
    });
    database.close();

    app = await createServer({ dbPath, logger: false });
    const collapsed = await get(
      `/api/v1/threads/${session.id}/tool-calls?tools=collapsed`,
    );
    expect(collapsed.tool_calls[0]).toMatchObject({
      id: "tool-expanded",
      item_ids: [call.id, result.id],
      item_sequences: [call.sequence, result.sequence],
    });
    expect(collapsed.tool_calls[0].items).toBeUndefined();

    const expanded = await get(
      `/api/v1/threads/${session.id}/tool-calls?tools=expanded`,
    );
    expect(
      expanded.tool_calls[0].items.map((item: { id: string }) => item.id),
    ).toEqual([call.id, result.id]);

    const hidden = await get(
      `/api/v1/threads/${session.id}/tool-calls?tools=hidden`,
    );
    expect(hidden.tool_calls).toEqual([]);
    expect(hidden.items).toEqual([]);
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

  it("persists review findings and worker responses as observability records", async () => {
    const project = await post("/api/v1/projects", {
      name: "review-findings-demo",
      default_workspace_root: tempDir,
    });
    const implementation = await createFakeSession(
      project.project.id,
      "implementation-session",
    );
    const reviewer = await createFakeSession(
      project.project.id,
      "reviewer-session",
    );
    const sessionId = implementation.session.id;
    const reviewerSessionId = reviewer.session.id;

    const empty = await get(`/api/v1/sessions/${sessionId}/review-findings`);
    expect(empty.review_findings).toHaveLength(0);
    expect(empty.next_cursor).toBeNull();

    const created = await post(
      `/api/v1/sessions/${sessionId}/review-findings`,
      {
        reviewer_session_id: reviewerSessionId,
        severity: "high",
        summary: "Missing validation for review findings.",
        details: "Add server and CLI coverage for create/list/update behavior.",
      },
    );
    const findingId = created.review_finding.id;
    expect(created.review_finding).toMatchObject({
      session_id: sessionId,
      reviewer_session_id: reviewerSessionId,
      severity: "high",
      status: "open",
      summary: "Missing validation for review findings.",
      worker_response: null,
    });

    const listed = await get(`/api/v1/sessions/${sessionId}/review-findings`);
    expect(listed.session_id).toBe(sessionId);
    expect(listed.review_findings).toHaveLength(1);
    expect(listed.review_findings[0].id).toBe(findingId);

    const updated = await put(
      `/api/v1/sessions/${sessionId}/review-findings/${findingId}`,
      {
        status: "accepted",
        worker_response: "Added focused persistence, API, and CLI tests.",
      },
    );
    expect(updated.review_finding).toMatchObject({
      id: findingId,
      status: "accepted",
      worker_response: "Added focused persistence, API, and CLI tests.",
    });

    const reviewStatus = await get(
      `/api/v1/sessions/${sessionId}/review-status`,
    );
    expect(reviewStatus.review_status.implementation_done).toBe(false);

    const missingReviewer = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sessionId}/review-findings`,
      payload: {
        severity: "high",
        summary: "Reviewer session is required.",
      },
    });
    expect(missingReviewer.statusCode).toBe(400);
    expect(missingReviewer.json().error.code).toBe("invalid_request");

    const invalidStatus = await app.inject({
      method: "PUT",
      url: `/api/v1/sessions/${sessionId}/review-findings/${findingId}`,
      payload: { status: "blocked" },
    });
    expect(invalidStatus.statusCode).toBe(400);
    expect(invalidStatus.json().error.code).toBe("invalid_review_finding");
  });

  it("returns bounded run group dashboard summaries with review and attention state", async () => {
    const dbPath = join(tempDir, "run-group-dashboard.sqlite");
    const database = openDatabase({ path: dbPath });
    const repo = new HubRepository(database.db);
    const project = repo.createProject({ name: "run-group-dashboard-demo" });
    const workspace = repo.createWorkspace({
      project_id: project.id,
      source_type: "local",
      path: join(tempDir, "run-group-dashboard-workspace"),
      cwd: join(tempDir, "run-group-dashboard-workspace"),
    });
    const runGroup = repo.createRunGroup({
      name: "dashboard-batch",
      project_id: project.id,
      purpose: "Watch worker progress.",
    });

    function createDashboardSession(
      status: WorkerSessionStatus,
      message: string,
    ) {
      const session = repo.createSession({
        project_id: project.id,
        workspace_id: workspace.id,
      });
      repo.appendItem(session.id, {
        method: "item/completed",
        params: {
          item: {
            id: `agent_${status}_${session.id}`,
            type: "agentMessage",
            text: message,
          },
        },
      });
      repo.updateSession(session.id, {
        status,
        failure_reason: status === "failed" ? "worker process exited" : null,
        ended_at:
          status === "completed" || status === "failed"
            ? new Date().toISOString()
            : null,
      });
      repo.addSessionToRunGroup(runGroup.id, session.id);
      return session;
    }

    const review = createDashboardSession(
      "completed",
      "Implementation complete and ready for review.",
    );
    const failed = createDashboardSession(
      "failed",
      "Failed before validation.",
    );
    repo.updateReviewGateStatus(review.id, {
      implementation_done: true,
      self_validation_done: true,
      review_requested: true,
      ready_for_human_review: true,
    });
    repo.createReviewFinding({
      session_id: review.id,
      reviewer_session_id: failed.id,
      severity: "high",
      summary: "Open finding should be visible in the dashboard.",
    });
    database.close();

    const seeded = await createServer({ dbPath, logger: false });
    try {
      const awaitingResponse = await seeded.inject({
        method: "POST",
        url: "/api/v1/sessions",
        payload: {
          workspace_id: workspace.id,
          initial_message: "Need manager input on package boundaries.",
          codex_options: { fake: true },
        },
      });
      expect(awaitingResponse.statusCode).toBe(200);
      const awaiting = awaitingResponse.json().session;
      await seeded.inject({
        method: "POST",
        url: `/api/v1/run-groups/${runGroup.id}/sessions`,
        payload: { session_id: awaiting.id },
      });

      const firstPage = await getFrom(
        seeded,
        `/api/v1/run-groups/${runGroup.id}/dashboard?limit=2`,
      );
      expect(firstPage.run_group).toMatchObject({
        id: runGroup.id,
        name: "dashboard-batch",
      });
      expect(firstPage.session_summaries).toHaveLength(2);
      expect(firstPage.items).toEqual(firstPage.session_summaries);
      expect(firstPage.next_cursor).toBe("2");

      const fullPage = await getFrom(
        seeded,
        `/api/v1/run-groups/${runGroup.id}/dashboard?limit=10`,
      );
      const summariesBySessionId = new Map(
        fullPage.session_summaries.map((summary: any) => [
          summary.session.id,
          summary,
        ]),
      );

      expect(summariesBySessionId.get(awaiting.id)).toMatchObject({
        session: {
          id: awaiting.id,
          status: "awaiting_input",
          last_agent_message:
            "Fake Codex worker received: Need manager input on package boundaries.",
        },
        review_status: {
          implementation_done: false,
          review_requested: false,
        },
        review_finding_count: 0,
        open_review_finding_count: 0,
        attention_required: true,
        attention_reasons: ["awaiting_input"],
      });
      expect(summariesBySessionId.get(review.id)).toMatchObject({
        session: {
          id: review.id,
          status: "completed",
          last_agent_message: "Implementation complete and ready for review.",
        },
        review_status: {
          implementation_done: true,
          self_validation_done: true,
          review_requested: true,
          ready_for_human_review: true,
          review_addressed: false,
        },
        review_finding_count: 1,
        open_review_finding_count: 1,
        attention_required: true,
        attention_reasons: ["review_needed", "open_review_findings"],
      });

      const secondPage = await getFrom(
        seeded,
        `/api/v1/run-groups/${runGroup.id}/dashboard?limit=2&cursor=${firstPage.next_cursor}`,
      );
      expect(secondPage.session_summaries).toHaveLength(1);
      expect(secondPage.next_cursor).toBeNull();
      expect(summariesBySessionId.get(failed.id)).toMatchObject({
        session: {
          id: failed.id,
          status: "failed",
          failure_reason: "worker process exited",
          last_agent_message: "Failed before validation.",
        },
        attention_required: true,
        attention_reasons: ["failed"],
      });

      const sessionsPage = await getFrom(
        seeded,
        `/api/v1/run-groups/${runGroup.id}/sessions?limit=2`,
      );
      expect(sessionsPage.sessions).toHaveLength(2);
      expect(sessionsPage.next_cursor).toBe("2");
    } finally {
      await seeded.close();
    }
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

  it.each(["stopped", "completed", "failed"] as const)(
    "starts a follow-up session from a %s source session",
    async (status) => {
      const dbPath = join(tempDir, `follow-up-${status}.sqlite`);
      const database = openDatabase({ path: dbPath });
      const seeded = (() => {
        const repo = new HubRepository(database.db);
        const project = repo.createProject({
          name: `follow-up-${status}`,
          default_codex_options: { fake: true },
        });
        const sourceWorkspace = repo.createWorkspace({
          project_id: project.id,
          source_type: "local",
          path: join(tempDir, `follow-up-${status}-source`),
          cwd: join(tempDir, `follow-up-${status}-source`),
        });
        const targetWorkspace = repo.createWorkspace({
          project_id: project.id,
          source_type: "local",
          path: join(tempDir, `follow-up-${status}-target`),
          cwd: join(tempDir, `follow-up-${status}-target`),
        });
        const previous = repo.createSession({
          project_id: project.id,
          workspace_id: sourceWorkspace.id,
        });
        repo.createTaskSpec({
          session_id: previous.id,
          ref: "https://github.com/albert-zen/Codexhub/issues/23",
          title: "Terminal follow-up",
          intent: "Continue work without reviving a dead process.",
          scope: "Start a new session linked to the terminal source.",
          acceptance_criteria: "A new session records previous_session_id.",
          raw: "Terminal source task spec.",
        });
        repo.updateSession(previous.id, {
          status,
          process_pid: `pid-${status}`,
          failure_reason: status === "failed" ? "already failed" : null,
          ended_at: new Date().toISOString(),
        });
        return {
          previousSessionId: previous.id,
          sourceWorkspaceId: sourceWorkspace.id,
          targetWorkspaceId: targetWorkspace.id,
        };
      })();
      database.close();
      const { previousSessionId, sourceWorkspaceId, targetWorkspaceId } =
        seeded;

      const seededServer = await createServer({ dbPath, logger: false });
      try {
        const requestedWorkspaceId =
          status === "completed" ? targetWorkspaceId : undefined;
        const payload: Record<string, unknown> = {
          initial_message: `Follow up after ${status}.`,
        };
        if (requestedWorkspaceId) payload.workspace_id = requestedWorkspaceId;

        const response = await seededServer.inject({
          method: "POST",
          url: `/api/v1/sessions/${previousSessionId}/follow-up`,
          payload,
        });
        expect(response.statusCode).toBe(200);
        const body = response.json();
        const followUpSessionId = body.session.id;
        const expectedWorkspaceId = requestedWorkspaceId ?? sourceWorkspaceId;

        expect(followUpSessionId).not.toBe(previousSessionId);
        expect(body.previous_session_id).toBe(previousSessionId);
        expect(body.previous_session.id).toBe(previousSessionId);
        expect(body.session).toMatchObject({
          id: followUpSessionId,
          previous_session_id: previousSessionId,
          workspace_id: expectedWorkspaceId,
          status: "awaiting_input",
        });
        expect(body.workspace.id).toBe(expectedWorkspaceId);
        expect(body.task_spec).toMatchObject({
          session_id: followUpSessionId,
          ref: "https://github.com/albert-zen/Codexhub/issues/23",
          title: "Terminal follow-up",
          intent: "Continue work without reviving a dead process.",
          scope: "Start a new session linked to the terminal source.",
          acceptance_criteria: "A new session records previous_session_id.",
          raw: "Terminal source task spec.",
        });
        expect(body.session.last_agent_message).toContain(
          `Follow up after ${status}.`,
        );

        const previous = await getFrom(
          seededServer,
          `/api/v1/sessions/${previousSessionId}`,
        );
        expect(previous.session).toMatchObject({
          id: previousSessionId,
          status,
          previous_session_id: null,
          process_pid: `pid-${status}`,
        });
        expect(previous.session.failure_reason).toBe(
          status === "failed" ? "already failed" : null,
        );

        const followUpMessages = await getFrom(
          seededServer,
          `/api/v1/sessions/${followUpSessionId}/messages`,
        );
        expect(followUpMessages.messages).toHaveLength(1);
        expect(followUpMessages.messages[0]).toMatchObject({
          session_id: followUpSessionId,
          mode: "initial",
          content: `Follow up after ${status}.`,
          status: "sent",
        });
      } finally {
        await seededServer.close();
      }
    },
  );

  it("merges follow-up task spec overrides field-by-field", async () => {
    const dbPath = join(tempDir, "follow-up-task-spec-merge.sqlite");
    const sourceTaskSpec = {
      ref: "https://github.com/albert-zen/Codexhub/issues/23",
      title: "Source task spec",
      intent: "Carry source intent into follow-up sessions.",
      scope: "Preserve source scope unless the follow-up overrides it.",
      acceptance_criteria: "Follow-up sessions inherit unspecified metadata.",
      raw: "Original task spec body.",
    };
    const database = openDatabase({ path: dbPath });
    const seeded = (() => {
      const repo = new HubRepository(database.db);
      const project = repo.createProject({
        name: "follow-up-task-spec-merge",
        default_codex_options: { fake: true },
      });
      const workspace = repo.createWorkspace({
        project_id: project.id,
        source_type: "local",
        path: join(tempDir, "follow-up-task-spec-merge-workspace"),
        cwd: join(tempDir, "follow-up-task-spec-merge-workspace"),
      });
      const previous = repo.createSession({
        project_id: project.id,
        workspace_id: workspace.id,
      });
      repo.createTaskSpec({
        session_id: previous.id,
        ...sourceTaskSpec,
      });
      repo.updateSession(previous.id, {
        status: "completed",
        process_pid: "pid-completed",
        ended_at: new Date().toISOString(),
      });
      return { previousSessionId: previous.id };
    })();
    database.close();

    const seededServer = await createServer({ dbPath, logger: false });
    try {
      let followUpCount = 0;
      async function startFollowUp(taskSpec?: unknown): Promise<any> {
        followUpCount += 1;
        const payload: Record<string, unknown> = {
          initial_message: `Follow up ${followUpCount}.`,
        };
        if (taskSpec !== undefined) payload.task_spec = taskSpec;

        const response = await seededServer.inject({
          method: "POST",
          url: `/api/v1/sessions/${seeded.previousSessionId}/follow-up`,
          payload,
        });
        expect(response.statusCode).toBe(200);
        return response.json();
      }

      const inherited = await startFollowUp();
      expect(inherited.task_spec).toMatchObject({
        session_id: inherited.session.id,
        ...sourceTaskSpec,
      });

      const partial = await startFollowUp({
        title: "Follow-up title override",
      });
      expect(partial.task_spec).toMatchObject({
        session_id: partial.session.id,
        ...sourceTaskSpec,
        title: "Follow-up title override",
      });

      const nullPreserved = await startFollowUp({
        ref: null,
        title: "Null fields are treated as omitted",
        acceptance_criteria: null,
      });
      expect(nullPreserved.task_spec).toMatchObject({
        session_id: nullPreserved.session.id,
        ...sourceTaskSpec,
        title: "Null fields are treated as omitted",
      });

      const fullTaskSpec = {
        ref: "docs/task-specs/follow-up.md",
        title: "Full follow-up override",
        intent: "Replace every source field.",
        scope: "Only the explicit override applies.",
        acceptance_criteria: "Full overrides still replace all fields.",
        raw: "Full override body.",
      };
      const full = await startFollowUp(fullTaskSpec);
      expect(full.task_spec).toMatchObject({
        session_id: full.session.id,
        ...fullTaskSpec,
      });
    } finally {
      await seededServer.close();
    }
  });

  it("rejects follow-up sessions from non-terminal source sessions", async () => {
    const project = await post("/api/v1/projects", {
      name: "active-follow-up-demo",
      default_workspace_root: tempDir,
    });
    const started = await createFakeSession(
      project.project.id,
      "active-follow-up",
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${started.session.id}/follow-up`,
      payload: {
        initial_message: "This must not start a new session.",
        codex_options: { fake: true },
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("session_not_terminal");

    const sessions = await get("/api/v1/sessions");
    expect(sessions.sessions).toHaveLength(1);
    expect(sessions.sessions[0].id).toBe(started.session.id);
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
    let sessionId: string;

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
      expect(stableLatest.last_agent_message).toBe("Previous complete answer.");
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

  it("repairs polluted latest projections from older stored agent deltas", async () => {
    const dbPath = join(tempDir, "polluted-latest.sqlite");
    const database = openDatabase({ path: dbPath });
    const repo = new HubRepository(database.db);
    const project = repo.createProject({ name: "polluted-latest-demo" });
    const workspace = repo.createWorkspace({
      project_id: project.id,
      source_type: "local",
      path: join(tempDir, "polluted-latest-workspace"),
      cwd: join(tempDir, "polluted-latest-workspace"),
    });
    const session = repo.createSession({
      project_id: project.id,
      workspace_id: workspace.id,
    });

    const completed = repo.appendItem(session.id, {
      method: "item/completed",
      params: {
        item: {
          id: "agent_previous",
          type: "agentMessage",
          text: "Recovered complete answer.",
        },
      },
    });
    const delta = repo.appendItem(session.id, {
      method: "item/agentMessage/delta",
      params: {
        itemId: "agent_current",
        textDelta: "Polluted draft.",
      },
    });
    repo.appendItem(session.id, {
      method: "turn/completed",
      params: { mode: "steer" },
    });
    database.db
      .prepare(
        `UPDATE worker_sessions
         SET last_agent_message_item_id = ?,
             last_agent_message = ?,
             last_agent_message_at = ?
         WHERE id = ?`,
      )
      .run(delta.id, "Polluted draft.", delta.created_at, session.id);
    database.close();

    const seeded = await createServer({ dbPath, logger: false });
    try {
      const latest = await getFrom(
        seeded,
        `/api/v1/sessions/${session.id}/latest`,
      );
      expect(latest.last_agent_message).toBe("Recovered complete answer.");
      expect(latest.item).toMatchObject({
        id: completed.id,
        type: "agentmessage",
        codex_method: "item/completed",
        text_excerpt: "Recovered complete answer.",
      });
      expect(latest.session).toMatchObject({
        last_agent_message_item_id: completed.id,
        last_agent_message: "Recovered complete answer.",
      });

      const latestAll = await getFrom(
        seeded,
        `/api/v1/sessions/${session.id}/latest?type=all`,
      );
      expect(latestAll.last_agent_message).toBe("Recovered complete answer.");
      expect(latestAll.item).toMatchObject({
        id: completed.id,
        type: "agentmessage",
        codex_method: "item/completed",
        text_excerpt: "Recovered complete answer.",
      });

      const rawLatestAgent = await getFrom(
        seeded,
        `/api/v1/sessions/${session.id}/items/latest?type=agentmessage`,
      );
      expect(rawLatestAgent.item).toMatchObject({
        id: delta.id,
        type: "agentmessage",
        codex_method: "item/agentMessage/delta",
        text_excerpt: "Polluted draft.",
      });

      const rawLatestAll = await getFrom(
        seeded,
        `/api/v1/sessions/${session.id}/items/latest?type=all`,
      );
      expect(rawLatestAll.item).toMatchObject({
        type: "state",
        codex_method: "turn/completed",
      });
    } finally {
      await seeded.close();
    }
  });

  it("ignores polluted latest projections when no completed agent message exists", async () => {
    const dbPath = join(tempDir, "polluted-latest-empty.sqlite");
    const database = openDatabase({ path: dbPath });
    const repo = new HubRepository(database.db);
    const project = repo.createProject({ name: "polluted-latest-empty-demo" });
    const workspace = repo.createWorkspace({
      project_id: project.id,
      source_type: "local",
      path: join(tempDir, "polluted-latest-empty-workspace"),
      cwd: join(tempDir, "polluted-latest-empty-workspace"),
    });
    const session = repo.createSession({
      project_id: project.id,
      workspace_id: workspace.id,
    });

    const delta = repo.appendItem(session.id, {
      method: "item/agentMessage/delta",
      params: {
        itemId: "agent_current",
        textDelta: "Polluted draft.",
      },
    });
    database.db
      .prepare(
        `UPDATE worker_sessions
         SET last_agent_message_item_id = ?,
             last_agent_message = ?,
             last_agent_message_at = ?
         WHERE id = ?`,
      )
      .run(delta.id, "Polluted draft.", delta.created_at, session.id);
    database.close();

    const seeded = await createServer({ dbPath, logger: false });
    try {
      const latest = await getFrom(
        seeded,
        `/api/v1/sessions/${session.id}/latest`,
      );
      expect(latest.last_agent_message).toBeNull();
      expect(latest.item).toBeNull();
      expect(latest.session).toMatchObject({
        last_agent_message_item_id: null,
        last_agent_message: null,
      });

      const latestAll = await getFrom(
        seeded,
        `/api/v1/sessions/${session.id}/latest?type=all`,
      );
      expect(latestAll.last_agent_message).toBeNull();
      expect(latestAll.item).toBeNull();

      const rawLatest = await getFrom(
        seeded,
        `/api/v1/sessions/${session.id}/items/latest?type=agentmessage`,
      );
      expect(rawLatest.item).toMatchObject({
        id: delta.id,
        type: "agentmessage",
        codex_method: "item/agentMessage/delta",
        text_excerpt: "Polluted draft.",
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

  it("preserves transient sessions when a runtime registry proves they are live", async () => {
    const dbPath = join(tempDir, "supervised-runtime.sqlite");
    const database = openDatabase({ path: dbPath });
    const repo = new HubRepository(database.db);
    const project = repo.createProject({ name: "supervised-runtime" });
    const workspace = repo.createWorkspace({
      project_id: project.id,
      source_type: "local",
      path: join(tempDir, "supervised-runtime-workspace"),
      cwd: join(tempDir, "supervised-runtime-workspace"),
    });
    const liveSession = repo.createSession({
      project_id: project.id,
      workspace_id: workspace.id,
    });
    repo.updateSession(liveSession.id, {
      status: "awaiting_input",
      codex_thread_id: "thread-live",
      codex_turn_id: "turn-live",
      codex_session_key: "thread-live-turn-live",
      process_pid: "supervisor-live",
    });
    const orphanSession = repo.createSession({
      project_id: project.id,
      workspace_id: workspace.id,
    });
    repo.updateSession(orphanSession.id, {
      status: "awaiting_input",
      codex_thread_id: "thread-orphan",
      codex_turn_id: "turn-orphan",
      codex_session_key: "thread-orphan-turn-orphan",
      process_pid: "supervisor-orphan",
    });
    database.close();

    const liveSessionIds = new Set([liveSession.id]);
    const restarted = await createServer({
      dbPath,
      logger: false,
      runtimeFactory: (runtimeRepo) =>
        new RegistryRuntime(runtimeRepo, liveSessionIds),
    });
    try {
      const live = await getFrom(
        restarted,
        `/api/v1/sessions/${liveSession.id}`,
      );
      expect(live.session).toMatchObject({
        id: liveSession.id,
        status: "awaiting_input",
        process_pid: "supervisor-live",
        failure_reason: null,
        ended_at: null,
      });

      const orphan = await getFrom(
        restarted,
        `/api/v1/sessions/${orphanSession.id}`,
      );
      expect(orphan.session.status).toBe("failed");
      expect(orphan.session.failure_reason).toContain("Server restarted");
      expect(orphan.session.process_pid).toBeNull();
      expect(orphan.session.ended_at).toEqual(expect.any(String));

      const response = await restarted.inject({
        method: "POST",
        url: `/api/v1/sessions/${liveSession.id}/messages`,
        payload: {
          mode: "continue",
          content: "Continue through the supervisor.",
          sender_type: "manager_agent",
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        message: {
          session_id: liveSession.id,
          mode: "continue",
          status: "sent",
          codex_request_id: "registry",
        },
        session: {
          id: liveSession.id,
          status: "running",
          process_pid: "supervisor-live",
        },
      });
    } finally {
      await restarted.close();
    }
  });

  it("persists unavailable fallback when a live registry loses a session at send time", async () => {
    const dbPath = join(tempDir, "supervised-send-unavailable.sqlite");
    const database = openDatabase({ path: dbPath });
    const repo = new HubRepository(database.db);
    const project = repo.createProject({ name: "supervised-send-unavailable" });
    const workspace = repo.createWorkspace({
      project_id: project.id,
      source_type: "local",
      path: join(tempDir, "supervised-send-unavailable-workspace"),
      cwd: join(tempDir, "supervised-send-unavailable-workspace"),
    });
    const session = repo.createSession({
      project_id: project.id,
      workspace_id: workspace.id,
    });
    repo.updateSession(session.id, {
      status: "awaiting_input",
      codex_thread_id: "thread-live-then-gone",
      codex_turn_id: "turn-live-then-gone",
      codex_session_key: "thread-live-then-gone-turn-live-then-gone",
      process_pid: "supervisor-live-then-gone",
    });
    database.close();

    const liveSessionIds = new Set([session.id]);
    const unavailableOnSendSessionIds = new Set([session.id]);
    const restarted = await createServer({
      dbPath,
      logger: false,
      runtimeFactory: (runtimeRepo) =>
        new RegistryRuntime(runtimeRepo, liveSessionIds, {
          unavailableOnSendSessionIds,
        }),
    });
    try {
      const preserved = await getFrom(
        restarted,
        `/api/v1/sessions/${session.id}`,
      );
      expect(preserved.session).toMatchObject({
        id: session.id,
        status: "awaiting_input",
        process_pid: "supervisor-live-then-gone",
      });

      const response = await restarted.inject({
        method: "POST",
        url: `/api/v1/sessions/${session.id}/messages`,
        payload: {
          mode: "continue",
          content: "Continue after supervisor reconnect.",
          sender_type: "manager_agent",
        },
      });
      const body = response.json();
      expect(response.statusCode).toBe(409);
      expect(body.error).toMatchObject({
        code: "session_process_unavailable",
        session_id: session.id,
        follow_up_available: true,
        follow_up_endpoint: `/api/v1/sessions/${session.id}/follow-up`,
      });

      const failed = await getFrom(restarted, `/api/v1/sessions/${session.id}`);
      expect(failed.session.status).toBe("failed");
      expect(failed.session.failure_reason).toContain(
        "start a follow-up session",
      );
      expect(failed.session.process_pid).toBeNull();
      expect(failed.session.ended_at).toEqual(expect.any(String));

      const messages = await getFrom(
        restarted,
        `/api/v1/sessions/${session.id}/messages`,
      );
      expect(messages.messages).toHaveLength(1);
      expect(messages.messages[0]).toMatchObject({
        mode: "continue",
        status: "failed",
        error: expect.stringContaining("live Codex app-server process"),
      });
    } finally {
      await restarted.close();
    }
  });

  it("keeps thread lifecycle readable when runtime ownership is unavailable", async () => {
    const dbPath = join(tempDir, "thread-send-unavailable.sqlite");
    const database = openDatabase({ path: dbPath });
    const repo = new HubRepository(database.db);
    const project = repo.createProject({ name: "thread-send-unavailable" });
    const workspace = repo.createWorkspace({
      project_id: project.id,
      source_type: "local",
      path: join(tempDir, "thread-send-unavailable-workspace"),
      cwd: join(tempDir, "thread-send-unavailable-workspace"),
    });
    const session = repo.createSession({
      project_id: project.id,
      workspace_id: workspace.id,
    });
    repo.updateSession(session.id, {
      status: "awaiting_input",
      codex_thread_id: "thread-readable",
      codex_turn_id: "turn-readable",
      codex_session_key: "thread-readable-turn-readable",
      process_pid: "runtime-that-disappeared",
    });
    database.close();

    const liveSessionIds = new Set([session.id]);
    const unavailableOnSendSessionIds = new Set([session.id]);
    const restarted = await createServer({
      dbPath,
      logger: false,
      runtimeFactory: (runtimeRepo) =>
        new RegistryRuntime(runtimeRepo, liveSessionIds, {
          unavailableOnSendSessionIds,
        }),
    });
    try {
      const response = await restarted.inject({
        method: "POST",
        url: `/api/v1/threads/${session.id}/messages`,
        payload: {
          content: "Try to continue without a visible resume button.",
          sender_type: "manager_agent",
        },
      });

      const body = response.json();
      expect(response.statusCode).toBe(409);
      expect(body.error).toMatchObject({
        code: "session_process_unavailable",
        session_id: session.id,
        retryable: true,
      });

      const inspected = await getFrom(
        restarted,
        `/api/v1/threads/${session.id}`,
      );
      expect(inspected.thread).toMatchObject({
        id: session.id,
        thread_state: "active",
        conversation_state: "ready",
      });
      expect(inspected.session).toMatchObject({
        status: "awaiting_input",
        process_pid: null,
        ended_at: null,
      });

      const messages = await getFrom(
        restarted,
        `/api/v1/sessions/${session.id}/messages`,
      );
      expect(messages.messages).toHaveLength(1);
      expect(messages.messages[0]).toMatchObject({
        mode: "continue",
        status: "failed",
        error: expect.stringContaining("live Codex app-server process"),
      });

      const context = await getFrom(
        restarted,
        `/api/v1/threads/${session.id}/context`,
      );
      expect(context.thread).toMatchObject({
        id: session.id,
        conversation_state: "failedToSend",
      });
      expect(context.attention_reasons).toContain("failed_to_send");
      expect(context.transcript).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source_id: messages.messages[0].id,
            message_status: "failed",
            text: "Try to continue without a visible resume button.",
          }),
        ]),
      );
    } finally {
      await restarted.close();
    }
  });

  it("continues a fake session through an external runtime supervisor across API server restart", async () => {
    const dbPath = join(tempDir, "external-runtime-supervisor.sqlite");
    const supervisor = await createRuntimeSupervisorServer({
      dbPath,
      logger: false,
    });
    await supervisor.listen({ host: "127.0.0.1", port: 0 });

    let api: App | null = await createServer({
      dbPath,
      logger: false,
      runtimeSupervisorUrl: listenedBaseUrl(supervisor),
    });

    try {
      const projectResponse = await api.inject({
        method: "POST",
        url: "/api/v1/projects",
        payload: {
          name: "external-supervisor",
          default_workspace_root: tempDir,
        },
      });
      expect(projectResponse.statusCode).toBe(200);
      const project = projectResponse.json().project;

      const workspaceResponse = await api.inject({
        method: "POST",
        url: "/api/v1/workspaces",
        payload: {
          project_id: project.id,
          source_type: "local",
          path: join(tempDir, "external-supervisor-workspace"),
        },
      });
      expect(workspaceResponse.statusCode).toBe(200);
      const workspace = workspaceResponse.json().workspace;

      const startResponse = await api.inject({
        method: "POST",
        url: "/api/v1/sessions",
        payload: {
          workspace_id: workspace.id,
          initial_message: "Start through the external supervisor.",
          sender_type: "manager_agent",
          codex_options: { fake: true },
        },
      });
      expect(startResponse.statusCode).toBe(200);
      const sessionId = startResponse.json().session.id;

      await api.close();
      api = null;

      api = await createServer({
        dbPath,
        logger: false,
        runtimeSupervisorUrl: listenedBaseUrl(supervisor),
      });

      const preserved = await getFrom(api, `/api/v1/sessions/${sessionId}`);
      expect(preserved.session).toMatchObject({
        id: sessionId,
        status: "awaiting_input",
        process_pid: "fake",
        failure_reason: null,
        ended_at: null,
      });

      const continueResponse = await api.inject({
        method: "POST",
        url: `/api/v1/sessions/${sessionId}/messages`,
        payload: {
          mode: "continue",
          content: "Continue after the API server restarted.",
          sender_type: "manager_agent",
        },
      });
      expect(continueResponse.statusCode).toBe(200);
      expect(continueResponse.json()).toMatchObject({
        message: {
          session_id: sessionId,
          mode: "continue",
          status: "sent",
          codex_request_id: "fake",
        },
        session: {
          id: sessionId,
          status: "awaiting_input",
          process_pid: "fake",
          last_agent_message:
            "Fake Codex worker received: Continue after the API server restarted.",
        },
      });
    } finally {
      if (api) await api.close();
      await supervisor.close();
    }
  });

  it("returns structured unavailable fallback when an external supervisor disappears before send", async () => {
    const dbPath = join(tempDir, "external-supervisor-unavailable.sqlite");
    const supervisor = await createRuntimeSupervisorServer({
      dbPath,
      logger: false,
    });
    await supervisor.listen({ host: "127.0.0.1", port: 0 });
    const runtimeSupervisorUrl = listenedBaseUrl(supervisor);
    let supervisorClosed = false;

    const api = await createServer({
      dbPath,
      logger: false,
      runtimeSupervisorUrl,
    });

    try {
      const projectResponse = await api.inject({
        method: "POST",
        url: "/api/v1/projects",
        payload: {
          name: "external-supervisor-unavailable",
          default_workspace_root: tempDir,
        },
      });
      expect(projectResponse.statusCode).toBe(200);
      const project = projectResponse.json().project;

      const workspaceResponse = await api.inject({
        method: "POST",
        url: "/api/v1/workspaces",
        payload: {
          project_id: project.id,
          source_type: "local",
          path: join(tempDir, "external-supervisor-unavailable-workspace"),
        },
      });
      expect(workspaceResponse.statusCode).toBe(200);
      const workspace = workspaceResponse.json().workspace;

      const startResponse = await api.inject({
        method: "POST",
        url: "/api/v1/sessions",
        payload: {
          workspace_id: workspace.id,
          initial_message: "Start before the supervisor exits.",
          sender_type: "manager_agent",
          codex_options: { fake: true },
        },
      });
      expect(startResponse.statusCode).toBe(200);
      const sessionId = startResponse.json().session.id;

      await supervisor.close();
      supervisorClosed = true;

      const response = await api.inject({
        method: "POST",
        url: `/api/v1/sessions/${sessionId}/messages`,
        payload: {
          mode: "continue",
          content: "Try to continue after supervisor exit.",
          sender_type: "manager_agent",
        },
      });
      const body = response.json();
      expect(response.statusCode).toBe(409);
      expect(body.error).toMatchObject({
        code: "session_process_unavailable",
        session_id: sessionId,
        follow_up_available: true,
        follow_up_endpoint: `/api/v1/sessions/${sessionId}/follow-up`,
      });
      expect(body.error.message).toContain("runtime supervisor is unavailable");

      const failed = await getFrom(api, `/api/v1/sessions/${sessionId}`);
      expect(failed.session.status).toBe("failed");
      expect(failed.session.failure_reason).toContain(
        "runtime supervisor is unavailable",
      );
      expect(failed.session.process_pid).toBeNull();
      expect(failed.session.ended_at).toEqual(expect.any(String));
    } finally {
      await api.close();
      if (!supervisorClosed) await supervisor.close();
    }
  });

  it("treats invalid successful supervisor responses as upstream failures", async () => {
    const invalidSupervisor = Fastify({ logger: false });
    invalidSupervisor.post("/runtime/sessions/start", async (_request, reply) =>
      reply.type("text/plain").send("not json"),
    );
    await invalidSupervisor.listen({ host: "127.0.0.1", port: 0 });

    const api = await createServer({
      dbPath: join(tempDir, "invalid-supervisor-response.sqlite"),
      logger: false,
      runtimeSupervisorUrl: listenedBaseUrl(invalidSupervisor),
    });

    try {
      const projectResponse = await api.inject({
        method: "POST",
        url: "/api/v1/projects",
        payload: {
          name: "invalid-supervisor-response",
          default_workspace_root: tempDir,
        },
      });
      expect(projectResponse.statusCode).toBe(200);
      const project = projectResponse.json().project;

      const workspaceResponse = await api.inject({
        method: "POST",
        url: "/api/v1/workspaces",
        payload: {
          project_id: project.id,
          source_type: "local",
          path: join(tempDir, "invalid-supervisor-response-workspace"),
        },
      });
      expect(workspaceResponse.statusCode).toBe(200);
      const workspace = workspaceResponse.json().workspace;

      const startResponse = await api.inject({
        method: "POST",
        url: "/api/v1/sessions",
        payload: {
          workspace_id: workspace.id,
          initial_message: "Start against invalid supervisor response.",
          sender_type: "manager_agent",
          codex_options: { fake: true },
        },
      });
      expect(startResponse.statusCode).toBe(502);
      expect(startResponse.json().error).toMatchObject({
        code: "runtime_supervisor_unavailable",
      });
      expect(startResponse.json().error.message).toContain("invalid JSON");
    } finally {
      await api.close();
      await invalidSupervisor.close();
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
        expect(body.error).toMatchObject({
          session_id: sessionId,
          follow_up_available: true,
          follow_up_endpoint: `/api/v1/sessions/${sessionId}/follow-up`,
        });

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

        const followUp = await instance.inject({
          method: "POST",
          url: body.error.follow_up_endpoint,
          payload: {
            initial_message: "Continue in a fresh worker.",
            sender_type: "manager_agent",
            codex_options: { fake: true },
          },
        });
        expect(followUp.statusCode).toBe(200);
        const followUpBody = followUp.json();
        expect(followUpBody).toMatchObject({
          previous_session_id: sessionId,
          session: {
            previous_session_id: sessionId,
            status: "awaiting_input",
          },
        });
        expect(followUpBody.session.id).not.toBe(sessionId);
      } finally {
        await instance.close();
      }
    },
  );
});

class RegistryRuntime implements CodexRuntimeController {
  constructor(
    private readonly repo: HubRepository,
    private readonly liveSessionIds: Set<string>,
    private readonly options: {
      unavailableOnStartSessionIds?: Set<string>;
      unavailableOnSendSessionIds?: Set<string>;
    } = {},
  ) {}

  hasLiveSession(session: WorkerSession): boolean {
    return this.liveSessionIds.has(session.id);
  }

  async startSession(
    session: WorkerSession,
    _workspace: Workspace,
    options: StartOptions,
  ): Promise<WorkerSession> {
    if (this.options.unavailableOnStartSessionIds?.has(session.id)) {
      this.repo.updateSession(session.id, {
        status: "failed",
        process_pid: null,
        failure_reason:
          "session does not have a live Codex app-server process in this server process; start a follow-up session",
        ended_at: new Date().toISOString(),
      });
      throw new SessionProcessUnavailableError(session.id);
    }
    this.repo.markMessageSent(options.initialMessage.id, "registry-start");
    return session;
  }

  async sendMessage(
    session: WorkerSession,
    _workspace: Workspace,
    options: SendOptions,
  ): Promise<WorkerSession> {
    if (this.options.unavailableOnSendSessionIds?.has(session.id)) {
      throw new SessionProcessUnavailableError(session.id);
    }
    if (!this.hasLiveSession(session)) {
      throw new SessionProcessUnavailableError(session.id);
    }
    this.repo.markMessageSent(options.message.id, "registry");
    return this.repo.updateSession(session.id, { status: "running" });
  }

  async resumeSession(
    session: WorkerSession,
    _workspace: Workspace,
  ): Promise<WorkerSession> {
    if (!session.codex_thread_id) {
      throw new SessionProcessUnavailableError(session.id);
    }
    this.liveSessionIds.add(session.id);
    return this.repo.updateSession(session.id, {
      status: "awaiting_input",
      process_pid: "registry-resumed",
      ended_at: null,
    });
  }

  stopSession(sessionId: string): void {
    this.liveSessionIds.delete(sessionId);
    this.repo.updateSession(sessionId, {
      status: "stopped",
      ended_at: new Date().toISOString(),
    });
  }

  completeSession(sessionId: string): WorkerSession {
    this.liveSessionIds.delete(sessionId);
    return this.repo.updateSession(sessionId, {
      status: "completed",
      ended_at: new Date().toISOString(),
    });
  }

  shutdownAll(): Promise<void> {
    return Promise.resolve();
  }
}

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

function listenedBaseUrl(instance: {
  server: { address(): string | AddressInfo | null };
}): string {
  const address = instance.server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected supervisor to listen on a TCP address");
  }
  return `http://127.0.0.1:${address.port}`;
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
