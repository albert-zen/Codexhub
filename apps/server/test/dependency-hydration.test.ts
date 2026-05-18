import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  dependencySpawnInvocation,
  hydrateWorktreeDependencies,
  pnpmCommand,
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
        command: pnpmCommand(),
        args: [
          "install",
          "--offline",
          "--frozen-lockfile",
          "--ignore-scripts",
          "--prod=false",
          "--store-dir",
          await realpath(storePath),
        ],
        cwd: await realpath(workspacePath),
      },
    ]);
  });

  it("uses the Windows pnpm command shim when needed", () => {
    expect(pnpmCommand("win32")).toBe("pnpm.cmd");
    expect(pnpmCommand("linux")).toBe("pnpm");
  });

  it("runs Windows command shims through cmd.exe", () => {
    expect(
      dependencySpawnInvocation("pnpm.cmd", ["--version"], "win32"),
    ).toMatchObject({
      args: ["/d", "/s", "/c", "pnpm.cmd", "--version"],
    });
    expect(dependencySpawnInvocation("pnpm", ["--version"], "linux")).toEqual({
      command: "pnpm",
      args: ["--version"],
    });
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

  it("rejects workspace node_modules links that resolve outside the worker", async () => {
    const sourcePath = join(tempDir, "source repo");
    const workspacePath = join(tempDir, "worker repo");
    const outsideModules = join(tempDir, "outside modules");
    await mkdir(join(sourcePath, "node_modules"), { recursive: true });
    await mkdir(workspacePath, { recursive: true });
    await mkdir(outsideModules, { recursive: true });
    await writeFile(
      join(sourcePath, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\n",
    );
    await symlink(
      outsideModules,
      join(workspacePath, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );

    const calls: string[] = [];
    const runCommand: CommandRunner = (command) => {
      calls.push(command);
      return { status: 0, stdout: "", stderr: "" };
    };

    expect(() =>
      hydrateWorktreeDependencies({ sourcePath, workspacePath, runCommand }),
    ).toThrow(/node_modules resolves outside workspace/);
    expect(calls).toHaveLength(0);
  });

  it("includes spawn errors in failed install diagnostics", async () => {
    const sourcePath = join(tempDir, "source repo");
    const workspacePath = join(tempDir, "worker repo");
    await mkdir(join(sourcePath, "node_modules"), { recursive: true });
    await mkdir(workspacePath, { recursive: true });
    await writeFile(
      join(sourcePath, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\n",
    );

    const runCommand: CommandRunner = () => ({
      status: 1,
      stdout: "",
      stderr: "",
      error: "spawn pnpm ENOENT",
    });

    expect(() =>
      hydrateWorktreeDependencies({ sourcePath, workspacePath, runCommand }),
    ).toThrow(/spawn error: spawn pnpm ENOENT/);
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
