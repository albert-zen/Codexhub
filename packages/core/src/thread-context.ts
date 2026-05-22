import {
  projectTranscriptEntries,
  type TranscriptPageOptions,
} from "./transcript.js";
import type {
  Item,
  Message,
  ThreadAction,
  ThreadAttentionReason,
  ThreadContext,
  ThreadSummary,
  ToolCallSummary,
} from "./types.js";

export interface ThreadContextOptions extends TranscriptPageOptions {
  tools?: "hidden" | "collapsed" | "expanded";
}

export function projectThreadContext(
  thread: ThreadSummary,
  messages: Message[],
  items: Item[],
  options: ThreadContextOptions = {},
): ThreadContext {
  const transcriptPage = projectTranscriptEntries(
    thread.session_id,
    messages,
    items,
    options,
  );

  return {
    thread: threadWithMessageState(thread, messages),
    latest_agent_message: latestAgentMessage(thread, items),
    allowed_actions: allowedActions(thread),
    attention_reasons: attentionReasons(thread, messages),
    transcript: transcriptPage.items,
    tool_calls:
      options.tools === "hidden"
        ? []
        : projectToolCalls(items, { expanded: options.tools === "expanded" }),
    limit: transcriptPage.limit,
    next_cursor: transcriptPage.next_cursor,
  };
}

function threadWithMessageState(
  thread: ThreadSummary,
  messages: Message[],
): ThreadSummary {
  if (!hasFailedMessage(messages)) return thread;
  return {
    ...thread,
    conversation_state: "failedToSend",
  };
}

export function projectToolCalls(
  items: Item[],
  options: { expanded?: boolean } = {},
): ToolCallSummary[] {
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    if (item.type !== "toolcall" && item.type !== "toolresult") continue;
    const key = item.codex_item_id ?? item.id;
    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  return [...groups.entries()].map(([id, group]) => {
    const sorted = [...group].sort(
      (left, right) => left.sequence - right.sequence,
    );
    const call = sorted.find((item) => item.type === "toolcall");
    const result = [...sorted]
      .reverse()
      .find((item) => item.type === "toolresult");
    const summary: ToolCallSummary = {
      id,
      session_id: sorted[0]?.session_id ?? "",
      status: result ? "completed" : "called",
      text: call?.text_excerpt ?? null,
      result_text: result?.text_excerpt ?? null,
      item_ids: sorted.map((item) => item.id),
      item_sequences: sorted.map((item) => item.sequence),
    };
    if (options.expanded) summary.items = sorted;
    return summary;
  });
}

function latestAgentMessage(
  thread: ThreadSummary,
  items: Item[],
): string | null {
  const completed = [...items]
    .reverse()
    .find(
      (item) =>
        item.type === "agentmessage" &&
        item.codex_method === "item/completed" &&
        item.text_excerpt &&
        item.text_excerpt.trim() !== "",
    );
  return completed?.text_excerpt ?? thread.last_agent_message;
}

function allowedActions(thread: ThreadSummary): ThreadAction[] {
  if (thread.thread_state === "archived") return [];
  if (thread.runtime_state === "notStarted") return ["send"];
  if (thread.runtime_state === "failed" || thread.runtime_state === "exited") {
    return thread.codex_thread_id ? ["send"] : [];
  }
  if (thread.conversation_state === "streamingAssistant") {
    return ["stop_runtime"];
  }
  return ["send", "stop_runtime"];
}

function attentionReasons(
  thread: ThreadSummary,
  messages: Message[],
): ThreadAttentionReason[] {
  const reasons: ThreadAttentionReason[] = [];
  if (
    thread.conversation_state === "failedToSend" ||
    hasFailedMessage(messages)
  ) {
    reasons.push("failed_to_send");
  }
  if (thread.conversation_state === "failedToLoad")
    reasons.push("failed_to_load");
  if (thread.runtime_state === "failed") reasons.push("runtime_failed");
  return reasons;
}

function hasFailedMessage(messages: Message[]): boolean {
  return messages.some((message) => message.status === "failed");
}
