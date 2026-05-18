import { describe, expect, it } from "vitest";

import {
  buildFollowUpSessionRequest,
  buildStartSessionRequest,
  canStartFollowUpFromStatus,
  createEmptySessionDraft,
  validateSessionDraft,
} from "./session-forms.js";

describe("session form helpers", () => {
  it("builds a start-session request with prompt and task spec fields", () => {
    const request = buildStartSessionRequest("proj_1", {
      ...createEmptySessionDraft("wks_1"),
      prompt: "  Build the GUI flow.  ",
      taskRef: " issue-24 ",
      taskTitle: " Web session flow ",
      taskIntent: " Start sessions from the GUI. ",
      taskScope: " apps/web only ",
      taskAcceptance: " Humans can start and follow up. ",
    });

    expect(request).toEqual({
      project_id: "proj_1",
      workspace_id: "wks_1",
      initial_message: "Build the GUI flow.",
      task_spec: {
        ref: "issue-24",
        title: "Web session flow",
        intent: "Start sessions from the GUI.",
        scope: "apps/web only",
        acceptance_criteria: "Humans can start and follow up.",
      },
    });
  });

  it("omits empty task spec fields from follow-up requests", () => {
    const request = buildFollowUpSessionRequest({
      ...createEmptySessionDraft("wks_1"),
      prompt: "Continue from here.",
      taskTitle: "  Follow-up title  ",
    });

    expect(request).toEqual({
      workspace_id: "wks_1",
      initial_message: "Continue from here.",
      task_spec: {
        title: "Follow-up title",
      },
    });
  });

  it("validates required workspace and prompt", () => {
    expect(
      validateSessionDraft(createEmptySessionDraft(), {
        requireWorkspace: true,
      }),
    ).toEqual(["Choose a workspace.", "Enter an initial prompt."]);
  });

  it("allows follow-up only from terminal source sessions", () => {
    expect(canStartFollowUpFromStatus("stopped")).toBe(true);
    expect(canStartFollowUpFromStatus("completed")).toBe(true);
    expect(canStartFollowUpFromStatus("failed")).toBe(true);
    expect(canStartFollowUpFromStatus("running")).toBe(false);
    expect(canStartFollowUpFromStatus("awaiting_input")).toBe(false);
  });
});
