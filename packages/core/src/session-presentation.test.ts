import { describe, expect, it } from "vitest";

import { getSessionActionAvailability } from "./session-presentation.js";

describe("session presentation", () => {
  it("enables steer for running and awaiting-input sessions with content", () => {
    expect(
      getSessionActionAvailability({
        status: "running",
        message: "adjust course",
        submitting: null,
      }).steer.disabled,
    ).toBe(false);

    expect(
      getSessionActionAvailability({
        status: "awaiting_input",
        message: "adjust course",
        submitting: null,
      }).steer.disabled,
    ).toBe(false);
  });

  it("enables continue only for awaiting-input sessions with content", () => {
    const awaitingInput = getSessionActionAvailability({
      status: "awaiting_input",
      message: "please continue",
      submitting: null,
    });
    const running = getSessionActionAvailability({
      status: "running",
      message: "please continue",
      submitting: null,
    });

    expect(awaitingInput.continue.disabled).toBe(false);
    expect(running.continue.disabled).toBe(true);
    expect(running.continue.reasons).toContain(
      "Continue is available when this session is awaiting input; it is running.",
    );
  });

  it("requires non-empty message content for send actions", () => {
    const actions = getSessionActionAvailability({
      status: "awaiting_input",
      message: "   ",
      submitting: null,
    });

    expect(actions.steer.disabled).toBe(true);
    expect(actions.steer.reasons).toContain(
      "A non-empty message is required for Send Steer.",
    );
    expect(actions.continue.disabled).toBe(true);
    expect(actions.continue.reasons).toContain(
      "A non-empty message is required for Continue.",
    );
    expect(actions.stop.disabled).toBe(false);
    expect(actions.complete.disabled).toBe(false);
  });

  it("enables stop and complete only before terminal states", () => {
    const running = getSessionActionAvailability({
      status: "running",
      message: "",
      submitting: null,
    });
    const stopped = getSessionActionAvailability({
      status: "stopped",
      message: "next step",
      submitting: null,
    });

    expect(running.stop.disabled).toBe(false);
    expect(running.complete.disabled).toBe(false);
    expect(stopped.stop.disabled).toBe(true);
    expect(stopped.stop.reasons).toContain(
      "This session is stopped, so Stop is unavailable.",
    );
    expect(stopped.complete.disabled).toBe(true);
  });

  it("keeps terminal send guidance compatible with follow-up sessions", () => {
    const actions = getSessionActionAvailability({
      status: "failed",
      message: "try again",
      submitting: null,
    });

    expect(actions.steer.reasons).toContain(
      "This session is failed. Start a follow-up session to send more instructions.",
    );
    expect(actions.continue.reasons).toContain(
      "This session is failed. Start a follow-up session to send more instructions.",
    );
  });

  it("disables all actions while any action is submitting", () => {
    const actions = getSessionActionAvailability({
      status: "awaiting_input",
      message: "please continue",
      submitting: "continue",
    });

    expect(actions.steer.disabled).toBe(true);
    expect(actions.steer.reasons).toContain("Waiting for Continue to finish.");
    expect(actions.continue.disabled).toBe(true);
    expect(actions.stop.disabled).toBe(true);
    expect(actions.complete.disabled).toBe(true);
  });
});
