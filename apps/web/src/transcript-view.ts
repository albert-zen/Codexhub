import type { TranscriptEntry } from "@codexhub/core";

export interface TranscriptCursor {
  afterSequence: number | null;
  recent: boolean;
}

export const RECENT_TRANSCRIPT_CURSOR: TranscriptCursor = {
  afterSequence: null,
  recent: true,
};

export function conversationEntries(
  entries: TranscriptEntry[],
): TranscriptEntry[] {
  return entries.filter((entry) => {
    if (entry.kind === "message") return hasText(entry);
    if (entry.kind === "agent_message")
      return hasText(entry) && !isDeltaBackedAgentEntry(entry);
    if (entry.kind === "tool") return true;
    return false;
  });
}

export function conversationWindow(
  entries: TranscriptEntry[],
  limit: number,
): TranscriptEntry[] {
  const visibleEntries = conversationEntries(entries);
  return visibleEntries.slice(Math.max(0, visibleEntries.length - limit));
}

function hasText(entry: TranscriptEntry): boolean {
  return Boolean(entry.text?.trim());
}

function isDeltaBackedAgentEntry(entry: TranscriptEntry): boolean {
  return entry.codex_method?.toLowerCase().includes("delta") ?? false;
}
