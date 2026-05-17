import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "./migrations.js";

export interface OpenDatabaseOptions {
  path?: string | undefined;
  migrate?: boolean | undefined;
}

export interface CodexHubDatabase {
  db: DatabaseSync;
  path: string;
  close(): void;
}

export function defaultDatabasePath(): string {
  return (
    process.env.CODEXHUB_DB_PATH ??
    fileURLToPath(new URL("../data/codexhub.sqlite", import.meta.url))
  );
}

export function openDatabase(
  options: OpenDatabaseOptions = {},
): CodexHubDatabase {
  const path = options.path ?? defaultDatabasePath();
  ensureParentDirectory(path);

  const db = new DatabaseSync(path, {
    enableForeignKeyConstraints: true,
    timeout: 5000,
  });

  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  if (path !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL;");
  }

  if (options.migrate !== false) {
    runMigrations(db);
  }

  return {
    db,
    path,
    close() {
      if (db.isOpen) db.close();
    },
  };
}

function ensureParentDirectory(path: string): void {
  if (path === ":memory:" || path.startsWith("file:")) return;
  mkdirSync(dirname(resolve(path)), { recursive: true });
}
