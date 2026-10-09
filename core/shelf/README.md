# Shelf

`@curator/core/shelf` provides operations on users' video collections. The host
supplies an open, migrated database connection and a trusted actor.

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
