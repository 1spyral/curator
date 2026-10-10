import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import type { PersistenceConfig } from "#persistence/config";
import { resolveDatabasePath } from "./paths";
import * as schema from "./schema";

export function openDatabase(config: PersistenceConfig, options: { readOnly?: boolean } = {}) {
  const path = resolveDatabasePath(config.databasePath);
  if (!options.readOnly && path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

  const sqlite = new Database(path, {
    create: !options.readOnly,
    readonly: options.readOnly ?? false,
    strict: true,
  });
  try {
    sqlite.exec("PRAGMA busy_timeout = 5000;");
    if (!options.readOnly) {
      sqlite.exec("PRAGMA foreign_keys = ON;");
      sqlite.exec("PRAGMA journal_mode = WAL;");
    }
    const db = drizzle(sqlite, { schema });

    return { db, close: () => sqlite.close() };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

export type Persistence = ReturnType<typeof openDatabase>;
