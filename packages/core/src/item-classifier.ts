import type { ItemType } from "./types.js";

export interface ClassifiedItem {
  type: ItemType;
  method: string | null;
  codexItemId: string | null;
  codexItemType: string | null;
  textExcerpt: string | null;
}

export function classifyCodexPayload(payload: unknown): ClassifiedItem {
  const obj = asRecord(payload) ?? {};
  const method = stringAt(obj, ["method"]);
  const params = recordAt(obj, ["params"]);
  const item = recordAt(params, ["item"]);
  const itemType = stringAt(item, ["type"]);
  const itemId = stringAt(item, ["id"]) ?? stringAt(params, ["itemId"]);
  const text = extractText(obj);

  if (method === "item/agentMessage/delta") {
    return result("agentmessage", method, itemId, "agentMessage", text);
  }

  if (method === "item/completed" && itemType === "agentMessage") {
    return result("agentmessage", method, itemId, itemType, text);
  }

  if (method === "item/started" && isToolLikeItem(itemType)) {
    return result("toolcall", method, itemId, itemType, text);
  }

  if (method === "item/tool/call" || method?.endsWith("/requestApproval")) {
    return result("toolcall", method, itemId, itemType, text);
  }

  if (method === "item/completed" && isToolLikeItem(itemType)) {
    return result("toolresult", method, itemId, itemType, text);
  }

  if (
    method === "item/reasoning/textDelta" ||
    method === "item/reasoning/summaryTextDelta"
  ) {
    return result("reasoning", method, itemId, itemType, text);
  }

  if (
    method === "turn/failed" ||
    method === "turn/cancelled" ||
    method === "error"
  ) {
    return result("error", method, itemId, itemType, text);
  }

  if (method?.startsWith("turn/") || method?.startsWith("thread/")) {
    return result("state", method, itemId, itemType, text);
  }

  return result("raw", method, itemId, itemType, text);
}

function result(
  type: ItemType,
  method: string | null,
  codexItemId: string | null,
  codexItemType: string | null,
  textExcerpt: string | null,
): ClassifiedItem {
  return { type, method, codexItemId, codexItemType, textExcerpt };
}

function isToolLikeItem(itemType: string | null): boolean {
  return (
    itemType === "commandExecution" ||
    itemType === "fileChange" ||
    itemType === "mcpToolCall" ||
    itemType === "dynamicToolCall" ||
    itemType === "collabToolCall"
  );
}

function extractText(payload: Record<string, unknown>): string | null {
  const candidates = [
    stringAt(payload, ["params", "textDelta"]),
    stringAt(payload, ["params", "delta"]),
    stringAt(payload, ["params", "outputDelta"]),
    stringAt(payload, ["params", "item", "text"]),
    extractContentText(unknownAt(payload, ["params", "item", "content"])),
    stringAt(payload, ["error", "message"]),
  ];

  const text = candidates.find(
    (candidate) => candidate && candidate.trim() !== "",
  );
  return text ? text.slice(0, 4000) : null;
}

function extractContentText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;

  const text = content
    .map((entry) => {
      const record = asRecord(entry);
      return stringAt(record, ["text"]) ?? "";
    })
    .filter(Boolean)
    .join("\n");

  return text || null;
}

function unknownAt(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    const record = asRecord(current);
    if (!record || !(key in record)) return null;
    current = record[key];
  }
  return current;
}

function recordAt(
  value: unknown,
  path: string[],
): Record<string, unknown> | null {
  return asRecord(unknownAt(value, path));
}

function stringAt(value: unknown, path: string[]): string | null {
  const result = unknownAt(value, path);
  return typeof result === "string" ? result : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
