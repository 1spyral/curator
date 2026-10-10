import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { coreConfigSchema } from "#config";
import { openDatabase, type Persistence } from "./sqlite";

const migrationsFolder = fileURLToPath(new URL("../migrations/", import.meta.url));

export function migrateDatabase(db: Persistence["db"]) {
  migrate(db, { migrationsFolder });
}

export function getMigrationStatus(db: Persistence["db"]) {
  const expected = readMigrationFiles({ migrationsFolder });
  const exists = db.$client
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get();
  const applied = exists
    ? db.$client
        .query<{ hash: string; created_at: number }, []>(
          "SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at",
        )
        .all()
    : [];
  const drifted = applied.some((row, index) => {
    const migration = expected[index];
    return (
      !migration || row.hash !== migration.hash || Number(row.created_at) !== migration.folderMillis
    );
  });
  return {
    applied: applied.length,
    total: expected.length,
    pending: Math.max(0, expected.length - applied.length),
    drifted,
  };
}

if (import.meta.main) {
  const config = coreConfigSchema.parse({});
  const persistence = openDatabase(config.persistence);
  try {
    migrateDatabase(persistence.db);
    console.log("Database migrations applied.");
  } finally {
    persistence.close();
  }
}
