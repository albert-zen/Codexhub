import type {
  Item,
  Message,
  Page,
  TranscriptEntry,
  TranscriptEntryKind,
  TranscriptEntryRole,
} from "./types.js";

export interface TranscriptPageOptions {
  limit?: number;
  after?: number | null;
  before?: number | null;
  recent?: boolean;
}

interface DraftTranscriptEntry extends Omit<TranscriptEntry, "sequence"> {
  sort_source: "message" | "item";
  sort_sequence: number;
}

export function projectTranscriptEntries(
  sessionId: string,
  messages: Message[],
  items: Item[],
  options: TranscriptPageOptions = {},
): Page<TranscriptEntry> {
  const entries = buildTranscriptEntries(sessionId, messages, items);
  const limit = clampLimit(options.limit, 20, 100);
  const after = options.after ?? 0;
  const before = options.before;

  if (options.recent && after === 0 && before === undefined) {
    return {
      items: entries.slice(Math.max(0, entries.length - limit)),
      limit,
      next_cursor: null,
    };
  }

  const filtered = entries.filter(
    (entry) =>
      entry.sequence > after &&
      (before === undefined || before === null || entry.sequence < before),
  );
  const page = filtered.slice(0, limit);
  return {
    items: page,
    limit,
    next_cursor:
      filtered.length > limit && page.length > 0
        ? String(page[page.length - 1]?.sequence)
        : null,
  };
}

export function buildTranscriptEntries(
  sessionId: string,
  messages: Message[],
  items: Item[],
): TranscriptEntry[] {
  const drafts: DraftTranscriptEntry[] = [
    ...messages.filter(isSentMessage).map(messageEntry),
    ...itemEntries(sessionId, items),
  ];

  return drafts
    .sort(compareDrafts)
    .map(
      (
        { sort_source: _sortSource, sort_sequence: _sortSequence, ...entry },
        index,
      ) => ({
        ...entry,
        sequence: index + 1,
      }),
    );
}

function messageEntry(message: Message): DraftTranscriptEntry {
  const createdAt = message.sent_at ?? message.created_at;
  return {
    id: `message:${message.id}`,
    session_id: message.session_id,
    kind: "message",
    role: message.sender_type,
    source: "message",
    source_id: message.id,
    created_at: createdAt,
    text: message.content,
    message_mode: message.mode,
    message_status: message.status,
    sender_type: message.sender_type,
    item_type: null,
    codex_method: null,
    codex_item_id: null,
    codex_item_type: null,
    item_ids: [],
    item_sequences: [],
    sort_source: "message",
    sort_sequence: 0,
  };
}

function itemEntries(sessionId: string, items: Item[]): DraftTranscriptEntry[] {
  const sorted = [...items].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const agentGroups = new Map<string, Item[]>();
  const entries: DraftTranscriptEntry[] = [];

  for (const item of sorted) {
    if (item.type === "agentmessage") {
      const key = item.codex_item_id
        ? `codex:${item.codex_item_id}`
        : `item:${item.id}`;
      const group = agentGroups.get(key);
      if (group) {
        group.push(item);
      } else {
        agentGroups.set(key, [item]);
      }
      continue;
    }

    entries.push(itemEntry(sessionId, item));
  }

  for (const group of agentGroups.values()) {
    entries.push(agentEntry(sessionId, group));
  }

  return entries;
}

function itemEntry(sessionId: string, item: Item): DraftTranscriptEntry {
  const kind =
    item.type === "toolcall" || item.type === "toolresult" ? "tool" : "debug";
  return {
    id: `item:${item.id}`,
    session_id: sessionId,
    kind,
    role: roleForKind(kind),
    source: "item",
    source_id: item.id,
    created_at: item.created_at,
    text: item.text_excerpt,
    message_mode: null,
    message_status: null,
    sender_type: null,
    item_type: item.type,
    codex_method: item.codex_method,
    codex_item_id: item.codex_item_id,
    codex_item_type: item.codex_item_type,
    item_ids: [item.id],
    item_sequences: [item.sequence],
    sort_source: "item",
    sort_sequence: item.sequence,
  };
}

function agentEntry(sessionId: string, group: Item[]): DraftTranscriptEntry {
  const sorted = [...group].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const first = required(sorted[0], "agent message group is empty");
  const last = required(
    sorted[sorted.length - 1],
    "agent message group is empty",
  );
  const completed = [...sorted]
    .reverse()
    .find(
      (item) =>
        item.codex_method === "item/completed" &&
        item.text_excerpt !== null &&
        item.text_excerpt.trim() !== "",
    );
  const source = completed ?? last;
  const text =
    completed?.text_excerpt ??
    emptyToNull(sorted.map((item) => item.text_excerpt ?? "").join(""));
  const codexItemId = first.codex_item_id ?? source.codex_item_id;

  return {
    id: `agent:${codexItemId ?? first.id}`,
    session_id: sessionId,
    kind: "agent_message",
    role: "agent",
    source: "item",
    source_id: source.id,
    created_at: first.created_at,
    text,
    message_mode: null,
    message_status: null,
    sender_type: null,
    item_type: source.type,
    codex_method: source.codex_method,
    codex_item_id: codexItemId,
    codex_item_type: source.codex_item_type,
    item_ids: sorted.map((item) => item.id),
    item_sequences: sorted.map((item) => item.sequence),
    sort_source: "item",
    sort_sequence: first.sequence,
  };
}

function compareDrafts(
  left: DraftTranscriptEntry,
  right: DraftTranscriptEntry,
): number {
  const byTime = left.created_at.localeCompare(right.created_at);
  if (byTime !== 0) return byTime;

  if (left.sort_source !== right.sort_source) {
    return left.sort_source === "message" ? -1 : 1;
  }

  const bySequence = left.sort_sequence - right.sort_sequence;
  if (bySequence !== 0) return bySequence;

  return left.source_id.localeCompare(right.source_id);
}

function roleForKind(kind: TranscriptEntryKind): TranscriptEntryRole {
  if (kind === "tool") return "tool";
  return "debug";
}

function isSentMessage(message: Message): boolean {
  return message.status === "sent";
}

function emptyToNull(value: string): string | null {
  return value.trim() === "" ? null : value;
}

function clampLimit(
  value: number | undefined,
  fallback: number,
  max: number,
): number {
  if (!Number.isInteger(value) || value === undefined || value < 1)
    return fallback;
  return Math.min(value, max);
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}
