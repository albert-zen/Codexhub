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

  it("passes latest item type filters and keeps manager-facing JSON intact", async () => {
    const calls: string[] = [];
    const output: string[] = [];
    const program = createProgram({
      fetch: async (url) => {
        calls.push(String(url));
        return jsonResponse({
          session_id: "sess_1",
          type: "agentmessage",
          item: {
            type: "agentmessage",
            codex_method: "item/completed",
            text_excerpt: "Complete manager-facing answer.",
          },
          last_agent_message: "Complete manager-facing answer.",
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
      "latest",
      "sess_1",
      "--type",
      "agentmessage",
      "--json",
    ]);

    expect(calls).toEqual([
      "http://api.test/sessions/sess_1/latest?type=agentmessage",
    ]);
    expect(JSON.parse(output.join(""))).toMatchObject({
      type: "agentmessage",
      item: {
        codex_method: "item/completed",
        text_excerpt: "Complete manager-facing answer.",
      },
      last_agent_message: "Complete manager-facing answer.",
    });
  });

  it("prints stable latest text instead of a raw delta fragment", async () => {
    const output: string[] = [];
    const program = createProgram({
      fetch: async () =>
        jsonResponse({
          session_id: "sess_1",
          type: "agentmessage",
          item: {
            type: "agentmessage",
            codex_method: "item/agentMessage/delta",
            text_excerpt: "The",
          },
          last_agent_message: "Previous complete answer.",
        }),
      stdout: (text) => output.push(text),
    });

    await program.parseAsync([
      "node",
      "codexhub",
      "--api",
      "http://api.test",
      "session",
      "latest",
      "sess_1",
    ]);

    expect(output.join("").trim()).toBe("Previous complete answer.");
  });

  it("prints stable latest text for type all when the raw latest is a delta", async () => {
    const calls: string[] = [];
    const output: string[] = [];
    const program = createProgram({
      fetch: async (url) => {
        calls.push(String(url));
        return jsonResponse({
          session_id: "sess_1",
          type: "all",
          item: {
            type: "agentmessage",
            codex_method: "item/agentMessage/delta",
            text_excerpt: "The worktree is clean. The",
          },
          last_agent_message: "Previous complete answer.",
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
      "latest",
      "sess_1",
      "--type",
      "all",
    ]);

    expect(calls).toEqual(["http://api.test/sessions/sess_1/latest?type=all"]);
    expect(output.join("").trim()).toBe("Previous complete answer.");
  });

  it("does not print an agent delta when stable latest is empty", async () => {
    const output: string[] = [];
    const program = createProgram({
      fetch: async () =>
        jsonResponse({
          session_id: "sess_1",
          type: "agentmessage",
          item: {
            type: "agentmessage",
            codex_method: "item/agentMessage/delta",
            text_excerpt: "The worktree is clean. The",
          },
          last_agent_message: null,
        }),
      stdout: (text) => output.push(text),
    });

    await program.parseAsync([
      "node",
      "codexhub",
      "--api",
      "http://api.test",
      "session",
      "latest",
      "sess_1",
    ]);

    expect(output.join("").trim()).toBe("No agent message.");
  });

  it("does not print a type all agent delta when stable latest is empty", async () => {
    const output: string[] = [];
    const program = createProgram({
      fetch: async () =>
        jsonResponse({
          session_id: "sess_1",
          type: "all",
          item: {
            type: "agentmessage",
            codex_method: "item/agentMessage/delta",
            text_excerpt: "The worktree is clean. The",
          },
          last_agent_message: null,
        }),
      stdout: (text) => output.push(text),
    });

    await program.parseAsync([
      "node",
      "codexhub",
      "--api",
      "http://api.test",
      "session",
      "latest",
      "sess_1",
      "--type",
      "all",
    ]);

    expect(output.join("").trim()).toBe("No agent message.");
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

  it("creates worktree workspaces with repo path metadata", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const program = createProgram({
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return jsonResponse({ workspace: { id: "work_1" } });
      },
      stdout: () => undefined,
    });

    await program.parseAsync([
      "node",
      "codexhub",
      "--api",
      "http://api.test",
      "workspace",
      "create",
      "--project",
      "proj_1",
      "--source",
      "git",
      "--mode",
      "worktree",
      "--repo-path",
      "D:\\repo",
      "--path",
      "D:\\worktrees\\worker one",
      "--branch",
      "codexhub/worker-one",
    ]);

    expect(calls[0]?.url).toBe("http://api.test/workspaces");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      project_id: "proj_1",
      source_type: "git",
      mode: "worktree",
      repo_path: "D:\\repo",
      path: "D:\\worktrees\\worker one",
      branch: "codexhub/worker-one",
    });
  });

  it("creates run groups and associates sessions", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const output: string[] = [];
    const program = createProgram({
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return jsonResponse({
          run_group: {
            id: "run_1",
            name: "Batch",
            purpose: "Parallel build",
          },
          sessions: [{ id: "sess_1", status: "awaiting_input" }],
        });
      },
      stdout: (text) => output.push(text),
    });

    await program.parseAsync([
      "node",
      "codexhub",
      "--api",
      "http://api.test",
      "run-group",
      "create",
      "--name",
      "Batch",
      "--purpose",
      "Parallel build",
    ]);

    expect(calls[0]?.url).toBe("http://api.test/run-groups");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      name: "Batch",
      purpose: "Parallel build",
    });
    expect(output.join("").trim()).toBe("run_1 Batch - Parallel build");
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

  it("prints readable recent traces with bounded transcript windows", async () => {
    const calls: string[] = [];
    const output: string[] = [];
    const program = createProgram({
      fetch: async (url) => {
        const text = String(url);
        calls.push(text);
        return jsonResponse({
          session_id: "sess_1",
          items: [
            {
              sequence: 1,
              kind: "message",
              source_id: "msg_1",
              message_mode: "initial",
              sender_type: "manager_agent",
              text: "Inspect the repo.",
              created_at: "2026-01-01T00:00:01.000Z",
            },
            {
              sequence: 2,
              kind: "agent_message",
              codex_item_id: "agent_1",
              item_sequences: [1, 2],
              text: "Ready now.",
              created_at: "2026-01-01T00:00:02.000Z",
            },
          ],
          transcript: [
            {
              sequence: 1,
              kind: "message",
              source_id: "msg_1",
              message_mode: "initial",
              sender_type: "manager_agent",
              text: "Inspect the repo.",
              created_at: "2026-01-01T00:00:01.000Z",
            },
            {
              sequence: 2,
              kind: "agent_message",
              codex_item_id: "agent_1",
              item_sequences: [1, 2],
              text: "Ready now.",
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
      "http://api.test/sessions/sess_1/transcript?limit=20&recent=true",
    ]);
    expect(output.join("").trim()).toContain(
      "[input initial manager_agent msg_1]\nInspect the repo.",
    );
    expect(output.join("").trim()).toContain("[agent #1-#2]\nReady now.");
  });

  it("accepts explicit recent trace pagination", async () => {
    await expect(traceRequestUrls(["--recent"])).resolves.toEqual([
      "http://api.test/sessions/sess_1/transcript?limit=20&recent=true",
    ]);
  });

  it("passes non-recent trace pagination through explicitly", async () => {
    await expect(traceRequestUrls(["--no-recent"])).resolves.toEqual([
      "http://api.test/sessions/sess_1/transcript?limit=20&recent=false",
    ]);
  });

  it("uses forward trace pagination for cursors and sequence boundaries", async () => {
    await expect(traceRequestUrls(["--cursor", "2"])).resolves.toEqual([
      "http://api.test/sessions/sess_1/transcript?limit=20&cursor=2",
    ]);
    await expect(traceRequestUrls(["--after-sequence", "2"])).resolves.toEqual([
      "http://api.test/sessions/sess_1/transcript?limit=20&after_sequence=2",
    ]);
    await expect(traceRequestUrls(["--before-sequence", "8"])).resolves.toEqual(
      ["http://api.test/sessions/sess_1/transcript?limit=20&before_sequence=8"],
    );
  });

  it("documents trace pagination controls in help", () => {
    const help = commandHelp("session", "trace");
    expect(help).toContain("--recent");
    expect(help).toContain("default without");
    expect(help).toContain("cursor or sequence filters");
    expect(help).toContain("--no-recent");
    expect(help).toContain("Read forward from the beginning");
    expect(help).toContain("--cursor <cursor>");
    expect(help).toContain("Page cursor from non-recent pagination");
    expect(help).toContain("--after-sequence <n>");
    expect(help).toContain("--before-sequence <n>");
  });

  it("documents unique short prefixes for session references", () => {
    const helpText = "Session ID, unique id prefix, or unique UUID prefix";
    expect(commandHelp("session", "inspect")).toContain(helpText);
    expect(commandHelp("session", "send")).toContain(helpText);
    expect(commandHelp("run-group", "add-session")).toContain(helpText);
  });

  it("keeps trace JSON transcript fields at the top level", async () => {
    const output: string[] = [];
    const program = createProgram({
      fetch: async () =>
        jsonResponse({
          session_id: "sess_1",
          items: [],
          transcript: [
            {
              sequence: 1,
              kind: "agent_message",
              text: "Ready now.",
              item_sequences: [1, 2],
            },
          ],
          next_cursor: null,
          limit: 20,
        }),
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
      "--json",
    ]);

    const body = JSON.parse(output.join(""));
    expect(body.session_id).toBe("sess_1");
    expect(body.transcript).toHaveLength(1);
    expect(body.trace).toBeUndefined();
  });

  it("keeps watch JSON transcript fields at the top level", async () => {
    const output: string[] = [];
    const program = createProgram({
      fetch: async (url) => {
        const text = String(url);
        if (text.endsWith("/sessions/sess_1")) {
          return jsonResponse({
            session: { id: "sess_1", status: "awaiting_input" },
          });
        }
        return jsonResponse({
          session_id: "sess_1",
          transcript: [
            {
              sequence: 1,
              kind: "agent_message",
              text: "Ready now.",
              item_sequences: [1, 2],
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
      "http://api.test",
      "session",
      "watch",
      "sess_1",
      "--json",
    ]);

    const body = JSON.parse(output.join(""));
    expect(body.session_id).toBe("sess_1");
    expect(body.session).toMatchObject({ id: "sess_1" });
    expect(body.transcript).toHaveLength(1);
    expect(body.trace).toBeUndefined();
  });

  it("preserves raw filtered trace JSON shape", async () => {
    const calls: string[] = [];
    const output: string[] = [];
    const program = createProgram({
      fetch: async (url) => {
        const text = String(url);
        calls.push(text);
        if (text.endsWith("/sessions/sess_1/messages")) {
          return jsonResponse({ items: [{ id: "msg_1" }] });
        }
        return jsonResponse({ items: [{ id: "item_1", type: "toolcall" }] });
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
      "--type",
      "toolcall",
      "--json",
    ]);

    const body = JSON.parse(output.join(""));
    expect(body.session_id).toBe("sess_1");
    expect(body.messages.items).toEqual([{ id: "msg_1" }]);
    expect(body.items.items).toEqual([{ id: "item_1", type: "toolcall" }]);
    expect(body.transcript).toBeUndefined();
    expect(body.trace).toBeUndefined();
    expect(calls).toEqual([
      "http://api.test/sessions/sess_1/messages",
      "http://api.test/sessions/sess_1/items?type=toolcall&limit=20&recent=true",
    ]);
  });

  it("keeps canonical session ids in filtered trace JSON", async () => {
    const output: string[] = [];
    const program = createProgram({
      fetch: async (url) => {
        const text = String(url);
        if (text.endsWith("/sessions/sess_ab/messages")) {
          return jsonResponse({ items: [] });
        }
        return jsonResponse({
          session_id: "sess_full",
          items: [{ id: "item_1", type: "toolcall" }],
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
      "sess_ab",
      "--type",
      "toolcall",
      "--json",
    ]);

    expect(JSON.parse(output.join("")).session_id).toBe("sess_full");
  });

  it("passes non-recent filtered trace pagination to item reads", async () => {
    await expect(
      traceRequestUrls(["--type", "toolcall", "--no-recent"]),
    ).resolves.toEqual([
      "http://api.test/sessions/sess_1/messages",
      "http://api.test/sessions/sess_1/items?type=toolcall&limit=20&recent=false",
    ]);
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

  it("prints machine-readable candidate ids for ambiguous JSON API errors", async () => {
    let exitCode = 0;
    const errors: string[] = [];
    const env: CliEnvironment = {
      fetch: async () =>
        jsonResponse(
          {
            error: {
              code: "session_id_ambiguous",
              message:
                'session id prefix "a" is ambiguous; pass a longer prefix or canonical session id',
              candidate_ids: ["sess_a1", "sess_a2"],
            },
            message:
              'session id prefix "a" is ambiguous; pass a longer prefix or canonical session id',
          },
          { status: 409 },
        ),
      stderr: (text) => errors.push(text),
      setExitCode: (code) => {
        exitCode = code;
      },
    };

    await createProgram(env).parseAsync([
      "node",
      "codexhub",
      "session",
      "send",
      "a",
      "--message",
      "Please continue.",
      "--json",
    ]);

    expect(exitCode).toBe(1);
    expect(JSON.parse(errors.join(""))).toMatchObject({
      error:
        'session id prefix "a" is ambiguous; pass a longer prefix or canonical session id',
      code: "session_id_ambiguous",
      status: 409,
      candidate_ids: ["sess_a1", "sess_a2"],
    });
  });
});

async function traceRequestUrls(args: string[]): Promise<string[]> {
  const calls: string[] = [];
  const program = createProgram({
    fetch: async (url) => {
      calls.push(String(url));
      return jsonResponse({
        session_id: "sess_1",
        items: [],
        messages: [],
        transcript: [],
        next_cursor: null,
        limit: 20,
      });
    },
    stdout: () => undefined,
  });

  await program.parseAsync([
    "node",
    "codexhub",
    "--api",
    "http://api.test",
    "session",
    "trace",
    "sess_1",
    ...args,
  ]);

  return calls;
}

function commandHelp(groupName: string, commandName: string): string {
  const group = createProgram().commands.find(
    (command) => command.name() === groupName,
  );
  const command = group?.commands.find((entry) => entry.name() === commandName);
  if (!command) throw new Error(`${groupName} ${commandName} command missing`);
  return command.helpInformation();
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}
