import type { DatabaseSync } from "node:sqlite";
import {
  classifyCodexPayload,
  type Item,
  type ItemType,
  type WorkerSession,
} from "@codexhub/core";
import type { ItemPageOptions } from "./repository.js";
import {
  clampLimit,
  encodeJson,
  id,
  isoNow,
  itemFromRow,
  sessionFromRow,
} from "./repository-sql.js";

export class RawItemLogStore {
  constructor(private readonly db: DatabaseSync) {}

  appendItem(sessionId: string, payload: unknown): Item {
    const session = this.requireSession(sessionId);
    const sequence = session.last_item_sequence + 1;
    const classification = classifyCodexPayload(payload);
    const now = isoNow();
    const item: Item = {
      id: id("item"),
      session_id: sessionId,
      sequence,
      type: classification.type,
      codex_method: classification.method,
      codex_item_id: classification.codexItemId,
      codex_item_type: classification.codexItemType,
      created_at: now,
      raw_payload: payload,
      text_excerpt: classification.textExcerpt,
    };

    this.db
      .prepare(
        `INSERT INTO items (
          id, session_id, sequence, type, codex_method, codex_item_id,
          codex_item_type, created_at, raw_payload_json, text_excerpt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        item.id,
        item.session_id,
        item.sequence,
        item.type,
        item.codex_method,
        item.codex_item_id,
        item.codex_item_type,
        item.created_at,
        encodeJson(item.raw_payload) ?? "null",
        item.text_excerpt,
      );

    const completedAgentMessage =
      item.type === "agentmessage" &&
      item.codex_method === "item/completed" &&
      item.text_excerpt &&
      item.text_excerpt.trim() !== ""
        ? item
        : null;

    if (completedAgentMessage) {
      this.db
        .prepare(
          `UPDATE worker_sessions
           SET last_item_sequence = ?, last_agent_message_item_id = ?,
               last_agent_message = ?, last_agent_message_at = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          item.sequence,
          completedAgentMessage.id,
          completedAgentMessage.text_excerpt,
          completedAgentMessage.created_at,
          now,
          sessionId,
        );
    } else {
      this.db
        .prepare(
          "UPDATE worker_sessions SET last_item_sequence = ?, updated_at = ? WHERE id = ?",
        )
        .run(item.sequence, now, sessionId);
    }

    return item;
  }

  listItems(
    sessionId: string,
    options: ItemPageOptions = {},
  ): {
    items: Item[];
    next_cursor: string | null;
    limit: number;
  } {
    const limit = clampLimit(options.limit, 20, 200);
    const after = options.after ?? 0;
    const before = options.before;
    const type = options.type ?? "agentmessage";
    const noTypeFilter = type === "all";

    if (options.recent && after === 0 && before === undefined) {
      const sql = noTypeFilter
        ? `SELECT * FROM items WHERE session_id = ? ORDER BY sequence DESC LIMIT ?`
        : `SELECT * FROM items WHERE session_id = ? AND type = ? ORDER BY sequence DESC LIMIT ?`;
      const rows = noTypeFilter
        ? this.db.prepare(sql).all(sessionId, limit + 1)
        : this.db.prepare(sql).all(sessionId, type, limit + 1);
      const items = rows
        .map(itemFromRow)
        .slice(0, limit)
        .sort((left, right) => left.sequence - right.sequence);
      return {
        items,
        limit,
        next_cursor: null,
      };
    }

    const where = ["session_id = ?", "sequence > ?"];
    const values: Array<string | number> = [sessionId, after];
    if (!noTypeFilter) {
      where.push("type = ?");
      values.push(type);
    }
    if (before !== undefined && before !== null) {
      where.push("sequence < ?");
      values.push(before);
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM items WHERE ${where.join(" AND ")}
         ORDER BY sequence ASC LIMIT ?`,
      )
      .all(...values, limit + 1);
    const items = rows.map(itemFromRow).slice(0, limit);
    const extra = rows.length > limit;
    return {
      items,
      limit,
      next_cursor:
        extra && items.length > 0
          ? String(items[items.length - 1]?.sequence)
          : null,
    };
  }

  getItem(id: string): Item | null {
    const row = this.db
      .prepare("SELECT * FROM items WHERE id = ? LIMIT 1")
      .get(id);
    return row ? itemFromRow(row) : null;
  }

  latestItem(
    sessionId: string,
    type: ItemType | "all" = "agentmessage",
  ): Item | null {
    const noTypeFilter = type === "all";
    const row = noTypeFilter
      ? this.db
          .prepare(
            "SELECT * FROM items WHERE session_id = ? ORDER BY sequence DESC LIMIT 1",
          )
          .get(sessionId)
      : this.db
          .prepare(
            "SELECT * FROM items WHERE session_id = ? AND type = ? ORDER BY sequence DESC LIMIT 1",
          )
          .get(sessionId, type);
    return row ? itemFromRow(row) : null;
  }

  latestCompletedAgentMessage(sessionId: string): Item | null {
    const row = this.db
      .prepare(
        `SELECT * FROM items
         WHERE session_id = ?
           AND type = 'agentmessage'
           AND codex_method = 'item/completed'
           AND text_excerpt IS NOT NULL
           AND trim(text_excerpt) <> ''
         ORDER BY sequence DESC LIMIT 1`,
      )
      .get(sessionId);
    return row ? itemFromRow(row) : null;
  }

  private requireSession(id: string): WorkerSession {
    const row = this.db
      .prepare("SELECT * FROM worker_sessions WHERE id = ? LIMIT 1")
      .get(id);
    if (!row) throw new Error(`session not found: ${id}`);
    return sessionFromRow(row);
  }
}
