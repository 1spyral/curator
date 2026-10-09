# Persistence

SQLite persistence code lives in `core/persistence/src`, using Drizzle ORM and Bun's native
SQLite driver. Run commands from the repository root:

```sh
bun install
bun run db:migrate
```

The host supplies an object to `parseCoreConfig()` from `@curator/core/config`,
then passes `config.persistence` to `openDatabase(config.persistence)`.
Persistence owns its config type, parser, and defaults. Parsers accept objects
and do not read files or environment variables.

The default database path is `.data/curator.sqlite`. The migration command reads
`CURATOR_DATABASE_PATH` and supplies it to the parser to override the default.
Relative paths resolve from the repository root. Other hosts can supply settings
from environment variables, parsed JSON, or values already in memory.

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
import { parseCoreConfig } from "@curator/core/config";
import { openDatabase, migrateDatabase } from "@curator/core/persistence";

const config = parseCoreConfig({
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
`watchedAt` timestamp and optional `notes` and `ratingHalfStars`. Timestamps
default to insertion time and are exposed as JavaScript `Date` values.

Each table allows one record per `(userId, youtubeId)` pair. A watched record
can exist without a recommendation, and watching does not remove an existing
recommendation. Feedback can be added, edited, or cleared later.

`ratingHalfStars` is an integer from 1 to 10, or `null` for no rating. Divide it
by two for the displayed 0.5–5 star rating. The database rejects fractional
values and values outside this range.

Both relationships require existing users and videos. Deleting a user or video
cascades to its recommendation and watched records. Workflow operations belong
in future core library functions; this schema does not implement them.
