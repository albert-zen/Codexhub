import { lstat, rm } from "node:fs/promises";
import { isAbsolute, parse, resolve } from "node:path";
import type { Workspace } from "@codexhub/core";

export interface WorkspaceCleanupOptions {
  deleteFiles?: boolean;
}

export interface WorkspaceCleanupResult {
  status: Workspace["status"];
  deleted_files: boolean;
}

export async function cleanupWorkspace(
  workspace: Workspace,
  options: WorkspaceCleanupOptions = {},
): Promise<WorkspaceCleanupResult> {
  const deleteFiles = options.deleteFiles === true;
  if (!deleteFiles) {
    return { status: "archived", deleted_files: false };
  }

  assertSafeWorkspacePath(workspace.path);
  let stat;
  try {
    stat = await lstat(workspace.path);
  } catch (error) {
    if (isMissingPathError(error)) {
      return { status: "deleted", deleted_files: false };
    }
    throw error;
  }

  if (stat.isSymbolicLink()) {
    throw new Error(
      "refusing to delete workspace path because it is a symlink",
    );
  }
  if (!stat.isDirectory()) {
    throw new Error(
      "refusing to delete workspace path because it is not a directory",
    );
  }

  await rm(workspace.path, { recursive: true, force: true });
  return { status: "deleted", deleted_files: true };
}

export function assertSafeWorkspacePath(path: string): void {
  const absolute = resolve(path);
  if (!isAbsolute(path)) {
    throw new Error("workspace path must be absolute");
  }
  const root = parse(absolute).root;
  if (absolute.toLowerCase() === root.toLowerCase()) {
    throw new Error("workspace path must not be a filesystem root");
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
