import { afterEach, beforeEach, expect, test } from "bun:test";
import { type Actor, AuthorizationError } from "@curator/core/identity";
import {
  type GetRecommendationsInput,
  getRecommendations,
  getRecommendationsInputSchema,
} from "@curator/core/shelf";
import { and, eq } from "drizzle-orm";
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
const actor: Actor = { userId: "user-1" };
const input: GetRecommendationsInput = { userId: "user-1" };
const newestFirst = ["video-d", "video-c", "video-b", "video-a"];

beforeEach(() => {
  persistence = openDatabase({ databasePath: ":memory:" });
  const { db } = persistence;
  migrateDatabase(db);
  db.insert(users)
    .values([
      { id: "user-1", name: "First user" },
      { id: "user-2", name: "Second user" },
      { id: "empty-user", name: "Empty user" },
    ])
    .run();
  db.insert(youtubeChannels)
    .values([
      { youtubeId: "channel-1", title: "First channel" },
      { youtubeId: "channel-2", title: "Second channel" },
    ])
    .run();
  db.insert(youtubeVideos)
    .values(
      ["a", "b", "c", "d"].map((suffix) => ({
        youtubeId: `video-${suffix}`,
        title: `Video ${suffix}`,
        channelId: suffix === "d" ? "channel-2" : "channel-1",
        durationSeconds: 120,
        publishedAt: new Date("2026-01-01T12:00:00Z"),
        thumbnailUrl: `https://example.com/${suffix}.jpg`,
      })),
    )
    .run();
  db.insert(videoRecommendations)
    .values([
      ...["a", "b", "c", "d"].map((suffix, index) => ({
        userId: "user-1",
        youtubeId: `video-${suffix}`,
        rationale: `Rationale ${suffix}`,
        recommendedAt: new Date(`2026-02-0${index === 0 ? 1 : index === 3 ? 3 : 2}T12:00:00Z`),
      })),
      {
        userId: "user-2",
        youtubeId: "video-a",
        rationale: "Another user's rationale",
        recommendedAt: new Date("2026-03-01T12:00:00Z"),
      },
    ])
    .run();
  db.insert(watchedVideos)
    .values([
      { userId: "user-1", youtubeId: "video-b" },
      { userId: "user-1", youtubeId: "video-d" },
      { userId: "user-2", youtubeId: "video-a" },
    ])
    .run();
});

afterEach(() => persistence.close());

test("defaults to all stored recommendations, newest first, without metadata", () => {
  const page = getRecommendations(persistence.db, actor, input);
  expect(page.items.map((item) => item.youtubeId)).toEqual(newestFirst);
  expect(page.nextCursor).toBeNull();
  for (const item of page.items) {
    expect(item.userId).toBe(input.userId);
    expect(item.recommendedAt).toBeInstanceOf(Date);
    expect(item.rationale).toBe(`Rationale ${item.youtubeId.at(-1)}`);
    expect(Object.keys(item).sort()).toEqual(["rationale", "recommendedAt", "userId", "youtubeId"]);
  }
  expect(getRecommendationsInputSchema.parse({ ...input, extra: true })).toMatchObject({
    userId: "user-1",
    includeVideoMetadata: false,
    includeChannelMetadata: false,
    limit: 50,
    watchStatus: "both",
    sortBy: "recommendedAt",
    sortOrder: "desc",
  });
  expect(getRecommendationsInputSchema.parse({ ...input, extra: true })).not.toHaveProperty(
    "extra",
  );
});

test("independently includes stored video and channel metadata", () => {
  for (const includeVideoMetadata of [false, true]) {
    for (const includeChannelMetadata of [false, true]) {
      const page = getRecommendations(persistence.db, actor, {
        ...input,
        includeVideoMetadata,
        includeChannelMetadata,
      });
      expect(page.items.map((item) => item.youtubeId)).toEqual(newestFirst);
      for (const item of page.items) {
        if (includeVideoMetadata) {
          const video = persistence.db
            .select()
            .from(youtubeVideos)
            .where(eq(youtubeVideos.youtubeId, item.youtubeId))
            .get();
          expect(item.video).toEqual(video);
          expect(item.video?.publishedAt).toBeInstanceOf(Date);
        } else {
          expect(item).not.toHaveProperty("video");
        }
        if (includeChannelMetadata) {
          expect(item.channel).toEqual(
            item.youtubeId === "video-d"
              ? { youtubeId: "channel-2", title: "Second channel" }
              : { youtubeId: "channel-1", title: "First channel" },
          );
        } else {
          expect(item).not.toHaveProperty("channel");
        }
      }
    }
  }
});

test("filters watched state for the target user rather than any user", () => {
  const watched = getRecommendations(persistence.db, actor, { ...input, watchStatus: "watched" });
  const unwatched = getRecommendations(persistence.db, actor, {
    ...input,
    watchStatus: "unwatched",
  });
  expect(watched.items.map((item) => item.youtubeId)).toEqual(["video-d", "video-b"]);
  expect(unwatched.items.map((item) => item.youtubeId)).toEqual(["video-c", "video-a"]);
  const other = getRecommendations(
    persistence.db,
    { userId: "user-2" },
    { userId: "user-2", watchStatus: "watched" },
  );
  expect(other.items).toHaveLength(1);
  expect(other.items[0]?.rationale).toBe("Another user's rationale");
});

test("paginates both directions with timestamp ties and no missing or repeated items", () => {
  for (const sortOrder of ["asc", "desc"] as const) {
    for (const limit of [1, 2, 3, 4, 5]) {
      let cursor: string | undefined;
      const ids: string[] = [];
      do {
        const page = getRecommendations(persistence.db, actor, {
          ...input,
          sortOrder,
          limit,
          cursor,
        });
        expect(page.items.length).toBeLessThanOrEqual(limit);
        ids.push(...page.items.map((item) => item.youtubeId));
        cursor = page.nextCursor ?? undefined;
        if (cursor) expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(ids.length).toBeLessThanOrEqual(4);
      } while (cursor);
      expect(ids).toEqual(sortOrder === "desc" ? newestFirst : [...newestFirst].reverse());
    }
  }
});

test("applies watched filtering before pagination and permits changing metadata flags and limit", () => {
  const first = getRecommendations(persistence.db, actor, {
    ...input,
    watchStatus: "unwatched",
    limit: 1,
  });
  expect(first.items.map((item) => item.youtubeId)).toEqual(["video-c"]);
  expect(first.nextCursor).not.toBeNull();
  const second = getRecommendations(persistence.db, actor, {
    ...input,
    watchStatus: "unwatched",
    limit: 10,
    includeVideoMetadata: true,
    includeChannelMetadata: true,
    cursor: first.nextCursor ?? undefined,
  });
  expect(second.items.map((item) => item.youtubeId)).toEqual(["video-a"]);
  expect(second.items[0]?.video?.title).toBe("Video a");
  expect(second.items[0]?.channel?.title).toBe("First channel");
  expect(second.nextCursor).toBeNull();
});

test("continues after deletion of the recommendation that supplied the cursor", () => {
  const first = getRecommendations(persistence.db, actor, { ...input, limit: 2 });
  persistence.db
    .delete(videoRecommendations)
    .where(
      and(
        eq(videoRecommendations.userId, input.userId),
        eq(videoRecommendations.youtubeId, "video-c"),
      ),
    )
    .run();
  const second = getRecommendations(persistence.db, actor, {
    ...input,
    limit: 2,
    cursor: first.nextCursor ?? undefined,
  });
  expect(second.items.map((item) => item.youtubeId)).toEqual(["video-b", "video-a"]);
  expect(second.nextCursor).toBeNull();
});

test("accepts input parsed by the exported schema without changing its opaque cursor", () => {
  const first = getRecommendations(persistence.db, actor, { ...input, limit: 2 });
  const cursor = first.nextCursor;
  if (!cursor) throw new Error("Expected another page.");
  const parsed = getRecommendationsInputSchema.parse({
    ...input,
    limit: 2,
    cursor,
  });
  expect(parsed.cursor).toBe(cursor);
  const second = getRecommendations(persistence.db, actor, parsed);
  expect(second.items.map((item) => item.youtubeId)).toEqual(["video-b", "video-a"]);
  expect(second.nextCursor).toBeNull();
});

test("returns an empty page for users with no recommendations, including nonexistent users", () => {
  for (const userId of ["empty-user", "missing-user"]) {
    expect(getRecommendations(persistence.db, { userId }, { userId })).toEqual({
      items: [],
      nextCursor: null,
    });
  }
});

function inaccessibleDatabase() {
  return new Proxy(persistence.db, {
    get() {
      throw new Error("Validation and authorization must precede database access.");
    },
  });
}

test("rejects unauthorized targets before database access", () => {
  for (const userId of ["user-2", "missing-user"]) {
    expect(() => getRecommendations(inaccessibleDatabase(), actor, { userId })).toThrow(
      AuthorizationError,
    );
  }
});

test("rejects invalid actors and query parameters before database access", () => {
  const badActors: unknown[] = [
    undefined,
    null,
    {},
    { userId: "" },
    { userId: " \t" },
    { userId: 1 },
  ];
  for (const badActor of badActors) {
    expect(() => getRecommendations(inaccessibleDatabase(), badActor as Actor, input)).toThrow(
      ZodError,
    );
  }
  const badInputs: unknown[] = [
    undefined,
    null,
    {},
    { userId: "" },
    { userId: " \n" },
    { userId: 1 },
    ...[0, -1, 1.5, "2", null, Number.NaN, Number.POSITIVE_INFINITY].map((limit) => ({
      ...input,
      limit,
    })),
    { ...input, watchStatus: "invalid" },
    { ...input, sortBy: "publishedAt" },
    { ...input, sortOrder: "newest" },
    { ...input, includeVideoMetadata: "true" },
    { ...input, includeChannelMetadata: null },
  ];
  for (const badInput of badInputs) {
    expect(() =>
      getRecommendations(inaccessibleDatabase(), actor, badInput as GetRecommendationsInput),
    ).toThrow(ZodError);
  }
});

test("rejects malformed, unsupported, and incompatible cursors before database access", () => {
  const first = getRecommendations(persistence.db, actor, { ...input, limit: 1 });
  const cursor = first.nextCursor;
  if (!cursor) throw new Error("Expected another page.");
  const position = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const invalidCursors: unknown[] = [
    "",
    "not a cursor!",
    "a",
    Buffer.from("invalid JSON").toString("base64url"),
    `${cursor}=`,
    encode(null),
    encode({}),
    encode({ ...position, version: 2 }),
    encode({ ...position, recommendedAt: 1.5 }),
    encode({ ...position, recommendedAt: 9_000_000_000_000 }),
    encode({ ...position, youtubeId: "" }),
    encode({ ...position, extra: true }),
    null,
    123,
  ];
  for (const invalidCursor of invalidCursors) {
    const badInput = { ...input, cursor: invalidCursor } as GetRecommendationsInput;
    expect(() => getRecommendations(inaccessibleDatabase(), actor, badInput)).toThrow(ZodError);
  }
  for (const changed of [
    { watchStatus: "watched" },
    { sortOrder: "asc" },
    { userId: "user-2" },
  ] as const) {
    const changedInput = { ...input, ...changed, cursor };
    const changedActor = { userId: changedInput.userId };
    expect(() => getRecommendations(inaccessibleDatabase(), changedActor, changedInput)).toThrow(
      ZodError,
    );
  }
});
