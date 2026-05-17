import { parse } from "node:path";
import type { Workspace } from "@codexhub/core";
import { describe, expect, it } from "vitest";
import {
  assertSafeWorkspacePath,
  cleanupWorkspace,
} from "../src/workspace-cleanup.js";

describe("workspace cleanup safety", () => {
  it("rejects filesystem roots", () => {
    expect(() => assertSafeWorkspacePath(parse(process.cwd()).root)).toThrow(
      /filesystem root/,
    );
  });

  it("rejects relative workspace paths before deletion", () => {
    expect(() => assertSafeWorkspacePath("relative-workspace")).toThrow(
      /absolute/,
    );
  });

  it("marks missing workspace directories deleted without deleting parents", async () => {
    await expect(
      cleanupWorkspace(
        workspace({ path: `${process.cwd()}\\missing-workspace` }),
        {
          deleteFiles: true,
        },
      ),
    ).resolves.toMatchObject({ status: "deleted", deleted_files: false });
  });
});

function workspace(overrides: Partial<Workspace>): Workspace {
  return {
    id: "work_test",
    project_id: "proj_test",
    source_type: "local",
    repo_url: null,
    path: process.cwd(),
    cwd: process.cwd(),
    branch: null,
    commit_sha: null,
    status: "ready",
    last_error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}
