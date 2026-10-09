# Persistence

SQLite persistence code lives in `core/persistence/src`, using Drizzle ORM and Bun's native
SQLite driver. Run commands from the repository root:

```sh
bun install
bun run db:migrate
```

The host supplies an object to `coreConfigSchema.parse(input)` from `@curator/core/config`,
then passes `config.persistence` to `openDatabase(config.persistence)`.
Persistence owns its config schema, type, and defaults. Schemas accept objects
and do not read files or environment variables.

`persistenceConfigSchema` is the exported Zod schema; `PersistenceConfig` is
inferred from it. Unknown config fields and invalid values throw `ZodError`
through `persistenceConfigSchema.parse(input)` or `coreConfigSchema.parse(input)`.
Both schemas apply defaults and produce frozen config objects.

The migration command uses the default database path, `.data/curator.sqlite`.
To migrate another database, the host passes its config to `openDatabase()` and
calls `migrateDatabase()` with the resulting connection. Relative paths resolve
from the repository root. Hosts supply configuration as objects.

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
import { coreConfigSchema } from "@curator/core/config";
import { openDatabase, migrateDatabase } from "@curator/core/persistence";

const config = coreConfigSchema.parse({
  persistence: { databasePath: "./data/curator.sqlite" },
});
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

## YouTube metadata

`youtubeChannels` stores a channel's `youtubeId` and `title`. `youtubeVideos`
stores `youtubeId`, `title`, `channelId`, `durationSeconds`, `publishedAt`, and
`thumbnailUrl`. All fields are required. `publishedAt` is stored as Unix seconds
and exposed as a JavaScript `Date`.

Insert or update the channel before inserting its videos. Each video references
an existing channel, and a channel cannot be deleted while videos reference it.
Channel and video YouTube IDs are their respective primary keys. Derive watch
URLs from video IDs.

## User recommendations and watched videos

`videoRecommendations` links a user and video with a required `rationale` and
`recommendedAt` timestamp. `watchedVideos` links a user and video with a
`watchedAt` timestamp, a `createdAt` timestamp, and optional `notes` and `ratingHalfStars`. Timestamps
default to insertion time and are exposed as JavaScript `Date` values with second
precision. Shelf operations keep `createdAt` immutable while allowing watch-time
corrections. Migration `0003_watched_created_at` backfills legacy creation times
from `watchedAt` as an approximation; the original creation times were not recorded.

Each table allows one record per `(userId, youtubeId)` pair. A watched record
can exist without a recommendation, and watching does not remove an existing
recommendation. Feedback can be added, edited, or cleared later.

`ratingHalfStars` is an integer from 1 to 10, or `null` for no rating. Divide it
by two for the displayed 0.5–5 star rating. The database rejects fractional
values and values outside this range.

Both relationships require existing users and videos. Deleting a user or video
cascades to its recommendation and watched records. Authorized workflow operations
live in [Shelf](../shelf/README.md).
