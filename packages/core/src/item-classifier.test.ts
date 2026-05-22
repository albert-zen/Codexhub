import { describe, expect, it } from "vitest";
import { codexAppServerPayloadFixtures } from "./fixtures/codex-app-server-payloads.js";
import { classifyCodexPayload } from "./item-classifier.js";

describe("Codex item classifier", () => {
  it("classifies completed agent messages", () => {
    expect(
      classifyCodexPayload({
        method: "item/completed",
        params: { item: { id: "msg-1", type: "agentMessage", text: "done" } },
      }),
    ).toMatchObject({
      type: "agentmessage",
      codexItemId: "msg-1",
      textExcerpt: "done",
    });
  });

  it("classifies command lifecycle items", () => {
    expect(
      classifyCodexPayload({
        method: "item/started",
        params: {
          item: { id: "cmd-1", type: "commandExecution", command: "pnpm test" },
        },
      }).type,
    ).toBe("toolcall");

    expect(
      classifyCodexPayload({
        method: "item/completed",
        params: {
          item: {
            id: "cmd-1",
            type: "commandExecution",
            aggregatedOutput: "ok",
          },
        },
      }).type,
    ).toBe("toolresult");

    expect(
      classifyCodexPayload({
        method: "item/tool/result",
        params: {
          item: { id: "cmd-1", type: "toolResult", text: "ok" },
        },
      }).type,
    ).toBe("toolresult");
  });

  it("keeps unknown payloads as raw", () => {
    expect(classifyCodexPayload({ method: "future/event" }).type).toBe("raw");
  });

  it("classifies realistic app-server payload fixtures without mutating raw payloads", () => {
    for (const fixture of codexAppServerPayloadFixtures) {
      const originalPayload = structuredClone(fixture.payload);

      expect(classifyCodexPayload(fixture.payload), fixture.name).toMatchObject(
        fixture.expected,
      );
      expect(fixture.payload, fixture.name).toEqual(originalPayload);
    }
  });

  it("covers each stored item type with app-server fixtures", () => {
    expect(
      new Set(
        codexAppServerPayloadFixtures.map((fixture) => fixture.expected.type),
      ),
    ).toEqual(
      new Set([
        "agentmessage",
        "toolcall",
        "toolresult",
        "error",
        "state",
        "reasoning",
        "raw",
      ]),
    );
  });
});
