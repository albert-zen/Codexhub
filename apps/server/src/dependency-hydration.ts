import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export interface DependencyHydrationResult {
  status: "hydrated" | "skipped";
  command?: string;
  args?: string[];
  store_dir?: string | null;
  reason?: string;
}

export interface CommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options: { cwd: string },
) => CommandResult;

export interface WorktreeDependencyHydrationOptions {
  sourcePath: string;
  workspacePath: string;
  runCommand?: CommandRunner;
}

export function hydrateWorktreeDependencies(
  options: WorktreeDependencyHydrationOptions,
): DependencyHydrationResult {
  const sourcePath = canonicalPath(options.sourcePath);
  const workspacePath = canonicalPath(options.workspacePath);
  if (!isPnpmWorkspace(sourcePath)) {
    return { status: "skipped", reason: "not_pnpm_workspace" };
  }

  const sourceModulesPath = join(sourcePath, "node_modules");
  if (!isDirectory(sourceModulesPath)) {
    throw new Error(
      `pnpm worktree dependency hydration requires installed source dependencies at ${sourceModulesPath}; run "pnpm install" in the source checkout before creating worktree workers`,
    );
  }

  const storeDir = readPnpmStoreDir(sourcePath);
  if (storeDir && !isDirectory(storeDir)) {
    throw new Error(
      `pnpm worktree dependency hydration requires the source pnpm store at ${storeDir}; run "pnpm install" in ${sourcePath} before creating worktree workers`,
    );
  }

  mkdirSync(workspacePath, { recursive: true });
  const args = [
    "install",
    "--offline",
    "--frozen-lockfile",
    "--ignore-scripts",
  ];
  if (storeDir) args.push("--store-dir", storeDir);

  const runCommand = options.runCommand ?? runDependencyCommand;
  const result = runCommand("pnpm", args, { cwd: workspacePath });
  if (result.status !== 0) {
    throw new Error(
      `pnpm worktree dependency hydration failed (${result.status}) in ${workspacePath}: ${(result.stderr || result.stdout).trim()}`,
    );
  }

  return {
    status: "hydrated",
    command: "pnpm",
    args,
    store_dir: storeDir,
  };
}

function isPnpmWorkspace(path: string): boolean {
  return existsSync(join(path, "pnpm-lock.yaml"));
}

function readPnpmStoreDir(sourcePath: string): string | null {
  const modulesPath = join(sourcePath, "node_modules", ".modules.yaml");
  if (!existsSync(modulesPath)) return null;

  const content = readFileSync(modulesPath, "utf8");
  const jsonStoreDir = readJsonStoreDir(content);
  if (jsonStoreDir) return resolveStoreDir(sourcePath, jsonStoreDir);

  const yamlStoreDir = content.match(/^\s*storeDir:\s*(.+?)\s*$/m)?.[1];
  if (!yamlStoreDir) return null;
  return resolveStoreDir(sourcePath, unquoteYamlScalar(yamlStoreDir));
}

function readJsonStoreDir(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as { storeDir?: unknown };
    return typeof parsed.storeDir === "string" ? parsed.storeDir : null;
  } catch {
    return null;
  }
}

function unquoteYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === "string") return parsed;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function resolveStoreDir(sourcePath: string, storeDir: string): string {
  return canonicalPath(
    isAbsolute(storeDir) ? storeDir : resolve(sourcePath, storeDir),
  );
}

function runDependencyCommand(
  command: string,
  args: string[],
  options: { cwd: string },
): CommandResult {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function canonicalPath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}
