import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { loadCoreConfig } from "#config";
import { openDatabase, type Persistence } from "./sqlite";

export function migrateDatabase(db: Persistence["db"]) {
  migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../migrations/", import.meta.url)),
  });
}

if (import.meta.main) {
  const config = loadCoreConfig();
  const persistence = openDatabase(config.persistence);
  try {
    migrateDatabase(persistence.db);
    console.log("Database migrations applied.");
  } finally {
    persistence.close();
  }
}
