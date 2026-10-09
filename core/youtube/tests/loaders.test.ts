import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import {
  migrateDatabase,
  openDatabase,
  type Persistence,
  users,
  videoRecommendations,
  watchedVideos,
  youtubeChannels,
  youtubeVideos,
} from "@curator/core/persistence";
import {
  createYouTubeProvider,
  loadChannel,
  loadVideo,
  type VideoMetadata,
  type YouTubeProvider,
  youtubeConfigSchema,
} from "@curator/core/youtube";

let persistence: Persistence;
const video: VideoMetadata = {
  youtubeId: "video-1",
  title: "Video",
  channelId: "channel-1",
  channelTitle: "Channel",
  durationSeconds: 120,
  publishedAt: new Date("2026-01-01T12:00:00Z"),
  thumbnailUrl: "https://example.com/image.jpg",
};

function provider(metadata = video) {
  return {
    getVideo: mock(async () => ({ success: true as const, data: metadata })),
    getChannel: mock(async () => ({
      success: true as const,
      data: { youtubeId: metadata.channelId, title: metadata.channelTitle },
    })),
  };
}

beforeEach(() => {
  persistence = openDatabase({ databasePath: ":memory:" });
  migrateDatabase(persistence.db);
});
afterEach(() => persistence.close());

test("loads a video and its missing channel from a single API request", async () => {
  const fetcher = mock(async () =>
    Response.json({
      items: [
        {
          id: video.youtubeId,
          snippet: {
            title: video.title,
            channelId: video.channelId,
            channelTitle: video.channelTitle,
            publishedAt: video.publishedAt.toISOString(),
            thumbnails: { high: { url: video.thumbnailUrl } },
          },
          contentDetails: { duration: "PT2M" },
        },
      ],
    }),
  );
  const youtube = createYouTubeProvider(
    youtubeConfigSchema.parse({ youtubeDataApi: { apiKey: "test-key" } }),
    { fetch: fetcher },
  );
  const { channelTitle, ...record } = video;
  expect(await loadVideo(persistence.db, youtube, { youtubeId: video.youtubeId })).toEqual({
    success: true,
    data: record,
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(persistence.db.select().from(youtubeChannels).all()).toEqual([
    { youtubeId: video.channelId, title: channelTitle },
  ]);
  expect(persistence.db.select().from(youtubeVideos).all()).toEqual([record]);
});

test("refreshes all video and channel details while preserving shelf relationships", async () => {
  const { db } = persistence;
  await loadVideo(db, provider(), { youtubeId: video.youtubeId });
  db.insert(users).values({ id: "user-1", name: "User" }).run();
  db.insert(videoRecommendations)
    .values({ userId: "user-1", youtubeId: video.youtubeId, rationale: "Watch this" })
    .run();
  db.insert(watchedVideos)
    .values({ userId: "user-1", youtubeId: video.youtubeId, notes: "Notes", ratingHalfStars: 9 })
    .run();
  const recommendation = db.select().from(videoRecommendations).get();
  const watched = db.select().from(watchedVideos).get();
  const refreshed = {
    ...video,
    title: "Updated",
    channelTitle: "Renamed",
    durationSeconds: 150,
    publishedAt: new Date("2026-02-01T00:00:00Z"),
    thumbnailUrl: "https://example.com/new.jpg",
  };
  const youtube = provider(refreshed);
  const { channelTitle, ...record } = refreshed;
  for (let i = 0; i < 2; i++) {
    expect(await loadVideo(db, youtube, { youtubeId: video.youtubeId })).toEqual({
      success: true,
      data: record,
    });
  }
  expect(youtube.getVideo).toHaveBeenCalledTimes(2);
  expect(youtube.getChannel).not.toHaveBeenCalled();
  expect(db.select().from(youtubeVideos).all()).toEqual([record]);
  expect(db.select().from(youtubeChannels).all()).toEqual([
    { youtubeId: video.channelId, title: channelTitle },
  ]);
  expect(db.select().from(videoRecommendations).get()).toEqual(recommendation);
  expect(db.select().from(watchedVideos).get()).toEqual(watched);
});

test("loads and refreshes a channel independently without fetching videos", async () => {
  const { db } = persistence;
  const youtube = provider();
  expect(await loadChannel(db, youtube, { youtubeId: video.channelId })).toEqual({
    success: true,
    data: { youtubeId: video.channelId, title: video.channelTitle },
  });
  expect(
    await loadChannel(db, provider({ ...video, channelTitle: "Renamed" }), {
      youtubeId: video.channelId,
    }),
  ).toEqual({
    success: true,
    data: { youtubeId: video.channelId, title: "Renamed" },
  });
  expect(youtube.getVideo).not.toHaveBeenCalled();
  expect(db.select().from(youtubeChannels).all()).toEqual([
    { youtubeId: video.channelId, title: "Renamed" },
  ]);
  expect(db.select().from(youtubeVideos).all()).toEqual([]);
});

test("invalid inputs, provider failures, and invalid metadata leave existing records unchanged", async () => {
  const { db } = persistence;
  await loadVideo(db, provider(), { youtubeId: video.youtubeId });
  const videos = db.select().from(youtubeVideos).all();
  const channels = db.select().from(youtubeChannels).all();
  const youtube = provider();
  for (const youtubeId of ["", " ", "https://youtube.com/watch?v=test", "first,second"]) {
    expect(await loadVideo(db, youtube, { youtubeId })).toMatchObject({
      success: false,
      error: { code: "invalid-input" },
    });
    expect(await loadChannel(db, youtube, { youtubeId })).toMatchObject({
      success: false,
      error: { code: "invalid-input" },
    });
  }
  expect(youtube.getVideo).not.toHaveBeenCalled();
  expect(youtube.getChannel).not.toHaveBeenCalled();
  const failure = {
    success: false as const,
    error: { code: "not-found" as const, message: "Not found" },
  };
  const unavailable: YouTubeProvider = {
    getVideo: async () => failure,
    getChannel: async () => failure,
  };
  expect(await loadVideo(db, unavailable, { youtubeId: video.youtubeId })).toEqual(failure);
  expect(await loadChannel(db, unavailable, { youtubeId: video.channelId })).toEqual(failure);
  for (const metadata of [
    { ...video, title: " " },
    { ...video, youtubeId: "other", channelId: "other-channel" },
    { ...video, channelTitle: " " },
  ]) {
    expect(await loadVideo(db, provider(metadata), { youtubeId: video.youtubeId })).toMatchObject({
      success: false,
      error: { code: "invalid-response" },
    });
  }
  for (const metadata of [
    { ...video, channelId: "other" },
    { ...video, channelTitle: " " },
  ]) {
    expect(await loadChannel(db, provider(metadata), { youtubeId: video.channelId })).toMatchObject(
      { success: false, error: { code: "invalid-response" } },
    );
  }
  expect(db.select().from(youtubeVideos).all()).toEqual(videos);
  expect(db.select().from(youtubeChannels).all()).toEqual(channels);
});

test("rolls back channel creation and refresh if the video write fails", async () => {
  const { db } = persistence;
  db.$client.exec(
    `CREATE TRIGGER reject_video BEFORE INSERT ON youtube_videos BEGIN SELECT RAISE(ABORT, 'rejected video'); END;`,
  );
  await expect(loadVideo(db, provider(), { youtubeId: video.youtubeId })).rejects.toThrow(
    "rejected video",
  );
  expect(db.select().from(youtubeChannels).all()).toEqual([]);
  db.insert(youtubeChannels).values({ youtubeId: video.channelId, title: "Original" }).run();
  await expect(loadVideo(db, provider(), { youtubeId: video.youtubeId })).rejects.toThrow(
    "rejected video",
  );
  expect(db.select().from(youtubeChannels).all()).toEqual([
    { youtubeId: video.channelId, title: "Original" },
  ]);
  expect(db.select().from(youtubeVideos).all()).toEqual([]);
});
