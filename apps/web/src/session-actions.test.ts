import { describe, expect, it } from "vitest";

import { getSessionActionAvailability } from "./session-actions.js";

describe("getSessionActionAvailability", () => {
  it("explains terminal sessions and does not allow sends", () => {
    const actions = getSessionActionAvailability({
      status: "stopped",
      message: "next step",
      submitting: null,
    });

    expect(actions.steer.disabled).toBe(true);
    expect(actions.steer.reasons.join(" ")).toContain("stopped");
    expect(actions.steer.reasons.join(" ")).toContain("follow-up session");
    expect(actions.continue.disabled).toBe(true);
    expect(actions.continue.reasons.join(" ")).toContain("stopped");
    expect(actions.stop.disabled).toBe(true);
    expect(actions.stop.reasons.join(" ")).toContain("stopped");
    expect(actions.complete.disabled).toBe(true);
    expect(actions.complete.reasons.join(" ")).toContain("stopped");
  });

  it("enables continue while awaiting input only when the message has content", () => {
    const empty = getSessionActionAvailability({
      status: "awaiting_input",
      message: "   ",
      submitting: null,
    });
    const withContent = getSessionActionAvailability({
      status: "awaiting_input",
      message: "please continue",
      submitting: null,
    });

    expect(empty.continue.disabled).toBe(true);
    expect(empty.continue.reasons).toContain(
      "A non-empty message is required for Continue.",
    );
    expect(withContent.continue.disabled).toBe(false);
  });

  it("enables steer while running only when the message has content", () => {
    const empty = getSessionActionAvailability({
      status: "running",
      message: "",
      submitting: null,
    });
    const withContent = getSessionActionAvailability({
      status: "running",
      message: "adjust course",
      submitting: null,
    });

    expect(empty.steer.disabled).toBe(true);
    expect(empty.steer.reasons).toContain(
      "A non-empty message is required for Send Steer.",
    );
    expect(withContent.steer.disabled).toBe(false);
  });
});
