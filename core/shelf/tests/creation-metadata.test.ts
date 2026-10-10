import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import {
  createRecommendation,
  createRecommendationInputSchema,
  createWatchedVideo,
  createWatchedVideoInputSchema,
  updateWatchedVideoInputSchema,
} from "@curator/core/shelf";
import type { YouTubeProvider } from "@curator/core/youtube";
import {
  migrateDatabase,
  openDatabase,
  type Persistence,
  users,
  youtubeChannels,
  youtubeVideos,
} from "#persistence";

let persistence: Persistence;
const metadata = {
  title: "Video",
  channelId: "channel-1",
  durationSeconds: 61,
  publishedAt: new Date("2026-01-01T12:00:00Z"),
  thumbnailUrl: "https://example.com/image.jpg",
};

beforeEach(() => {
  persistence = openDatabase({ databasePath: ":memory:" });
  migrateDatabase(persistence.db);
  persistence.db.insert(users).values({ id: "user-1", name: "User" }).run();
});
afterEach(() => persistence.close());

for (const create of [createRecommendation, createWatchedVideo]) {
  for (const cached of [true, false]) {
    test(`${create.name} independently includes persisted metadata for ${cached ? "cached" : "newly loaded"} videos`, async () => {
      const { db } = persistence;
      const provider: YouTubeProvider = {
        getVideo: mock<YouTubeProvider["getVideo"]>(async (youtubeId) => ({
          success: true,
          data: { ...metadata, youtubeId, channelTitle: "Channel" },
        })),
        getChannel: mock(async () => {
          throw new Error("Unexpected channel lookup");
        }),
      };
      const getYouTubeProvider = mock(() => provider);
      if (cached)
        db.insert(youtubeChannels)
          .values({ youtubeId: metadata.channelId, title: "Channel" })
          .run();
      for (const includeVideoMetadata of [false, true]) {
        for (const includeChannelMetadata of [false, true]) {
          const youtubeId = `video-${includeVideoMetadata}-${includeChannelMetadata}`;
          if (cached)
            db.insert(youtubeVideos)
              .values({ ...metadata, youtubeId })
              .run();
          const record = await create(
            db,
            { userId: "user-1" },
            {
              userId: "user-1",
              youtubeId,
              rationale: "Useful",
              notes: "Notes",
              ratingHalfStars: 8,
              includeVideoMetadata,
              includeChannelMetadata,
            },
            { getYouTubeProvider },
          );
          expect(record).toMatchObject({ userId: "user-1", youtubeId });
          expect(record).not.toHaveProperty("includeVideoMetadata");
          expect(record).not.toHaveProperty("includeChannelMetadata");
          if (includeVideoMetadata) {
            expect(record.video).toEqual({ ...metadata, youtubeId });
            expect(record.video?.publishedAt).toBeInstanceOf(Date);
            expect(record.video).not.toHaveProperty("channelTitle");
          } else expect(record).not.toHaveProperty("video");
          if (includeChannelMetadata)
            expect(record.channel).toEqual({ youtubeId: metadata.channelId, title: "Channel" });
          else expect(record).not.toHaveProperty("channel");
        }
      }
      expect(getYouTubeProvider).toHaveBeenCalledTimes(cached ? 0 : 4);
      expect(provider.getVideo).toHaveBeenCalledTimes(cached ? 0 : 4);
      expect(provider.getChannel).not.toHaveBeenCalled();
    });
  }
}

test("creation metadata flags default to false, reject non-booleans, and remain absent from watched updates", () => {
  for (const schema of [createRecommendationInputSchema, createWatchedVideoInputSchema]) {
    const input = { userId: "user-1", youtubeId: "video-1", rationale: "Useful" };
    expect(schema.parse(input)).toMatchObject({
      includeVideoMetadata: false,
      includeChannelMetadata: false,
    });
    for (const field of ["includeVideoMetadata", "includeChannelMetadata"]) {
      for (const value of [null, "true", 1])
        expect(schema.safeParse({ ...input, [field]: value }).success).toBe(false);
    }
  }
  const target = { userId: "user-1", youtubeId: "video-1", includeVideoMetadata: true };
  expect(updateWatchedVideoInputSchema.safeParse(target).success).toBe(false);
  expect(updateWatchedVideoInputSchema.parse({ ...target, notes: "Updated" })).not.toHaveProperty(
    "includeVideoMetadata",
  );
});
