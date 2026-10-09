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

Watched videos can be recommended; their watched records and feedback remain
unchanged. Inputs are typed, with no additional runtime validation. Metadata
fetching, batching, and update operations are deferred.
