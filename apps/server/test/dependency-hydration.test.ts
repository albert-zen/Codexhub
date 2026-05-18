import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hydrateWorktreeDependencies,
  type CommandRunner,
} from "../src/dependency-hydration.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await realpath(await mkdtemp(join(tmpdir(), "codexhub-deps-")));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("worktree dependency hydration", () => {
  it("runs offline pnpm install in the worktree with the source checkout store", async () => {
    const sourcePath = join(tempDir, "source repo");
    const workspacePath = join(tempDir, "worker repo");
    const storePath = join(tempDir, "pnpm store", "v10");
    await mkdir(join(sourcePath, "node_modules"), { recursive: true });
    await mkdir(workspacePath, { recursive: true });
    await mkdir(storePath, { recursive: true });
    await writeFile(
      join(sourcePath, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\n",
    );
    await writeFile(
      join(sourcePath, "node_modules", ".modules.yaml"),
      `storeDir: "${storePath}"\n`,
    );

    const calls: {
      command: string;
      args: string[];
      cwd: string;
    }[] = [];
    const runCommand: CommandRunner = (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      return { status: 0, stdout: "", stderr: "" };
    };

    const result = hydrateWorktreeDependencies({
      sourcePath,
      workspacePath,
      runCommand,
    });

    expect(result.status).toBe("hydrated");
    expect(calls).toEqual([
      {
        command: "pnpm",
        args: [
          "install",
          "--offline",
          "--frozen-lockfile",
          "--ignore-scripts",
          "--store-dir",
          await realpath(storePath),
        ],
        cwd: await realpath(workspacePath),
      },
    ]);
  });

  it("fails clearly when the pnpm source checkout has not been installed", async () => {
    const sourcePath = join(tempDir, "source repo");
    const workspacePath = join(tempDir, "worker repo");
    await mkdir(sourcePath, { recursive: true });
    await mkdir(workspacePath, { recursive: true });
    await writeFile(
      join(sourcePath, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\n",
    );

    expect(() =>
      hydrateWorktreeDependencies({ sourcePath, workspacePath }),
    ).toThrow(/run "pnpm install" in the source checkout/);
  });

  it("skips non-pnpm worktrees", async () => {
    const sourcePath = join(tempDir, "source repo");
    const workspacePath = join(tempDir, "worker repo");
    await mkdir(sourcePath, { recursive: true });
    await mkdir(workspacePath, { recursive: true });

    const result = hydrateWorktreeDependencies({ sourcePath, workspacePath });

    expect(result).toEqual({
      status: "skipped",
      reason: "not_pnpm_workspace",
    });
  });
});
