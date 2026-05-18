import { spawnSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Project } from "@codexhub/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildWorkspace } from "../src/workspace-builder.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await realpath(await mkdtemp(join(tmpdir(), "codexhub-builder-")));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("workspace builder", () => {
  it("preflights pnpm source dependencies before creating git worktrees", async () => {
    const repoPath = join(tempDir, "source repo");
    const worktreePath = join(tempDir, "worker repo");
    await initGitRepo(repoPath);
    await addPnpmLock(repoPath);

    expect(() =>
      buildWorkspace({
        project: testProject(),
        mode: "worktree",
        repo_path: repoPath,
        path: worktreePath,
        branch: "codexhub/preflight-fails",
      }),
    ).toThrow(/run "pnpm install" in the source checkout/);

    await expect(access(worktreePath)).rejects.toThrow();
    expect(
      gitOutput(["-C", repoPath, "worktree", "list", "--porcelain"]),
    ).not.toContain(worktreePath);
  });

  it("cleans up created git worktrees when hydration fails", async () => {
    const repoPath = join(tempDir, "source repo");
    const worktreePath = join(tempDir, "worker repo");
    const branch = "codexhub/hydration-fails";
    await initGitRepo(repoPath);
    await addPnpmLock(repoPath);
    await mkdir(join(repoPath, "node_modules"), { recursive: true });

    expect(() =>
      buildWorkspace(
        {
          project: testProject(),
          mode: "worktree",
          repo_path: repoPath,
          path: worktreePath,
          branch,
        },
        {
          hydrateDependencies: () => {
            throw new Error("simulated hydration failure");
          },
        },
      ),
    ).toThrow(/simulated hydration failure/);

    await expect(access(worktreePath)).rejects.toThrow();
    expect(
      gitOutput(["-C", repoPath, "worktree", "list", "--porcelain"]),
    ).not.toContain(worktreePath);
    expect(gitOutput(["-C", repoPath, "branch", "--list", branch])).toBe("");
  });
});

function testProject(): Project {
  const timestamp = new Date(0).toISOString();
  return {
    id: "proj_test",
    name: "test",
    default_repo_url: null,
    default_workspace_root: tempDir,
    default_cwd: null,
    default_branch: null,
    default_codex_options: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
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

async function addPnpmLock(path: string): Promise<void> {
  await writeFile(join(path, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  runGit(["-C", path, "add", "pnpm-lock.yaml"]);
  runGit([
    "-C",
    path,
    "-c",
    "user.name=Codexhub Test",
    "-c",
    "user.email=codexhub@example.test",
    "commit",
    "-m",
    "add pnpm lock",
  ]);
}

function runGit(args: string[]): void {
  gitOutput(args);
}

function gitOutput(args: string[]): string {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    windowsHide: true,
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout.trim();
}
