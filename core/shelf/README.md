# Shelf

`@curator/core/shelf` provides operations on users' video collections. The host
supplies an open, migrated database connection and a trusted actor.

## Add recommendations

```ts
import type { Actor } from "@curator/core/identity";
import { addRecommendation } from "@curator/core/shelf";

// Resolved by trusted host code from a verified session or single-user configuration.
const actor: Actor = { userId: "existing-user-id" };

const recommendation = addRecommendation(persistence.db, actor, {
  userId: "existing-user-id",
  youtubeId: "existing-video-id",
  rationale: "Explains a topic you are exploring.",
});
```

`addRecommendation()` synchronously inserts one recommendation and returns the
saved record, including its database-generated `recommendedAt` timestamp.

The actor identifies the caller; input `userId` explicitly identifies the target
shelf. After validating both, shelf requires the IDs to match. A mismatch throws
`AuthorizationError` before any database access. A missing target is invalid and
is never inferred from the actor. Hosts authenticate callers; shelf authorizes
operations. Roles and recommendations for other users are deferred.

The user and video must already exist. A duplicate `(userId, youtubeId)` pair
throws a database constraint error and leaves the existing recommendation
unchanged. Missing users or videos also throw database constraint errors.

`addRecommendationInputSchema` validates required, nonblank string fields before
insertion. Invalid input throws `ZodError` and creates no record. The input type
is inferred from this schema, which is also exported for callers. Validation
preserves supplied text and strips unknown fields.

Watched videos can be recommended; their watched records and feedback remain
unchanged. Metadata fetching, batching, and update operations are deferred.

## Get recommendations

```ts
import { getRecommendations } from "@curator/core/shelf";

const page = getRecommendations(persistence.db, actor, {
  userId: "existing-user-id",
  includeVideoMetadata: true,
  includeChannelMetadata: true,
  limit: 20,
  watchStatus: "unwatched",
  sortBy: "recommendedAt",
  sortOrder: "desc",
});

if (page.nextCursor) {
  const nextPage = getRecommendations(persistence.db, actor, {
    userId: "existing-user-id",
    includeVideoMetadata: true,
    includeChannelMetadata: true,
    limit: 20,
    watchStatus: "unwatched",
    sortOrder: "desc",
    cursor: page.nextCursor,
  });
}
```

`getRecommendations()` synchronously returns `{ items, nextCursor }`. It validates
the actor and input, then requires the actor's ID to match the explicit target
`userId` before database access. Invalid inputs or cursors throw `ZodError`;
unauthorized targets throw `AuthorizationError`. Targets are never inferred.

Each item contains `userId`, `youtubeId`, `rationale`, and `recommendedAt`. The
metadata flags independently add nested `video` and `channel` records from SQLite,
including native `Date` timestamps. Unrequested fields are omitted. Channel-only
requests are supported. Retrieval does not contact YouTube.

Only `userId` is required. Defaults are no metadata, `limit: 50`,
`watchStatus: "both"`, `sortBy: "recommendedAt"`, and `sortOrder: "desc"`.
Limits must be positive integers. Watched filters are `"watched"`, `"unwatched"`,
and `"both"`, based on the target user's watched records. Sorting currently
supports only recommendation time, with `"asc"` for oldest first and `"desc"`
for newest first. Equal timestamps are ordered by video ID in the same direction.

Pass `nextCursor` back unchanged to continue; `null` means no further results.
Cursors are tied to the target, watched filter, and sort settings. Changing those
requires starting without a cursor; metadata flags and limits may change between
pages. Deleting the recommendation that supplied a cursor does not invalidate it.
Pagination does not provide a snapshot across concurrent changes or a total count.
An empty shelf, including a nonexistent authorized target, returns an empty page.

`getRecommendationsInputSchema`, `GetRecommendationsInput`, `RecommendationItem`,
and `RecommendationsPage` are exported for callers. The input schema strips unknown
fields, applies defaults, and validates the opaque cursor while preserving its string
representation. Parsed inputs can be passed directly to `getRecommendations()`.
