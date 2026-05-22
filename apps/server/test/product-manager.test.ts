import { randomUUID } from "node:crypto";
import type { Message, WorkerSession, Workspace } from "@codexhub/core";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type CodexHubDatabase } from "../src/database.js";
import { ProductManager } from "../src/product-manager.js";
import { HubRepository } from "../src/repository.js";
import {
  SessionProcessUnavailableError,
  type CodexRuntimeController,
  type SendOptions,
  type StartOptions,
} from "../src/runtime.js";

let database: CodexHubDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe("ProductManager", () => {
  it("starts workers with persisted initial messages and task specs", async () => {
    const { manager, repo, runtime } = setup();
    const { project, workspace } = seedProjectWorkspace(repo, {
      defaultCodexOptions: { fake: true },
    });

    const result = await manager.startWorker({
      workspaceId: workspace.id,
      prompt: "Implement the product manager module.",
      taskSpec: {
        ref: "AR-02",
        title: "Product Manager module",
        intent: "Move lifecycle orchestration out of HTTP routes.",
      },
      senderType: "manager_agent",
      senderId: "mgr_1",
    });

    expect(result.workspace.id).toBe(workspace.id);
    expect(result.session).toMatchObject({
      project_id: project.id,
      workspace_id: workspace.id,
      status: "awaiting_input",
    });
    expect(runtime.starts).toHaveLength(1);
    expect(runtime.starts[0]).toMatchObject({
      workspaceId: workspace.id,
      codexOptions: { fake: true },
      initialMessage: {
        content: "Implement the product manager module.",
        sender_type: "manager_agent",
        sender_id: "mgr_1",
      },
    });
    expect(repo.listMessages(result.session.id)[0]).toMatchObject({
      mode: "initial",
      status: "sent",
      content: "Implement the product manager module.",
    });
    expect(repo.getTaskSpec(result.session.id)).toMatchObject({
      session_id: result.session.id,
      ref: "AR-02",
      title: "Product Manager module",
      intent: "Move lifecycle orchestration out of HTTP routes.",
    });
  });

  it("starts follow-up workers from terminal sessions with merged task specs", async () => {
    const { manager, repo, runtime } = setup();
    const { project, workspace } = seedProjectWorkspace(repo);
    const previous = repo.createSession({
      project_id: project.id,
      workspace_id: workspace.id,
    });
    repo.createTaskSpec({
      session_id: previous.id,
      ref: "AR-02",
      title: "Original title",
      intent: "Preserve inherited task context.",
      scope: "Original scope.",
      acceptance_criteria: "Original criteria.",
      raw: "Original task spec.",
    });
    repo.updateSession(previous.id, {
      status: "completed",
      ended_at: new Date().toISOString(),
    });

    const result = await manager.startFollowUpWorker({
      previousSessionReference: previous.id,
      prompt: "Continue in a fresh worker.",
      taskSpec: {
        title: "Follow-up title",
      },
      senderType: "manager_agent",
    });

    expect(result.previous_session_id).toBe(previous.id);
    expect(result.previous_session.id).toBe(previous.id);
    expect(result.session).toMatchObject({
      previous_session_id: previous.id,
      workspace_id: workspace.id,
      status: "awaiting_input",
    });
    expect(result.task_spec).toMatchObject({
      session_id: result.session.id,
      ref: "AR-02",
      title: "Follow-up title",
      intent: "Preserve inherited task context.",
      scope: "Original scope.",
    });
    expect(runtime.starts[0]?.initialMessage).toMatchObject({
      session_id: result.session.id,
      mode: "initial",
      content: "Continue in a fresh worker.",
    });
  });

  it("sends worker messages through runtime and returns the persisted message", async () => {
    const { manager, repo, runtime } = setup();
    const { project, workspace } = seedProjectWorkspace(repo);
    const session = repo.createSession({
      project_id: project.id,
      workspace_id: workspace.id,
    });
    repo.updateSession(session.id, { status: "awaiting_input" });

    const result = await manager.sendWorkerMessage({
      sessionReference: session.id,
      mode: "continue",
      content: "Please continue.",
      senderType: "human",
    });

    expect(runtime.sends).toHaveLength(1);
    expect(runtime.sends[0]).toMatchObject({
      sessionId: session.id,
      workspaceId: workspace.id,
      message: {
        mode: "continue",
        content: "Please continue.",
        sender_type: "human",
      },
    });
    expect(result.message).toMatchObject({
      session_id: session.id,
      mode: "continue",
      status: "sent",
      codex_request_id: "fake-send",
    });
    expect(result.session).toMatchObject({
      id: session.id,
      status: "running",
    });
  });

  it("reuses an existing message for duplicate idempotent sends", async () => {
    const { manager, repo, runtime } = setup();
    const { project, workspace } = seedProjectWorkspace(repo);
    const session = repo.createSession({
      project_id: project.id,
      workspace_id: workspace.id,
    });
    repo.updateSession(session.id, { status: "awaiting_input" });

    const first = await manager.sendWorkerMessage({
      sessionReference: session.id,
      mode: "continue",
      content: "Please continue.",
      senderType: "human",
      idempotencyKey: "retry-key",
    });
    const second = await manager.sendWorkerMessage({
      sessionReference: session.id,
      mode: "continue",
      content: "Please continue.",
      senderType: "human",
      idempotencyKey: "retry-key",
    });

    expect(first.message.id).toBe(second.message.id);
    expect(repo.listMessages(session.id)).toHaveLength(1);
    expect(runtime.sends).toHaveLength(1);
  });

  it("rejects overlapping non-idempotent sends with a machine-readable error", async () => {
    const { manager, repo, runtime } = setup();
    const { project, workspace } = seedProjectWorkspace(repo);
    const session = repo.createSession({
      project_id: project.id,
      workspace_id: workspace.id,
    });
    repo.updateSession(session.id, { status: "awaiting_input" });
    runtime.blockSendSessionIds.add(session.id);

    const firstSend = manager.sendWorkerMessage({
      sessionReference: session.id,
      mode: "continue",
      content: "Please continue.",
      senderType: "human",
    });

    await expect(
      manager.sendWorkerMessage({
        sessionReference: session.id,
        mode: "continue",
        content: "Overlapping send.",
        senderType: "human",
      }),
    ).rejects.toMatchObject({
      code: "thread_turn_in_progress",
      details: { session_id: session.id },
    });

    runtime.unblockSend(session.id);
    await firstSend;
    expect(runtime.sends).toHaveLength(1);
  });

  it("rejects empty thread messages before creating a persisted message", async () => {
    const { manager, repo, runtime } = setup();
    const { project, workspace } = seedProjectWorkspace(repo);
    const session = repo.createSession({
      project_id: project.id,
      workspace_id: workspace.id,
    });

    await expect(
      manager.sendWorkerMessage({
        sessionReference: session.id,
        mode: "initial",
        content: "   ",
        senderType: "human",
        ensureRuntimeReady: true,
        keepThreadReadableOnRuntimeUnavailable: true,
      }),
    ).rejects.toMatchObject({
      code: "message_required",
    });

    expect(runtime.starts).toHaveLength(0);
    expect(repo.listMessages(session.id)).toHaveLength(0);
  });

  it("stops and completes workers by resolved session reference", async () => {
    const { manager, repo, runtime } = setup();
    const { project, workspace } = seedProjectWorkspace(repo);
    const stopTarget = repo.createSession({
      project_id: project.id,
      workspace_id: workspace.id,
    });
    const completeTarget = repo.createSession({
      project_id: project.id,
      workspace_id: workspace.id,
    });

    const stopped = await manager.stopWorker(stopTarget.id);
    const completed = await manager.completeWorker(completeTarget.id);

    expect(stopped.status).toBe("stopped");
    expect(completed.status).toBe("completed");
    expect(runtime.stoppedSessionIds).toEqual([stopTarget.id]);
    expect(runtime.completedSessionIds).toEqual([completeTarget.id]);
  });

  it("persists failed send state when runtime ownership is unavailable", async () => {
    const { manager, repo, runtime } = setup();
    const { project, workspace } = seedProjectWorkspace(repo);
    const session = repo.createSession({
      project_id: project.id,
      workspace_id: workspace.id,
    });
    repo.updateSession(session.id, {
      status: "awaiting_input",
      process_pid: "lost-process",
    });
    runtime.unavailableOnSendSessionIds.add(session.id);

    await expect(
      manager.sendWorkerMessage({
        sessionReference: session.id,
        mode: "continue",
        content: "Continue after restart.",
        senderType: "manager_agent",
      }),
    ).rejects.toMatchObject({
      code: "session_process_unavailable",
      details: {
        session_id: session.id,
        follow_up_available: true,
      },
    });

    expect(repo.getSession(session.id)).toMatchObject({
      status: "failed",
      process_pid: null,
      failure_reason: expect.stringContaining("live Codex app-server process"),
    });
    expect(repo.listMessages(session.id)[0]).toMatchObject({
      mode: "continue",
      status: "failed",
      error: expect.stringContaining("live Codex app-server process"),
    });
  });

  it("resumes a detached runtime before sending", async () => {
    const { manager, repo, runtime } = setup();
    const { project, workspace } = seedProjectWorkspace(repo);
    const session = repo.createSession({
      project_id: project.id,
      workspace_id: workspace.id,
    });
    repo.updateSession(session.id, {
      status: "awaiting_input",
      codex_thread_id: "thread-detached",
      process_pid: "stale",
    });
    runtime.detachedSessionIds.add(session.id);

    const result = await manager.sendWorkerMessage({
      sessionReference: session.id,
      mode: "continue",
      content: "Continue after detach.",
      senderType: "manager_agent",
      ensureRuntimeReady: true,
    });

    expect(runtime.resumes).toEqual([
      { sessionId: session.id, workspaceId: workspace.id },
    ]);
    expect(runtime.sends).toHaveLength(1);
    expect(result.message.status).toBe("sent");
  });

  it("resumes an exited thread before sending without requiring follow-up", async () => {
    const { manager, repo, runtime } = setup();
    const { project, workspace } = seedProjectWorkspace(repo);
    const session = repo.createSession({
      project_id: project.id,
      workspace_id: workspace.id,
    });
    repo.updateSession(session.id, {
      status: "completed",
      codex_thread_id: "thread-completed",
      process_pid: null,
      ended_at: new Date().toISOString(),
    });
    runtime.detachedSessionIds.add(session.id);

    const result = await manager.sendWorkerMessage({
      sessionReference: session.id,
      mode: "continue",
      content: "Continue the completed thread.",
      senderType: "manager_agent",
      ensureRuntimeReady: true,
      keepThreadReadableOnRuntimeUnavailable: true,
    });

    expect(runtime.resumes).toEqual([
      { sessionId: session.id, workspaceId: workspace.id },
    ]);
    expect(runtime.sends).toHaveLength(1);
    expect(result.message.status).toBe("sent");
  });

  it("keeps a thread readable when automatic resume fails before send", async () => {
    const { manager, repo, runtime } = setup();
    const { project, workspace } = seedProjectWorkspace(repo);
    const session = repo.createSession({
      project_id: project.id,
      workspace_id: workspace.id,
    });
    repo.updateSession(session.id, {
      status: "awaiting_input",
      codex_thread_id: "thread-resume-fails",
      process_pid: "stale",
    });
    runtime.detachedSessionIds.add(session.id);
    runtime.unavailableOnResumeSessionIds.add(session.id);

    await expect(
      manager.sendWorkerMessage({
        sessionReference: session.id,
        mode: "continue",
        content: "Continue after detached runtime.",
        senderType: "manager_agent",
        ensureRuntimeReady: true,
        keepThreadReadableOnRuntimeUnavailable: true,
      }),
    ).rejects.toMatchObject({
      code: "session_process_unavailable",
      details: {
        session_id: session.id,
        follow_up_available: false,
        retryable: true,
      },
    });

    expect(runtime.resumes).toEqual([
      { sessionId: session.id, workspaceId: workspace.id },
    ]);
    expect(runtime.sends).toHaveLength(0);
    expect(repo.getSession(session.id)).toMatchObject({
      status: "awaiting_input",
      process_pid: null,
      failure_reason: null,
    });
    expect(repo.listMessages(session.id)[0]).toMatchObject({
      mode: "continue",
      status: "failed",
      error: expect.stringContaining("live Codex app-server process"),
    });
  });

  it("keeps an empty thread retryable when first runtime start fails", async () => {
    const { manager, repo, runtime } = setup();
    const { project, workspace } = seedProjectWorkspace(repo);
    const session = repo.createSession({
      project_id: project.id,
      workspace_id: workspace.id,
    });
    runtime.unavailableOnStartSessionIds.add(session.id);

    await expect(
      manager.sendWorkerMessage({
        sessionReference: session.id,
        mode: "continue",
        content: "Start this thread.",
        senderType: "manager_agent",
        ensureRuntimeReady: true,
        keepThreadReadableOnRuntimeUnavailable: true,
        idempotencyKey: "start-retry-key",
      }),
    ).rejects.toMatchObject({
      code: "session_process_unavailable",
      details: {
        session_id: session.id,
        follow_up_available: false,
        retryable: true,
      },
    });

    expect(repo.getSession(session.id)).toMatchObject({
      status: "starting",
      codex_thread_id: null,
      process_pid: null,
      failure_reason: null,
      started_at: null,
      ended_at: null,
    });
    expect(repo.listMessages(session.id)[0]).toMatchObject({
      mode: "initial",
      status: "failed",
      content: "Start this thread.",
      error: expect.stringContaining("live Codex app-server process"),
    });

    runtime.unavailableOnStartSessionIds.delete(session.id);
    const retry = await manager.sendWorkerMessage({
      sessionReference: session.id,
      mode: "continue",
      content: "Retry this thread.",
      senderType: "manager_agent",
      ensureRuntimeReady: true,
      keepThreadReadableOnRuntimeUnavailable: true,
      idempotencyKey: "start-retry-key",
    });

    expect(retry.message).toMatchObject({
      mode: "initial",
      status: "sent",
      content: "Retry this thread.",
    });
    expect(repo.listMessages(session.id)).toHaveLength(2);
  });

  it("rejects a new continue while a thread turn is already running", async () => {
    const { manager, repo, runtime } = setup();
    const { project, workspace } = seedProjectWorkspace(repo);
    const session = repo.createSession({
      project_id: project.id,
      workspace_id: workspace.id,
    });
    repo.updateSession(session.id, {
      status: "running",
      codex_thread_id: "thread-running",
      process_pid: "pid-running",
    });

    await expect(
      manager.sendWorkerMessage({
        sessionReference: session.id,
        mode: "continue",
        content: "Start another turn.",
        senderType: "manager_agent",
        ensureRuntimeReady: true,
        keepThreadReadableOnRuntimeUnavailable: true,
      }),
    ).rejects.toMatchObject({
      code: "thread_turn_in_progress",
      details: { session_id: session.id },
    });

    expect(runtime.sends).toHaveLength(0);
    expect(repo.listMessages(session.id)).toHaveLength(0);
  });
});

function setup(): {
  manager: ProductManager;
  repo: HubRepository;
  runtime: FakeRuntime;
} {
  database = openDatabase({ path: ":memory:" });
  const repo = new HubRepository(database.db);
  const runtime = new FakeRuntime(repo);
  return {
    manager: new ProductManager({ repo, runtime }),
    repo,
    runtime,
  };
}

function seedProjectWorkspace(
  repo: HubRepository,
  options: { defaultCodexOptions?: unknown } = {},
) {
  const project = repo.createProject({
    name: `project-${randomUUID()}`,
    default_codex_options: options.defaultCodexOptions,
  });
  const workspace = repo.createWorkspace({
    project_id: project.id,
    source_type: "local",
    path: `D:\\tmp\\${project.id}`,
    cwd: `D:\\tmp\\${project.id}`,
  });
  return { project, workspace };
}

class FakeRuntime implements CodexRuntimeController {
  readonly starts: Array<{
    sessionId: string;
    workspaceId: string;
    initialMessage: Message;
    codexOptions: unknown;
  }> = [];
  readonly sends: Array<{
    sessionId: string;
    workspaceId: string;
    message: Message;
  }> = [];
  readonly stoppedSessionIds: string[] = [];
  readonly completedSessionIds: string[] = [];
  readonly detachedSessionIds = new Set<string>();
  readonly resumes: Array<{ sessionId: string; workspaceId: string }> = [];
  readonly unavailableOnStartSessionIds = new Set<string>();
  readonly unavailableOnSendSessionIds = new Set<string>();
  readonly unavailableOnResumeSessionIds = new Set<string>();
  readonly blockSendSessionIds = new Set<string>();
  private readonly blockedSends = new Map<string, () => void>();

  constructor(private readonly repo: HubRepository) {}

  hasLiveSession(session: WorkerSession): boolean {
    return !this.detachedSessionIds.has(session.id);
  }

  async startSession(
    session: WorkerSession,
    workspace: Workspace,
    options: StartOptions,
  ): Promise<WorkerSession> {
    if (this.unavailableOnStartSessionIds.has(session.id)) {
      this.repo.updateSession(session.id, {
        status: "failed",
        process_pid: null,
        failure_reason:
          "session does not have a live Codex app-server process in this server process; start a follow-up session",
        ended_at: new Date().toISOString(),
      });
      throw new SessionProcessUnavailableError(session.id);
    }
    this.starts.push({
      sessionId: session.id,
      workspaceId: workspace.id,
      initialMessage: options.initialMessage,
      codexOptions: options.codexOptions,
    });
    this.repo.markMessageSent(options.initialMessage.id, "fake-start");
    return this.repo.updateSession(session.id, {
      status: "awaiting_input",
      process_pid: "fake",
      started_at: new Date().toISOString(),
    });
  }

  async sendMessage(
    session: WorkerSession,
    workspace: Workspace,
    options: SendOptions,
  ): Promise<WorkerSession> {
    if (this.unavailableOnSendSessionIds.has(session.id)) {
      throw new SessionProcessUnavailableError(session.id);
    }
    if (this.detachedSessionIds.has(session.id)) {
      throw new SessionProcessUnavailableError(session.id);
    }
    this.sends.push({
      sessionId: session.id,
      workspaceId: workspace.id,
      message: options.message,
    });
    if (this.blockSendSessionIds.has(session.id)) {
      await new Promise<void>((resolve) => {
        this.blockedSends.set(session.id, resolve);
      });
    }
    this.repo.markMessageSent(options.message.id, "fake-send");
    return this.repo.updateSession(session.id, {
      status: "running",
    });
  }

  unblockSend(sessionId: string): void {
    this.blockSendSessionIds.delete(sessionId);
    this.blockedSends.get(sessionId)?.();
    this.blockedSends.delete(sessionId);
  }

  async resumeSession(
    session: WorkerSession,
    workspace: Workspace,
  ): Promise<WorkerSession> {
    this.resumes.push({ sessionId: session.id, workspaceId: workspace.id });
    if (this.unavailableOnResumeSessionIds.has(session.id)) {
      throw new SessionProcessUnavailableError(session.id);
    }
    if (!session.codex_thread_id) {
      throw new SessionProcessUnavailableError(session.id);
    }
    this.detachedSessionIds.delete(session.id);
    return this.repo.updateSession(session.id, {
      status: "awaiting_input",
      process_pid: "resumed",
      ended_at: null,
    });
  }

  stopSession(sessionId: string): void {
    this.stoppedSessionIds.push(sessionId);
    this.repo.updateSession(sessionId, {
      status: "stopped",
      ended_at: new Date().toISOString(),
    });
  }

  completeSession(sessionId: string): WorkerSession {
    this.completedSessionIds.push(sessionId);
    return this.repo.updateSession(sessionId, {
      status: "completed",
      ended_at: new Date().toISOString(),
    });
  }

  shutdownAll(): Promise<void> {
    return Promise.resolve();
  }
}
