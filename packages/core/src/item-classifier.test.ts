import { describe, expect, it } from "vitest";
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
  });

  it("keeps unknown payloads as raw", () => {
    expect(classifyCodexPayload({ method: "future/event" }).type).toBe("raw");
  });
});
