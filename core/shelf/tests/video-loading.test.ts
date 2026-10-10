import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { AuthorizationError } from "@curator/core/identity";
import {
  addRecommendation,
  createWatchedVideo,
  type ShelfCreationDependencies,
  VideoLoadError,
} from "@curator/core/shelf";
import type { VideoMetadata, YouTubeProvider, YouTubeResult } from "@curator/core/youtube";
import { ZodError } from "zod";
import {
  migrateDatabase,
  openDatabase,
  type Persistence,
  users,
  videoRecommendations,
  watchedVideos,
  youtubeChannels,
  youtubeVideos,
} from "#persistence";

let persistence: Persistence;
const input = {
  userId: "user-1",
  youtubeId: "video-1",
  rationale: "Useful",
  notes: "Notes",
  ratingHalfStars: 7,
};
const metadata: VideoMetadata = {
  youtubeId: input.youtubeId,
  title: "Video",
  channelId: "channel-1",
  channelTitle: "Channel",
  durationSeconds: 60,
  publishedAt: new Date("2026-01-01T00:00:00Z"),
  thumbnailUrl: "https://example.com/image.jpg",
};

function dependencies(result: YouTubeResult<VideoMetadata> = { success: true, data: metadata }) {
  const provider: YouTubeProvider = {
    getVideo: mock(async () => result),
    getChannel: mock(async () => {
      throw new Error("No separate channel request expected.");
    }),
  };
  return { provider, getYouTubeProvider: mock(() => provider) };
}

beforeEach(() => {
  persistence = openDatabase({ databasePath: ":memory:" });
  migrateDatabase(persistence.db);
  persistence.db
    .insert(users)
    .values([
      { id: "user-1", name: "User" },
      { id: "user-2", name: "Other" },
    ])
    .run();
});
afterEach(() => persistence.close());

const operations = [
  {
    name: "recommendation",
    table: "video_recommendations",
    create: (
      target: typeof input,
      deps: ShelfCreationDependencies,
      db = persistence.db,
      actor = { userId: target.userId },
    ) => addRecommendation(db, actor, target, deps),
  },
  {
    name: "watched",
    table: "watched_videos",
    create: (
      target: typeof input,
      deps: ShelfCreationDependencies,
      db = persistence.db,
      actor = { userId: target.userId },
    ) => createWatchedVideo(db, actor, target, deps),
  },
];

function expectEmpty() {
  for (const table of [youtubeVideos, youtubeChannels, videoRecommendations, watchedVideos]) {
    expect(persistence.db.select().from(table).all()).toHaveLength(0);
  }
}

for (const operation of operations) {
  test(`${operation.name} automatically loads metadata and reuses it across users and operations`, async () => {
    const deps = dependencies();
    expect(await operation.create(input, deps)).toMatchObject({
      userId: input.userId,
      youtubeId: input.youtubeId,
    });
    expect(deps.getYouTubeProvider).toHaveBeenCalledTimes(1);
    expect(deps.provider.getVideo).toHaveBeenCalledWith(input.youtubeId);
    expect(deps.provider.getChannel).not.toHaveBeenCalled();
    expect(persistence.db.select().from(youtubeChannels).all()).toEqual([
      { youtubeId: metadata.channelId, title: metadata.channelTitle },
    ]);
    const cached = dependencies({
      success: false,
      error: { code: "network-error", message: "Unused" },
    });
    await operation.create({ ...input, userId: "user-2" }, cached);
    const other = operations.find((candidate) => candidate !== operation);
    if (!other) throw new Error("Expected the other creation operation.");
    await other.create(input, cached);
    expect(cached.getYouTubeProvider).not.toHaveBeenCalled();
    expect(persistence.db.select().from(youtubeVideos).all()).toHaveLength(1);
    expect(persistence.db.select().from(youtubeChannels).get()?.title).toBe("Channel");
  });

  test(`${operation.name} validates and authorizes before database or provider access`, async () => {
    const deps = dependencies();
    const inaccessible = new Proxy(persistence.db, {
      get() {
        throw new Error("Unexpected database access");
      },
    });
    await expect(
      operation.create({ ...input, userId: "user-2" }, deps, inaccessible, { userId: "user-1" }),
    ).rejects.toThrow(AuthorizationError);
    await expect(
      operation.create({ ...input, youtubeId: " " }, deps, inaccessible),
    ).rejects.toThrow(ZodError);
    await expect(operation.create(input, deps, inaccessible, { userId: "" })).rejects.toThrow(
      ZodError,
    );
    await expect(operation.create({ ...input, userId: "missing" }, deps)).rejects.toThrow(
      "Target user does not exist.",
    );
    expect(deps.getYouTubeProvider).not.toHaveBeenCalled();
    expectEmpty();
  });

  test(`${operation.name} preserves loading errors and makes no writes on failure`, async () => {
    for (const code of [
      "not-found",
      "network-error",
      "timeout",
      "provider-error",
      "invalid-response",
    ] as const) {
      const error = { code, message: "Metadata unavailable", status: 403, reason: "quotaExceeded" };
      const promise = operation.create(input, dependencies({ success: false, error }));
      await expect(promise).rejects.toBeInstanceOf(VideoLoadError);
      await expect(promise).rejects.toMatchObject({ name: "VideoLoadError", error });
      expectEmpty();
    }
    for (const data of [
      { ...metadata, title: " " },
      { ...metadata, youtubeId: "other" },
    ]) {
      await expect(
        operation.create(input, dependencies({ success: true, data })),
      ).rejects.toMatchObject({ error: { code: "invalid-response" } });
      expectEmpty();
    }
    await expect(
      operation.create(input, {
        getYouTubeProvider: () => {
          throw new Error("Missing key");
        },
      }),
    ).rejects.toThrow("Missing key");
    expectEmpty();
  });

  test(`${operation.name} leaves valid catalog metadata when a later shelf insertion fails`, async () => {
    persistence.db.$client.exec(
      `CREATE TRIGGER reject_shelf BEFORE INSERT ON ${operation.table} BEGIN SELECT RAISE(ABORT, 'rejected shelf write'); END;`,
    );
    await expect(operation.create(input, dependencies())).rejects.toThrow("rejected shelf write");
    expect(persistence.db.select().from(youtubeVideos).all()).toHaveLength(1);
    expect(persistence.db.select().from(youtubeChannels).all()).toHaveLength(1);
    expect(persistence.db.select().from(videoRecommendations).all()).toHaveLength(0);
    expect(persistence.db.select().from(watchedVideos).all()).toHaveLength(0);
  });
}
