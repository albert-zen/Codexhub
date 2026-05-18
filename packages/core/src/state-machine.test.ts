import { describe, expect, it } from "vitest";
import {
  canSendMessage,
  canStartFollowUpSession,
  statusAfterTurnCompleted,
} from "./state-machine.js";

describe("worker session state machine", () => {
  it("treats turn completion as awaiting input, not completed", () => {
    expect(statusAfterTurnCompleted()).toBe("awaiting_input");
  });

  it("allows continue only from awaiting input", () => {
    expect(canSendMessage("awaiting_input", "continue")).toBe(true);
    expect(canSendMessage("running", "continue")).toBe(false);
    expect(canSendMessage("completed", "continue")).toBe(false);
  });

  it("allows steer while running or awaiting input", () => {
    expect(canSendMessage("running", "steer")).toBe(true);
    expect(canSendMessage("awaiting_input", "steer")).toBe(true);
    expect(canSendMessage("failed", "steer")).toBe(false);
  });

  it("allows follow-up sessions only from terminal sessions", () => {
    expect(canStartFollowUpSession("stopped")).toBe(true);
    expect(canStartFollowUpSession("completed")).toBe(true);
    expect(canStartFollowUpSession("failed")).toBe(true);
    expect(canStartFollowUpSession("awaiting_input")).toBe(false);
    expect(canStartFollowUpSession("running")).toBe(false);
    expect(canStartFollowUpSession("starting")).toBe(false);
  });
});
