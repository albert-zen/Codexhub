import type { TranscriptEntry } from "@codexhub/core";

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

function hasText(entry: TranscriptEntry): boolean {
  return Boolean(entry.text?.trim());
}

function isDeltaBackedAgentEntry(entry: TranscriptEntry): boolean {
  return entry.codex_method?.toLowerCase().includes("delta") ?? false;
}
