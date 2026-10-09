# Persistence

SQLite persistence code lives in `core/persistence/src`, using Drizzle ORM and Bun's native
SQLite driver. Run commands from the repository root:

```sh
bun install
bun run db:migrate
```

The host loads configuration once with `loadCoreConfig()` from
`@curator/core/config`, then passes `config.persistence` to
`openDatabase(config.persistence)`. Persistence owns the `PersistenceConfig`
type. The default database path is `.data/curator.sqlite`; set
`CURATOR_DATABASE_PATH` to override it. Relative paths resolve from the
repository root.

Define tables in `core/persistence/src/schema/` and export them from its `index.ts`.
After editing the schema, generate and review a migration:

```sh
bun run db:generate --name=describe_change
bun run db:migrate
```

Commit generated SQL and metadata in `core/persistence/migrations`. Applied
migrations are tracked by Drizzle; rerunning the migration command applies only
pending migrations. Add new migrations instead of editing already applied ones.

Use persistence through core's export:

```ts
import { loadCoreConfig } from "@curator/core/config";
import { openDatabase, migrateDatabase } from "@curator/core/persistence";

const config = loadCoreConfig();
const persistence = openDatabase(config.persistence);
try {
  migrateDatabase(persistence.db);
  // Use persistence.db here.
} finally {
  persistence.close();
}
```

Opening a connection does not apply migrations automatically. The initial schema
contains users with text IDs; local-user initialization and authentication can
use this same table as those features are added.
