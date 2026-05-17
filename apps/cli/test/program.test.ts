import { describe, expect, it } from "vitest";
import { buildUrl } from "../src/api.js";
import { createProgram, type CliEnvironment } from "../src/program.js";

describe("buildUrl", () => {
  it("normalizes the base URL and omits empty query values", () => {
    expect(
      buildUrl("http://127.0.0.1:4317/", "/sessions", {
        status: "running",
        cursor: "",
        limit: 20,
      }),
    ).toBe("http://127.0.0.1:4317/sessions?status=running&limit=20");
  });
});

describe("codexhub commands", () => {
  it("creates projects with snake_case API payloads", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const output: string[] = [];
    const program = createProgram({
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return jsonResponse({ id: "proj_1", name: "Demo" });
      },
      stdout: (text) => output.push(text),
    });

    await program.parseAsync([
      "node",
      "codexhub",
      "--api",
      "http://api.test",
      "project",
      "create",
      "--name",
      "Demo",
      "--repo-url",
      "https://example.test/repo.git",
      "--json",
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("http://api.test/projects");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      name: "Demo",
      default_repo_url: "https://example.test/repo.git",
    });
    expect(JSON.parse(output.join(""))).toEqual({ id: "proj_1", name: "Demo" });
  });

  it("lists sessions with filters and concise human output", async () => {
    const calls: string[] = [];
    const output: string[] = [];
    const program = createProgram({
      fetch: async (url) => {
        calls.push(String(url));
        return jsonResponse({
          items: [
            {
              id: "sess_1",
              status: "awaiting_input",
              workspace_id: "work_1",
              last_agent_message: "Ready for the next instruction.",
            },
          ],
          next_cursor: null,
          limit: 20,
        });
      },
      stdout: (text) => output.push(text),
    });

    await program.parseAsync([
      "node",
      "codexhub",
      "--api",
      "http://api.test/",
      "sessions",
      "list",
      "--project",
      "proj_1",
      "--status",
      "awaiting_input",
      "--limit",
      "20",
    ]);

    expect(calls).toEqual([
      "http://api.test/sessions?project_id=proj_1&status=awaiting_input&limit=20",
    ]);
    expect(output.join("").trim()).toBe(
      'sess_1 awaiting_input workspace=work_1 latest="Ready for the next instruction."',
    );
  });

  it("starts sessions with task spec metadata", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const program = createProgram({
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return jsonResponse({ session: { id: "sess_1", status: "starting" } });
      },
      stdout: () => undefined,
    });

    await program.parseAsync([
      "node",
      "codexhub",
      "--api",
      "http://api.test",
      "session",
      "start",
      "--project",
      "proj_1",
      "--workspace",
      "work_1",
      "--task-spec-ref",
      "docs/task-specs/demo.md",
      "--task-spec-title",
      "Demo task",
      "--task-spec-intent",
      "Prove metadata capture.",
      "Start from this spec.",
    ]);

    expect(calls[0]?.url).toBe("http://api.test/sessions");
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      project_id: "proj_1",
      workspace_id: "work_1",
      initial_message: "Start from this spec.",
      task_spec: {
        ref: "docs/task-specs/demo.md",
        title: "Demo task",
        intent: "Prove metadata capture.",
      },
    });
  });

  it("sends follow-up messages", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const program = createProgram({
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return jsonResponse({ id: "msg_1", status: "queued" });
      },
      stdout: () => undefined,
    });

    await program.parseAsync([
      "node",
      "codexhub",
      "--api",
      "http://api.test",
      "session",
      "send",
      "sess_1",
      "--mode",
      "continue",
      "keep",
      "going",
    ]);

    expect(calls[0]?.url).toBe("http://api.test/sessions/sess_1/messages");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      mode: "continue",
      content: "keep going",
      sender_type: "human",
    });
  });

  it("cleans up workspaces with explicit file deletion opt-in", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const output: string[] = [];
    const program = createProgram({
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return jsonResponse({
          workspace: { id: "work_1", status: "deleted" },
          cleanup: { deleted_files: true },
        });
      },
      stdout: (text) => output.push(text),
    });

    await program.parseAsync([
      "node",
      "codexhub",
      "--api",
      "http://api.test",
      "workspace",
      "cleanup",
      "work_1",
      "--delete-files",
    ]);

    expect(calls[0]?.url).toBe("http://api.test/workspaces/work_1/cleanup");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      delete_files: true,
    });
    expect(output.join("").trim()).toBe(
      "Workspace work_1 deleted; files deleted",
    );
  });

  it("sets review-gate status metadata", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const output: string[] = [];
    const program = createProgram({
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return jsonResponse({
          review_status: {
            session_id: "sess_1",
            implementation_done: true,
            self_validation_done: true,
            review_requested: true,
            review_addressed: false,
            ready_for_human_review: false,
            note: "Ready for review.",
          },
        });
      },
      stdout: (text) => output.push(text),
    });

    await program.parseAsync([
      "node",
      "codexhub",
      "--api",
      "http://api.test",
      "session",
      "review-status",
      "set",
      "sess_1",
      "--implementation-done",
      "--self-validation-done",
      "--review-requested",
      "--note",
      "Ready for review.",
    ]);

    expect(calls[0]?.url).toBe("http://api.test/sessions/sess_1/review-status");
    expect(calls[0]?.init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      implementation_done: true,
      self_validation_done: true,
      review_requested: true,
      note: "Ready for review.",
    });
    expect(output.join("").trim()).toContain("implementation_done=yes");
    expect(output.join("").trim()).toContain("note: Ready for review.");
  });

  it("prints readable recent traces with bounded item windows", async () => {
    const calls: string[] = [];
    const output: string[] = [];
    const program = createProgram({
      fetch: async (url) => {
        const text = String(url);
        calls.push(text);
        if (text.endsWith("/sessions/sess_1/messages")) {
          return jsonResponse({
            items: [
              {
                id: "msg_1",
                mode: "initial",
                sender_type: "manager_agent",
                content: "Inspect the repo.",
                created_at: "2026-01-01T00:00:00.000Z",
              },
            ],
          });
        }
        return jsonResponse({
          items: [
            {
              id: "item_1",
              sequence: 1,
              type: "agentmessage",
              codex_item_id: "agent_1",
              codex_method: "item/agentMessage/delta",
              text_excerpt: "Ready",
              created_at: "2026-01-01T00:00:01.000Z",
            },
            {
              id: "item_2",
              sequence: 2,
              type: "agentmessage",
              codex_item_id: "agent_1",
              codex_method: "item/agentMessage/delta",
              text_excerpt: " now.",
              created_at: "2026-01-01T00:00:02.000Z",
            },
          ],
        });
      },
      stdout: (text) => output.push(text),
    });

    await program.parseAsync([
      "node",
      "codexhub",
      "--api",
      "http://api.test",
      "session",
      "trace",
      "sess_1",
    ]);

    expect(calls).toEqual([
      "http://api.test/sessions/sess_1/messages",
      "http://api.test/sessions/sess_1/items?type=all&limit=20&recent=true",
    ]);
    expect(output.join("").trim()).toContain(
      "[input initial manager_agent msg_1]\nInspect the repo.",
    );
    expect(output.join("").trim()).toContain("[agent #1-#2]\nReady now.");
  });

  it("lists recent sessions with a default limit", async () => {
    const calls: string[] = [];
    const program = createProgram({
      fetch: async (url) => {
        calls.push(String(url));
        return jsonResponse({ items: [], next_cursor: null, limit: 10 });
      },
      stdout: () => undefined,
    });

    await program.parseAsync([
      "node",
      "codexhub",
      "--api",
      "http://api.test",
      "sessions",
      "recent",
      "--project",
      "proj_1",
    ]);

    expect(calls).toEqual([
      "http://api.test/sessions?project_id=proj_1&limit=10",
    ]);
  });

  it("prints JSON API errors for JSON commands", async () => {
    let exitCode = 0;
    const errors: string[] = [];
    const env: CliEnvironment = {
      fetch: async () => jsonResponse({ error: "not found" }, { status: 404 }),
      stderr: (text) => errors.push(text),
      setExitCode: (code) => {
        exitCode = code;
      },
    };

    await createProgram(env).parseAsync([
      "node",
      "codexhub",
      "session",
      "inspect",
      "missing",
      "--json",
    ]);

    expect(exitCode).toBe(1);
    expect(JSON.parse(errors.join(""))).toMatchObject({
      error: "not found",
      status: 404,
    });
  });
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}
