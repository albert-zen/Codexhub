import {
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { Project, Workspace } from "@codexhub/core";
import {
  hydrateWorktreeDependencies,
  preflightWorktreeDependencyHydration,
} from "./dependency-hydration.js";

export interface WorkspaceBuildRequest {
  project: Project;
  source_type?: "git" | "local" | null;
  mode?: "worktree" | null;
  repo_url?: string | null;
  repo_path?: string | null;
  path?: string | null;
  cwd?: string | null;
  branch?: string | null;
  commit_sha?: string | null;
}

export interface BuiltWorkspace {
  source_type: "git" | "local";
  repo_url: string | null;
  path: string;
  cwd: string;
  branch: string | null;
  commit_sha: string | null;
  status: Workspace["status"];
  last_error: string | null;
}

export interface WorkspaceBuildOptions {
  preflightDependencies?: typeof preflightWorktreeDependencyHydration;
  hydrateDependencies?: typeof hydrateWorktreeDependencies;
}

interface CreatedWorktree {
  repoPath: string;
  path: string;
  branch: string;
}

export function buildWorkspace(
  input: WorkspaceBuildRequest,
  options: WorkspaceBuildOptions = {},
): BuiltWorkspace {
  let createdWorktree: CreatedWorktree | null = null;
  try {
    const mode = input.mode ?? null;
    const repoUrl = clean(
      input.repo_path ?? input.repo_url ?? input.project.default_repo_url,
    );
    const sourceType =
      mode === "worktree"
        ? "git"
        : (input.source_type ?? (repoUrl ? "git" : "local"));
    const branch = clean(input.branch ?? input.project.default_branch);
    const workspacePath = resolveWorkspacePath(
      input.project,
      input.path,
      repoUrl,
    );
    const cwd = resolveWorkspaceCwd(
      workspacePath,
      clean(input.cwd ?? input.project.default_cwd),
    );

    if (mode === "worktree") {
      if (!repoUrl)
        throw new Error("repo_path or repo_url is required for worktree mode");
      const worktreeBranch = branch ?? defaultWorktreeBranch(workspacePath);
      const preflightDependencies =
        options.preflightDependencies ?? preflightWorktreeDependencyHydration;
      preflightDependencies({ sourcePath: repoUrl });
      prepareGitWorktree(workspacePath, repoUrl, worktreeBranch);
      createdWorktree = {
        repoPath: repoUrl,
        path: workspacePath,
        branch: worktreeBranch,
      };
      const hydrateDependencies =
        options.hydrateDependencies ?? hydrateWorktreeDependencies;
      hydrateDependencies({
        sourcePath: repoUrl,
        workspacePath,
      });
    } else if (sourceType === "git") {
      if (!repoUrl) throw new Error("repo_url is required for git workspaces");
      prepareGitWorkspace(workspacePath, repoUrl, branch);
    } else {
      mkdirSync(workspacePath, { recursive: true });
    }

    const canonicalWorkspace = canonicalPath(workspacePath);
    const canonicalCwd = canonicalPath(cwd);
    ensureContained(
      canonicalCwd,
      canonicalWorkspace,
      "cwd must stay inside workspace path",
    );

    const commitSha =
      clean(input.commit_sha) ??
      gitOutput(canonicalWorkspace, ["rev-parse", "HEAD"]);
    const currentBranch =
      branch ??
      gitOutput(canonicalWorkspace, ["rev-parse", "--abbrev-ref", "HEAD"]);

    if (input.commit_sha && sourceType === "git") {
      runGit(canonicalWorkspace, ["checkout", input.commit_sha]);
    }

    return {
      source_type: sourceType,
      repo_url:
        mode === "worktree" && repoUrl ? canonicalPath(repoUrl) : repoUrl,
      path: canonicalWorkspace,
      cwd: canonicalCwd,
      branch: currentBranch === "HEAD" ? branch : currentBranch,
      commit_sha: commitSha,
      status: "ready",
      last_error: null,
    };
  } catch (error) {
    if (createdWorktree) {
      const cleanupErrors = cleanupCreatedGitWorktree(createdWorktree);
      if (cleanupErrors.length > 0) {
        throw new Error(
          `${errorMessage(error)}; failed to clean up created worktree: ${cleanupErrors.join("; ")}`,
          { cause: error },
        );
      }
    }
    throw error;
  }
}

function resolveWorkspacePath(
  project: Project,
  rawPath: string | null | undefined,
  repoUrl: string | null,
): string {
  const root = clean(project.default_workspace_root);
  const path = clean(rawPath);
  const fallbackName = safeName(
    repoUrl ? repoUrl.replace(/\.git$/i, "") : project.name,
  );
  const absolute = path
    ? isAbsolute(path)
      ? path
      : resolve(root ?? process.cwd(), path)
    : resolve(root ?? process.cwd(), fallbackName);

  rejectRootPath(absolute);
  if (root) {
    const canonicalRoot = canonicalPath(root);
    const canonicalWorkspace = canonicalPath(absolute);
    if (canonicalRoot === canonicalWorkspace) {
      throw new Error("workspace path must not equal default_workspace_root");
    }
    ensureContained(
      canonicalWorkspace,
      canonicalRoot,
      "workspace path must stay under default_workspace_root",
    );
  }

  mkdirSync(dirname(absolute), { recursive: true });
  return absolute;
}

function resolveWorkspaceCwd(
  workspacePath: string,
  cwd: string | null,
): string {
  return cwd
    ? isAbsolute(cwd)
      ? cwd
      : resolve(workspacePath, cwd)
    : workspacePath;
}

function prepareGitWorkspace(
  path: string,
  repoUrl: string,
  branch: string | null,
): void {
  if (!existsSync(path) || isEmptyDirectory(path)) {
    mkdirSync(dirname(path), { recursive: true });
    const args = ["clone"];
    if (branch) args.push("--branch", branch);
    args.push(repoUrl, path);
    runCommand("git", args);
  } else if (!existsSync(join(path, ".git"))) {
    throw new Error(
      `git workspace path exists but is not a git repository: ${path}`,
    );
  }

  if (branch) {
    checkoutBranch(path, branch);
  }
}

function prepareGitWorktree(
  path: string,
  repoPath: string,
  branch: string,
): void {
  const canonicalRepo = canonicalPath(repoPath);
  if (!existsSync(join(canonicalRepo, ".git"))) {
    throw new Error(`worktree source is not a git repository: ${repoPath}`);
  }
  validateBranchName(branch);
  if (existsSync(path) && !isEmptyDirectory(path)) {
    throw new Error(`worktree path already exists and is not empty: ${path}`);
  }
  mkdirSync(dirname(path), { recursive: true });
  runCommand("git", [
    "-C",
    canonicalRepo,
    "worktree",
    "add",
    "-b",
    branch,
    path,
  ]);
}

function validateBranchName(branch: string): void {
  runCommand("git", ["check-ref-format", "--branch", branch]);
}

function checkoutBranch(path: string, branch: string): void {
  const exists =
    runCommand("git", ["-C", path, "rev-parse", "--verify", branch], {
      throwOnFailure: false,
    }).status === 0;
  runGit(path, exists ? ["checkout", branch] : ["checkout", "-b", branch]);
}

function runGit(path: string, args: string[]): void {
  if (!existsSync(join(path, ".git"))) return;
  runCommand("git", ["-C", path, ...args]);
}

function gitOutput(path: string, args: string[]): string | null {
  if (!existsSync(join(path, ".git"))) return null;
  const result = runCommand("git", ["-C", path, ...args], {
    throwOnFailure: false,
  });
  if (result.status !== 0) return null;
  const text = result.stdout.trim();
  return text === "" ? null : text;
}

function runCommand(
  command: string,
  args: string[],
  options: { throwOnFailure?: boolean } = {},
): { status: number; stdout: string; stderr: string; error?: string } {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
  });
  const commandResult: {
    status: number;
    stdout: string;
    stderr: string;
    error?: string;
  } = {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
  if (result.error) commandResult.error = result.error.message;
  if (options.throwOnFailure !== false && commandResult.status !== 0) {
    throw new Error(commandFailure(command, args, commandResult));
  }
  return commandResult;
}

function cleanupCreatedGitWorktree(worktree: CreatedWorktree): string[] {
  const cleanupErrors: string[] = [];
  const canonicalRepo = canonicalPath(worktree.repoPath);

  const remove = runCommand(
    "git",
    ["-C", canonicalRepo, "worktree", "remove", "--force", worktree.path],
    { throwOnFailure: false },
  );
  if (remove.status !== 0) {
    cleanupErrors.push(
      commandFailure(
        "git",
        ["-C", canonicalRepo, "worktree", "remove", "--force", worktree.path],
        remove,
      ),
    );
    try {
      rejectRootPath(worktree.path);
      rmSync(worktree.path, { recursive: true, force: true });
    } catch (error) {
      cleanupErrors.push(
        `removing ${worktree.path} failed: ${errorMessage(error)}`,
      );
    }
  }

  const prune = runCommand("git", ["-C", canonicalRepo, "worktree", "prune"], {
    throwOnFailure: false,
  });
  if (prune.status !== 0) {
    cleanupErrors.push(
      commandFailure("git", ["-C", canonicalRepo, "worktree", "prune"], prune),
    );
  }

  const deleteBranch = runCommand(
    "git",
    ["-C", canonicalRepo, "branch", "-D", worktree.branch],
    { throwOnFailure: false },
  );
  if (deleteBranch.status !== 0) {
    cleanupErrors.push(
      commandFailure(
        "git",
        ["-C", canonicalRepo, "branch", "-D", worktree.branch],
        deleteBranch,
      ),
    );
  }

  return cleanupErrors;
}

function canonicalPath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

function ensureContained(child: string, parent: string, message: string): void {
  const rel = relative(parent, child);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return;
  throw new Error(`${message}: ${child}`);
}

function rejectRootPath(path: string): void {
  const root = parse(resolve(path)).root;
  if (resolve(path).toLowerCase() === root.toLowerCase()) {
    throw new Error("workspace path must not be a filesystem root");
  }
}

function isEmptyDirectory(path: string): boolean {
  if (!existsSync(path)) return true;
  const stat = statSync(path);
  if (!stat.isDirectory()) return false;
  return readdirSync(path).length === 0;
}

function clean(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function safeName(value: string): string {
  return (
    value
      .split(/[\\/]/)
      .at(-1)
      ?.replace(/[^a-zA-Z0-9._-]/g, "_") || "workspace"
  );
}

function defaultWorktreeBranch(path: string): string {
  return `codexhub/${safeName(path)}-${Date.now()}`;
}

function commandFailure(
  command: string,
  args: string[],
  result: { status: number; stdout: string; stderr: string; error?: string },
): string {
  return `${command} ${args.join(" ")} failed (${result.status}): ${commandDiagnostic(result)}`;
}

function commandDiagnostic(result: {
  stdout: string;
  stderr: string;
  error?: string;
}): string {
  const details = [
    (result.stderr || result.stdout).trim(),
    result.error ? `spawn error: ${result.error}` : "",
  ].filter((detail) => detail.length > 0);
  return details.length > 0 ? details.join("; ") : "no output";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
