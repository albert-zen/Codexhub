import { describe, expect, it } from "vitest";
import { canSendMessage, statusAfterTurnCompleted } from "./state-machine.js";

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
});
