import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

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
  error?: string;
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

export interface WorktreeDependencyHydrationPreflightOptions {
  sourcePath: string;
  workspacePath?: string;
}

export interface WorktreeDependencyHydrationPlan {
  status: "needed" | "skipped";
  args?: string[];
  store_dir?: string | null;
  reason?: string;
}

export function preflightWorktreeDependencyHydration(
  options: WorktreeDependencyHydrationPreflightOptions,
): WorktreeDependencyHydrationPlan {
  const sourcePath = canonicalPath(options.sourcePath);
  const workspacePath = options.workspacePath
    ? canonicalPath(options.workspacePath)
    : null;
  if (!isPnpmWorkspace(sourcePath)) {
    return { status: "skipped", reason: "not_pnpm_workspace" };
  }

  const storeDir = validatePnpmSourceInstall(sourcePath);
  if (workspacePath) assertSafeWorkspaceNodeModules(workspacePath);

  return {
    status: "needed",
    args: pnpmInstallArgs(storeDir),
    store_dir: storeDir,
  };
}

export function hydrateWorktreeDependencies(
  options: WorktreeDependencyHydrationOptions,
): DependencyHydrationResult {
  const sourcePath = canonicalPath(options.sourcePath);
  const workspacePath = canonicalPath(options.workspacePath);
  const plan = preflightWorktreeDependencyHydration({
    sourcePath,
    workspacePath,
  });
  if (plan.status === "skipped") {
    return plan.reason
      ? { status: "skipped", reason: plan.reason }
      : { status: "skipped" };
  }

  const args = plan.args ?? pnpmInstallArgs(plan.store_dir ?? null);
  mkdirSync(workspacePath, { recursive: true });

  const runCommand = options.runCommand ?? runDependencyCommand;
  const result = runCommand("pnpm", args, { cwd: workspacePath });
  if (result.status !== 0) {
    throw new Error(
      `pnpm worktree dependency hydration failed (${result.status}) in ${workspacePath}: ${commandDiagnostic(result)}`,
    );
  }

  return {
    status: "hydrated",
    command: "pnpm",
    args,
    store_dir: plan.store_dir ?? null,
  };
}

function validatePnpmSourceInstall(sourcePath: string): string | null {
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

  return storeDir;
}

function pnpmInstallArgs(storeDir: string | null): string[] {
  const args = [
    "install",
    "--offline",
    "--frozen-lockfile",
    "--ignore-scripts",
    "--prod=false",
  ];
  if (storeDir) args.push("--store-dir", storeDir);
  return args;
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
  const commandResult: CommandResult = {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
  if (result.error) commandResult.error = result.error.message;
  return commandResult;
}

function assertSafeWorkspaceNodeModules(workspacePath: string): void {
  const nodeModulesPath = join(workspacePath, "node_modules");
  try {
    lstatSync(nodeModulesPath);
  } catch (error) {
    if (isMissingPathError(error)) return;
    throw error;
  }

  let resolvedNodeModules: string;
  try {
    resolvedNodeModules = realpathSync.native(nodeModulesPath);
  } catch (error) {
    throw new Error(
      `workspace node_modules must resolve before dependency hydration: ${nodeModulesPath}: ${errorMessage(error)}`,
      { cause: error },
    );
  }

  ensureContained(
    resolvedNodeModules,
    workspacePath,
    `workspace node_modules resolves outside workspace before dependency hydration: ${nodeModulesPath}`,
  );
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

function ensureContained(child: string, parent: string, message: string): void {
  const rel = relative(parent, child);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return;
  throw new Error(`${message} -> ${child}`);
}

function commandDiagnostic(result: CommandResult): string {
  const details = [
    (result.stderr || result.stdout).trim(),
    result.error ? `spawn error: ${result.error}` : "",
  ].filter((detail) => detail.length > 0);
  return details.length > 0 ? details.join("; ") : "no output";
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
