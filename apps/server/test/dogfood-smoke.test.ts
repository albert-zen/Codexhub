import { describe, expect, it } from "vitest";
import {
  formatDogfoodSmokeSummary,
  runDogfoodSmoke,
} from "../src/dogfood-smoke.js";

describe("dogfood smoke script", () => {
  it("runs fake mode through the public API and reports stable query handles", async () => {
    const summary = await runDogfoodSmoke({
      mode: "fake",
      sessionCount: 2,
      pollMs: 1,
      timeoutMs: 5_000,
    });

    expect(summary.ok).toBe(true);
    expect(summary.mode).toBe("fake");
    expect(summary.managed_server).toBe(true);
    expect(summary.project.id).toMatch(/^proj_/);
    expect(summary.run_group.id).toMatch(/^run_/);
    expect(summary.workspaces).toHaveLength(2);
    expect(summary.sessions).toHaveLength(3);
    expect(summary.sessions.map((session) => session.role)).toEqual([
      "continued",
      "initial",
      "follow_up",
    ]);

    for (const session of summary.sessions) {
      expect(session.id).toMatch(/^sess_/);
      expect(session.status).toMatch(/^(awaiting_input|stopped)$/);
      expect(session.latest_message).toContain("Fake Codex worker received");
      expect(session.queries.latest).toBe(
        `/api/v1/sessions/${session.id}/latest`,
      );
      expect(session.queries.trace).toBe(
        `/api/v1/sessions/${session.id}/transcript?limit=20&recent=true`,
      );
      expect(session.trace_excerpt.length).toBeGreaterThan(0);
    }

    expect(summary.query_examples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: "List run-group sessions",
          method: "GET",
          path: `/api/v1/run-groups/${summary.run_group.id}/sessions`,
        }),
        expect.objectContaining({
          description: "Read bounded transcript trace with CLI",
          cli: expect.stringContaining("session trace"),
        }),
      ]),
    );
    expect(summary.friction).toEqual([]);
    expect(formatDogfoodSmokeSummary(summary)).toContain(
      "Friction:\n- none discovered",
    );
  });
});
