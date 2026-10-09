# Shelf

`@curator/core/shelf` provides operations on users' video collections. The host
supplies an open, migrated database connection.

```ts
import { addRecommendation } from "@curator/core/shelf";

const recommendation = addRecommendation(persistence.db, {
  userId: "existing-user-id",
  youtubeId: "existing-video-id",
  rationale: "Explains a topic you are exploring.",
});
```

`addRecommendation()` synchronously inserts one recommendation and returns the
saved record, including its database-generated `recommendedAt` timestamp.

The user and video must already exist. A duplicate `(userId, youtubeId)` pair
throws a database constraint error and leaves the existing recommendation
unchanged. Missing users or videos also throw database constraint errors.

`addRecommendationInputSchema` validates required, nonblank string fields before
insertion. Invalid input throws `ZodError` and creates no record. The input type
is inferred from this schema, which is also exported for callers. Validation
preserves supplied text and strips unknown fields.

Watched videos can be recommended; their watched records and feedback remain
unchanged. Metadata fetching, batching, and update operations are deferred.
