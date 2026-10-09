# YouTube

`@curator/core/youtube` fetches video and channel metadata by YouTube ID. The
module does not save metadata to the database. Metadata types are independent
of the persistence schema.

```ts
import { parseCoreConfig } from "@curator/core/config";
import { createYouTubeProvider } from "@curator/core/youtube";

const config = parseCoreConfig({
  youtube: {
    provider: "youtube-data-api",
    youtubeDataApi: { apiKey: process.env.YOUTUBE_DATA_API_KEY },
  },
});
const youtube = createYouTubeProvider(config.youtube);
const result = await youtube.getVideo("dQw4w9WgXcQ");
if (result.success) {
  console.log(result.data.title);
} else {
  console.log(result.error.code, result.error.message);
}
```

The host supplies config objects; the module reads neither environment variables
nor files. The selector defaults to `youtube-data-api`, the only implemented
provider. Config parsing permits a missing key for database-only commands, but
provider creation requires a nonempty key. Unsupported selectors and malformed
config throw errors. Keep the provider and its credentials in server-side code.

`getVideo(id)` returns `youtubeId`, `title`, `channelId`, `durationSeconds`,
`publishedAt` as a `Date`, and `thumbnailUrl`. `getChannel(id)` returns
`youtubeId` and `title`. Both accept individual IDs, not URLs, handles, or lists.

Lookups return `{ success: true, data }` or `{ success: false, error }`. Failure
codes are `invalid-input`, `not-found`, `invalid-response`, `provider-error`,
`network-error`, and `timeout`. HTTP failures include `status` and a Google
`reason` when available. Empty successful item lists are `not-found`; missing
or invalid required metadata is `invalid-response`. Errors do not expose
credential-bearing request URLs or raw provider messages.

The adapter uses native fetch with a 15-second timeout and no automatic retry.
Pass `{ fetch: yourFetcher }` as the factory's second argument for mocked tests.
Video duration is converted to integer seconds, and thumbnails are selected in
order: maxres, standard, high, medium, default.

Enable YouTube Data API v3 for the key's Google Cloud project. Endpoint details:
[videos.list](https://developers.google.com/youtube/v3/docs/videos/list) and
[channels.list](https://developers.google.com/youtube/v3/docs/channels/list).
Search, batching, caching, fallback providers, and database ingestion are deferred.
