import type { ItemType } from "../types.js";

export interface CodexPayloadFixture {
  name: string;
  payload: Record<string, unknown>;
  expected: {
    type: ItemType;
    method: string | null;
    codexItemId: string | null;
    codexItemType: string | null;
    textExcerpt?: string | null;
  };
}

export const codexAppServerPayloadFixtures = [
  {
    name: "agent message delta",
    payload: {
      method: "item/agentMessage/delta",
      params: {
        itemId: "item_agent_delta_1",
        textDelta: "I will inspect the repository.",
      },
    },
    expected: {
      type: "agentmessage",
      method: "item/agentMessage/delta",
      codexItemId: "item_agent_delta_1",
      codexItemType: "agentMessage",
      textExcerpt: "I will inspect the repository.",
    },
  },
  {
    name: "completed agent message",
    payload: {
      method: "item/completed",
      params: {
        item: {
          id: "item_agent_1",
          type: "agentMessage",
          content: [
            {
              type: "output_text",
              text: "The tests pass and the implementation is ready.",
            },
          ],
        },
      },
    },
    expected: {
      type: "agentmessage",
      method: "item/completed",
      codexItemId: "item_agent_1",
      codexItemType: "agentMessage",
      textExcerpt: "The tests pass and the implementation is ready.",
    },
  },
  {
    name: "command execution started",
    payload: {
      method: "item/started",
      params: {
        item: {
          id: "item_cmd_1",
          type: "commandExecution",
          command: "pnpm",
          args: ["--filter", "@codexhub/core", "test"],
          cwd: "D:\\desktop\\codex-hub",
        },
      },
    },
    expected: {
      type: "toolcall",
      method: "item/started",
      codexItemId: "item_cmd_1",
      codexItemType: "commandExecution",
      textExcerpt: null,
    },
  },
  {
    name: "mcp tool call",
    payload: {
      method: "item/tool/call",
      params: {
        item: {
          id: "item_tool_1",
          type: "mcpToolCall",
          server: "linear",
          tool: "list_issues",
          arguments: {
            query: "startup reconciliation",
          },
        },
      },
    },
    expected: {
      type: "toolcall",
      method: "item/tool/call",
      codexItemId: "item_tool_1",
      codexItemType: "mcpToolCall",
      textExcerpt: null,
    },
  },
  {
    name: "command execution completed",
    payload: {
      method: "item/completed",
      params: {
        item: {
          id: "item_cmd_1",
          type: "commandExecution",
          exitCode: 0,
          aggregatedOutput: "Test Files 1 passed (1)\nTests 3 passed (3)",
        },
      },
    },
    expected: {
      type: "toolresult",
      method: "item/completed",
      codexItemId: "item_cmd_1",
      codexItemType: "commandExecution",
      textExcerpt: null,
    },
  },
  {
    name: "reasoning text delta",
    payload: {
      method: "item/reasoning/textDelta",
      params: {
        itemId: "item_reasoning_1",
        textDelta: "Need to verify persisted transient sessions.",
      },
    },
    expected: {
      type: "reasoning",
      method: "item/reasoning/textDelta",
      codexItemId: "item_reasoning_1",
      codexItemType: null,
      textExcerpt: "Need to verify persisted transient sessions.",
    },
  },
  {
    name: "turn failed",
    payload: {
      method: "turn/failed",
      params: {
        threadId: "thread_1",
        turnId: "turn_1",
        error: {
          message:
            "Codex app-server process exited before completing the turn.",
        },
      },
    },
    expected: {
      type: "error",
      method: "turn/failed",
      codexItemId: null,
      codexItemType: null,
      textExcerpt:
        "Codex app-server process exited before completing the turn.",
    },
  },
  {
    name: "turn completed",
    payload: {
      method: "turn/completed",
      params: {
        threadId: "thread_1",
        turnId: "turn_1",
        usage: {
          inputTokens: 1200,
          outputTokens: 240,
        },
      },
    },
    expected: {
      type: "state",
      method: "turn/completed",
      codexItemId: null,
      codexItemType: null,
      textExcerpt: null,
    },
  },
  {
    name: "unknown future event",
    payload: {
      method: "future/event",
      params: {
        item: {
          id: "item_future_1",
          type: "futureThing",
        },
      },
    },
    expected: {
      type: "raw",
      method: "future/event",
      codexItemId: "item_future_1",
      codexItemType: "futureThing",
      textExcerpt: null,
    },
  },
] satisfies CodexPayloadFixture[];
