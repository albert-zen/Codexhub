import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "../../server/src/server.js";
import { createProgram, type CliEnvironment } from "../src/program.js";

type App = Awaited<ReturnType<typeof createServer>>;

let app: App;
let baseUrl: string;
let tempDir: string;

beforeEach(async () => {
  tempDir = await realpath(await mkdtemp(join(tmpdir(), "codexhub-cli-")));
  app = await createServer({ dbPath: ":memory:", logger: false });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string")
    throw new Error("test server did not expose a TCP address");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await app.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("codexhub CLI smoke", () => {
  it("creates project/workspace/session and reads latest fake worker output", async () => {
    const project = await runJson([
      "project",
      "create",
      "--name",
      "Smoke",
      "--workspace-root",
      tempDir,
      "--json",
    ]);
    const projectId = entityId(project, "project");

    const workspace = await runJson([
      "workspace",
      "create",
      "--project",
      projectId,
      "--source",
      "local",
      "--path",
      join(tempDir, "workspace"),
      "--json",
    ]);
    const workspaceId = entityId(workspace, "workspace");

    const session = await runJson([
      "session",
      "start",
      "--project",
      projectId,
      "--workspace",
      workspaceId,
      "--codex-options",
      '{"fake":true}',
      "--json",
      "Report status.",
    ]);
    const sessionId = entityId(session, "session");
    expect(nested(session, "session", "status")).toBe("awaiting_input");

    const latest = await runText(["session", "latest", sessionId]);
    expect(latest).toContain("Report status.");

    const trace = await runText([
      "session",
      "trace",
      sessionId,
      "--limit",
      "10",
    ]);
    expect(trace).toContain("[input initial");
    expect(trace).toContain("[agent #");

    await runJson(["session", "stop", sessionId, "--json"]);
    const followUp = await runJson([
      "session",
      "follow-up",
      sessionId,
      "--codex-options",
      '{"fake":true}',
      "--json",
      "Continue from a fresh worker.",
    ]);
    const followUpSessionId = entityId(followUp, "session");
    expect(followUpSessionId).not.toBe(sessionId);
    expect(followUp.previous_session_id).toBe(sessionId);
    expect(nested(followUp, "session", "previous_session_id")).toBe(sessionId);
    expect(nested(followUp, "session", "status")).toBe("awaiting_input");

    const followUpLatest = await runText([
      "session",
      "latest",
      followUpSessionId,
    ]);
    expect(followUpLatest).toContain("Continue from a fresh worker.");
  });
});

async function runJson(args: string[]): Promise<Record<string, unknown>> {
  const text = await runText(args);
  return JSON.parse(text) as Record<string, unknown>;
}

async function runText(args: string[]): Promise<string> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let exitCode = 0;
  const env: CliEnvironment = {
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
    setExitCode: (code) => {
      exitCode = code;
    },
  };
  await createProgram(env).parseAsync([
    "node",
    "codexhub",
    "--api",
    baseUrl,
    ...args,
  ]);
  expect(stderr.join("")).toBe("");
  expect(exitCode).toBe(0);
  return stdout.join("").trim();
}

function entityId(value: Record<string, unknown>, key: string): string {
  const id = nested(value, key, "id");
  if (typeof id !== "string") throw new Error(`${key}.id missing`);
  return id;
}

function nested(
  value: Record<string, unknown>,
  key: string,
  nestedKey: string,
): unknown {
  const entity = value[key];
  if (!entity || typeof entity !== "object" || Array.isArray(entity))
    return undefined;
  return (entity as Record<string, unknown>)[nestedKey];
}
