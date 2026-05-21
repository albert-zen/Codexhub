import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/database.js";
import { HubRepository } from "../src/repository.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "codexhub-repository-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("HubRepository item characterization", () => {
  it("stores raw payloads losslessly while deriving per-session projections", () => {
    const database = openDatabase({ path: join(tempDir, "repository.sqlite") });
    try {
      const repo = new HubRepository(database.db);
      const project = repo.createProject({ name: "raw-projection-demo" });
      const workspace = repo.createWorkspace({
        project_id: project.id,
        source_type: "local",
        path: join(tempDir, "workspace"),
        cwd: join(tempDir, "workspace"),
      });
      const firstSession = repo.createSession({
        project_id: project.id,
        workspace_id: workspace.id,
      });
      const secondSession = repo.createSession({
        project_id: project.id,
        workspace_id: workspace.id,
      });

      const firstDeltaPayload = {
        method: "item/agentMessage/delta",
        params: {
          itemId: "agent_1",
          textDelta: "partial ",
          nested: {
            flags: [true, false],
            count: 2,
            empty: null,
          },
        },
      };
      const firstDelta = repo.appendItem(firstSession.id, firstDeltaPayload);
      const otherSessionItem = repo.appendItem(secondSession.id, {
        method: "item/completed",
        params: {
          item: {
            id: "agent_other",
            type: "agentMessage",
            text: "Other session answer.",
          },
        },
      });
      const completionPayload = {
        method: "item/completed",
        params: {
          item: {
            id: "agent_1",
            type: "agentMessage",
            text: "Complete answer.",
            content: [
              { type: "text", text: "ignored fallback" },
              { type: "metadata", value: { retained: true } },
            ],
          },
        },
      };
      const completion = repo.appendItem(firstSession.id, completionPayload);

      expect(firstDelta.sequence).toBe(1);
      expect(otherSessionItem.sequence).toBe(1);
      expect(completion.sequence).toBe(2);

      expect(repo.getSession(firstSession.id)).toMatchObject({
        last_item_sequence: 2,
        last_agent_message_item_id: completion.id,
        last_agent_message: "Complete answer.",
      });
      expect(repo.getSession(secondSession.id)).toMatchObject({
        last_item_sequence: 1,
        last_agent_message: "Other session answer.",
      });

      const rawItems = repo.listItems(firstSession.id, {
        type: "agentmessage",
        limit: 10,
      });
      expect(rawItems.items.map((item) => item.sequence)).toEqual([1, 2]);
      expect(rawItems.items[0]?.raw_payload).toEqual(firstDeltaPayload);
      expect(rawItems.items[1]?.raw_payload).toEqual(completionPayload);

      const transcript = repo.listTranscript(firstSession.id, { limit: 10 });
      expect(transcript.items).toHaveLength(1);
      expect(transcript.items[0]).toMatchObject({
        kind: "agent_message",
        text: "Complete answer.",
        source_id: completion.id,
        item_ids: [firstDelta.id, completion.id],
        item_sequences: [1, 2],
      });
    } finally {
      database.close();
    }
  });
});
