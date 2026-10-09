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
unchanged. Recommendation metadata fetching, batching, and updates are deferred.

## Get one recommendation

```ts
import { getRecommendation } from "@curator/core/shelf";

const recommendation = getRecommendation(persistence.db, actor, {
  userId: "existing-user-id",
  youtubeId: "existing-video-id",
  includeVideoMetadata: true,
  includeChannelMetadata: true,
});
```

`getRecommendation()` synchronously returns `RecommendationItem | null` for the
explicit user/video pair. It validates actor and input, then requires the actor's
user ID to match the target before database access. Invalid input throws `ZodError`;
unauthorized targets throw `AuthorizationError`. Missing pairs, including nonexistent
users or videos, return `null`. Watched videos' recommendations remain accessible.

Both metadata flags default to false and independently add stored nested `video`
and `channel` records. Unrequested fields are omitted; channel-only requests work.
Retrieval does not contact YouTube. `getRecommendationInputSchema` and
`GetRecommendationInput` are exported; the schema strips unknown fields and keeps
defaulted flags optional for callers.

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

## Watched videos

Watched operations accept `(db, actor, input)` and require an explicit target
`userId`. They validate input and actor identity, then enforce the same ownership
rule as recommendations before database access. Invalid input throws `ZodError`;
another user's target throws `AuthorizationError`.

```ts
import {
  createWatchedVideo,
  getWatchedVideo,
  getWatchedVideos,
  updateWatchedVideo,
} from "@curator/core/shelf";

const target = {
  userId: "existing-user-id",
  youtubeId: "existing-video-id",
};

const watched = createWatchedVideo(persistence.db, actor, {
  ...target,
  watchedAt: new Date("2026-01-01T12:00:00Z"),
  notes: "Helpful examples",
  ratingHalfStars: 9,
});

const updated = updateWatchedVideo(persistence.db, actor, {
  ...target,
  watchedAt: new Date("2026-01-02T12:00:00Z"),
  notes: null,
});

const single = getWatchedVideo(persistence.db, actor, {
  ...target,
  includeVideoMetadata: true,
  includeChannelMetadata: true,
});

const page = getWatchedVideos(persistence.db, actor, {
  userId: target.userId,
  includeVideoMetadata: true,
  limit: 20,
  sortBy: "watchedAt",
  sortOrder: "desc",
});
```

Creation returns the saved record. `createdAt` is generated at insertion and
immutable through shelf operations; `watchedAt` defaults to now or accepts a
supplied `Date`. Both are stored with second precision and returned as `Date`s.
Feedback is optional: `notes` accepts strings or `null`, and `ratingHalfStars`
accepts integers 1–10 or `null`. Divide by two to display 0.5–5 stars. Notes
preserve whitespace and accept empty strings. Omitted feedback is stored as `null`.
The user and video must exist. Duplicate creation rejects without changing the
existing record.

Updates return the saved record or `null` when the pair does not exist. They never
create implicitly. Supply at least one defined editable field: `watchedAt`,
`notes`, or `ratingHalfStars`. Omitted or `undefined` fields remain unchanged;
`null` clears feedback. Watch time cannot be cleared. Unknown fields are stripped;
targets and `createdAt` cannot be modified. Recommendations are preserved.

Single lookups return a watched item or `null`. Lists return `{ items, nextCursor }`.
Both independently support `includeVideoMetadata` and `includeChannelMetadata`,
defaulting to false; requested nested `video` and `channel` records come from
SQLite. Unrequested metadata is omitted, and channel-only requests work.

Lists default to `limit: 50`, `sortBy: "watchedAt"`, and `sortOrder: "desc"`.
Choose `"watchedAt"` or `"createdAt"` and `"asc"` or `"desc"`. Equal dates use
video ID in the same direction. Pass an opaque `nextCursor` back unchanged; `null`
means there are no further results. Cursors are bound to the watched operation,
target user, sort field, and direction. Limits and metadata flags may change
between pages. Deleted cursor rows do not prevent continuation. There is no
snapshot guarantee across changes, including edits to watch time. Empty targets
return empty pages.

Input schemas and types are exported for all four operations. Schemas strip
unknown fields and keep cursors as strings, allowing parsed inputs to be passed
directly to the functions. Retrieval types are `WatchedVideoItem` and
`WatchedVideosPage`.
