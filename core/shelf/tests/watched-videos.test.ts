import { afterEach, beforeEach, expect, test } from "bun:test";
import { type Actor, AuthorizationError } from "@curator/core/identity";
import {
  addRecommendation,
  type CreateWatchedVideoInput,
  createWatchedVideo,
  createWatchedVideoInputSchema,
  getRecommendations,
  getWatchedVideo,
  getWatchedVideoInputSchema,
  getWatchedVideos,
  getWatchedVideosInputSchema,
  type UpdateWatchedVideoInput,
  updateWatchedVideo,
  updateWatchedVideoInputSchema,
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
const pair = { userId: "user-1", youtubeId: "video-a" };

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
});

afterEach(() => persistence.close());

function seedCollection() {
  const days = [1, 2, 2, 3];
  persistence.db
    .insert(watchedVideos)
    .values([
      ...["a", "b", "c", "d"].map((suffix, index) => ({
        userId: "user-1",
        youtubeId: `video-${suffix}`,
        watchedAt: new Date(`2026-02-0${days[index]}T12:00:00Z`),
        createdAt: new Date(`2026-03-0${days[3 - index]}T12:00:00Z`),
        notes: `Notes ${suffix}`,
        ratingHalfStars: index + 1,
      })),
      {
        userId: "user-2",
        youtubeId: "video-a",
        watchedAt: new Date("2026-04-01T12:00:00Z"),
        createdAt: new Date("2026-04-01T12:00:00Z"),
        notes: "Other user's notes",
      },
    ])
    .run();
}

function inaccessibleDatabase() {
  return new Proxy(persistence.db, {
    get() {
      throw new Error("Validation and authorization must precede database access.");
    },
  });
}

test("creates a watched record with generated dates and no required feedback", () => {
  const start = Math.floor(Date.now() / 1000) * 1000;
  const record = createWatchedVideo(persistence.db, actor, pair);
  expect(record).toMatchObject({ ...pair, notes: null, ratingHalfStars: null });
  for (const date of [record.watchedAt, record.createdAt]) {
    expect(date).toBeInstanceOf(Date);
    expect(date.getTime()).toBeGreaterThanOrEqual(start);
    expect(date.getTime()).toBeLessThanOrEqual(Date.now());
  }
  expect(getWatchedVideo(persistence.db, actor, pair)).toEqual(record);
});

test("accepts historical watch time and feedback while ignoring a supplied creation time", () => {
  const watchedAt = new Date("2026-01-02T12:00:00.123Z");
  const input = {
    ...pair,
    watchedAt,
    notes: "  Helpful examples.  ",
    ratingHalfStars: 9,
    createdAt: new Date("2000-01-01"),
  };
  const start = Math.floor(Date.now() / 1000) * 1000;
  const record = createWatchedVideo(persistence.db, actor, input);
  expect(record.watchedAt).toEqual(new Date("2026-01-02T12:00:00Z"));
  expect(record.createdAt.getTime()).toBeGreaterThanOrEqual(start);
  expect(record.notes).toBe(input.notes);
  expect(record.ratingHalfStars).toBe(9);
  expect(createWatchedVideoInputSchema.parse(input)).not.toHaveProperty("createdAt");
});

test("rejects duplicate creation and missing references without modifying existing records", () => {
  const original = createWatchedVideo(persistence.db, actor, {
    ...pair,
    notes: "Original note",
    ratingHalfStars: 7,
  });
  expect(() => createWatchedVideo(persistence.db, actor, { ...pair, notes: "Changed" })).toThrow(
    /UNIQUE constraint failed/,
  );
  expect(() =>
    createWatchedVideo(
      persistence.db,
      { userId: "missing-user" },
      { ...pair, userId: "missing-user" },
    ),
  ).toThrow(/FOREIGN KEY constraint failed/);
  expect(() =>
    createWatchedVideo(persistence.db, actor, { ...pair, youtubeId: "missing-video" }),
  ).toThrow(/FOREIGN KEY constraint failed/);
  expect(persistence.db.select().from(watchedVideos).all()).toEqual([original]);
});

test("updates only supplied fields, preserves creation time and identity, and clears feedback with null", () => {
  const original = createWatchedVideo(persistence.db, actor, {
    ...pair,
    watchedAt: new Date("2026-01-01T12:00:00Z"),
    notes: "Original",
    ratingHalfStars: 5,
  });
  createWatchedVideo(persistence.db, { userId: "user-2" }, { ...pair, userId: "user-2" });
  const other = getWatchedVideo(
    persistence.db,
    { userId: "user-2" },
    { ...pair, userId: "user-2" },
  );
  const patch = {
    ...pair,
    notes: "  Revised note  ",
    ratingHalfStars: undefined,
    createdAt: new Date("2000-01-01"),
  };
  const changed = updateWatchedVideo(persistence.db, actor, patch);
  expect(changed).toEqual({ ...original, notes: "  Revised note  " });
  const watchedAt = new Date("2026-01-03T12:00:00Z");
  expect(
    updateWatchedVideo(persistence.db, actor, { ...pair, watchedAt, ratingHalfStars: 10 }),
  ).toEqual({
    ...original,
    watchedAt,
    notes: "  Revised note  ",
    ratingHalfStars: 10,
  });
  expect(
    updateWatchedVideo(persistence.db, actor, { ...pair, notes: null, ratingHalfStars: null }),
  ).toEqual({
    ...original,
    watchedAt,
    notes: null,
    ratingHalfStars: null,
  });
  expect(
    getWatchedVideo(persistence.db, { userId: "user-2" }, { ...pair, userId: "user-2" }),
  ).toEqual(other);
});

test("returns null for missing lookups and updates and never creates implicitly", () => {
  for (const target of [
    pair,
    { ...pair, youtubeId: "missing-video" },
    { ...pair, userId: "missing-user" },
  ]) {
    const targetActor = { userId: target.userId };
    expect(getWatchedVideo(persistence.db, targetActor, target)).toBeNull();
    expect(updateWatchedVideo(persistence.db, targetActor, { ...target, notes: "New" })).toBeNull();
  }
  expect(persistence.db.select().from(watchedVideos).all()).toHaveLength(0);
});

test("accepts every half-star unit and nullable or empty notes, rejecting invalid feedback and dates", () => {
  createWatchedVideo(persistence.db, actor, pair);
  for (let ratingHalfStars = 1; ratingHalfStars <= 10; ratingHalfStars++) {
    expect(
      updateWatchedVideo(persistence.db, actor, { ...pair, ratingHalfStars })?.ratingHalfStars,
    ).toBe(ratingHalfStars);
  }
  expect(updateWatchedVideo(persistence.db, actor, { ...pair, notes: "" })?.notes).toBe("");
  const invalidFields: unknown[] = [
    ...[0, -1, 11, 1.5, "5", Number.NaN].map((ratingHalfStars) => ({ ratingHalfStars })),
    { notes: 123 },
    { watchedAt: null },
    { watchedAt: "2026-01-01" },
    { watchedAt: new Date("invalid") },
  ];
  for (const fields of invalidFields) {
    const input = { ...pair, ...(fields as object) };
    expect(() =>
      createWatchedVideo(inaccessibleDatabase(), actor, input as CreateWatchedVideoInput),
    ).toThrow(ZodError);
    expect(() =>
      updateWatchedVideo(inaccessibleDatabase(), actor, input as UpdateWatchedVideoInput),
    ).toThrow(ZodError);
  }
});

test("rejects empty patches, unknown-only patches, and invalid targets before database access", () => {
  for (const input of [pair, { ...pair, notes: undefined }, { ...pair, createdAt: new Date() }]) {
    expect(updateWatchedVideoInputSchema.safeParse(input).success).toBe(false);
    expect(() => updateWatchedVideo(inaccessibleDatabase(), actor, input)).toThrow(ZodError);
  }
  for (const field of ["userId", "youtubeId"] as const) {
    for (const value of [undefined, null, "", " \t", 1]) {
      const target = { ...pair, [field]: value };
      expect(() => createWatchedVideo(inaccessibleDatabase(), actor, target)).toThrow(ZodError);
      expect(() => getWatchedVideo(inaccessibleDatabase(), actor, target)).toThrow(ZodError);
      expect(() =>
        updateWatchedVideo(inaccessibleDatabase(), actor, { ...target, notes: "New" }),
      ).toThrow(ZodError);
    }
  }
});

test("all watched operations reject invalid actors and other users' targets before database access", () => {
  const operations = [
    (caller: Actor, userId: string) =>
      createWatchedVideo(inaccessibleDatabase(), caller, { ...pair, userId }),
    (caller: Actor, userId: string) =>
      updateWatchedVideo(inaccessibleDatabase(), caller, { ...pair, userId, notes: "New" }),
    (caller: Actor, userId: string) =>
      getWatchedVideo(inaccessibleDatabase(), caller, { ...pair, userId }),
    (caller: Actor, userId: string) => getWatchedVideos(inaccessibleDatabase(), caller, { userId }),
  ];
  for (const operation of operations) {
    for (const userId of ["user-2", "missing-user"]) {
      expect(() => operation(actor, userId)).toThrow(AuthorizationError);
    }
    for (const caller of [undefined, null, {}, { userId: "" }, { userId: 123 }] as unknown[]) {
      expect(() => operation(caller as Actor, pair.userId)).toThrow(ZodError);
    }
  }
});

test("single and list retrieval independently include stored video and channel metadata", () => {
  seedCollection();
  for (const includeVideoMetadata of [false, true]) {
    for (const includeChannelMetadata of [false, true]) {
      const options = { includeVideoMetadata, includeChannelMetadata };
      const single = getWatchedVideo(persistence.db, actor, { ...pair, ...options });
      if (!single) throw new Error("Expected a watched record.");
      const page = getWatchedVideos(persistence.db, actor, { userId: pair.userId, ...options });
      expect(page.items.map((item) => item.youtubeId)).toEqual([
        "video-d",
        "video-c",
        "video-b",
        "video-a",
      ]);
      expect(page.nextCursor).toBeNull();
      for (const item of [single, ...page.items]) {
        expect(item.userId).toBe(pair.userId);
        expect(item.createdAt).toBeInstanceOf(Date);
        expect(item.watchedAt).toBeInstanceOf(Date);
        if (includeVideoMetadata) {
          expect(item.video?.title).toBe(`Video ${item.youtubeId.at(-1)}`);
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
  expect(
    getWatchedVideo(persistence.db, { userId: "user-2" }, { ...pair, userId: "user-2" })?.notes,
  ).toBe("Other user's notes");
});

test("paginates by either date in both directions with stable timestamp tie-breaking", () => {
  seedCollection();
  for (const sortBy of ["watchedAt", "createdAt"] as const) {
    for (const sortOrder of ["asc", "desc"] as const) {
      for (const limit of [1, 2, 3, 4, 5]) {
        let cursor: string | undefined;
        const ids: string[] = [];
        do {
          const page = getWatchedVideos(persistence.db, actor, {
            userId: pair.userId,
            sortBy,
            sortOrder,
            limit,
            cursor,
          });
          expect(page.items.length).toBeLessThanOrEqual(limit);
          ids.push(...page.items.map((item) => item.youtubeId));
          cursor = page.nextCursor ?? undefined;
          expect(ids.length).toBeLessThanOrEqual(4);
        } while (cursor);
        const ascending =
          sortBy === "watchedAt"
            ? ["video-a", "video-b", "video-c", "video-d"]
            : ["video-d", "video-b", "video-c", "video-a"];
        expect(ids).toEqual(sortOrder === "asc" ? ascending : [...ascending].reverse());
      }
    }
  }
});

test("cursor survives deletion and permits changed metadata flags and page limits", () => {
  seedCollection();
  const first = getWatchedVideos(persistence.db, actor, { userId: pair.userId, limit: 2 });
  const cursor = first.nextCursor;
  if (!cursor) throw new Error("Expected another page.");
  persistence.db
    .delete(watchedVideos)
    .where(and(eq(watchedVideos.userId, pair.userId), eq(watchedVideos.youtubeId, "video-c")))
    .run();
  const parsed = getWatchedVideosInputSchema.parse({
    userId: pair.userId,
    cursor,
    limit: 10,
    includeVideoMetadata: true,
    includeChannelMetadata: true,
    extra: true,
  });
  expect(parsed.cursor).toBe(cursor);
  expect(parsed).not.toHaveProperty("extra");
  const second = getWatchedVideos(persistence.db, actor, parsed);
  expect(second.items.map((item) => item.youtubeId)).toEqual(["video-b", "video-a"]);
  expect(second.items[0]?.video?.title).toBe("Video b");
  expect(second.items[0]?.channel?.title).toBe("First channel");
  expect(second.nextCursor).toBeNull();
});

test("list defaults match recommendations conventions and empty targets return empty pages", () => {
  expect(getWatchedVideosInputSchema.parse({ userId: pair.userId })).toEqual({
    userId: pair.userId,
    includeVideoMetadata: false,
    includeChannelMetadata: false,
    limit: 50,
    sortBy: "watchedAt",
    sortOrder: "desc",
  });
  expect(getWatchedVideoInputSchema.parse(pair)).toEqual({
    ...pair,
    includeVideoMetadata: false,
    includeChannelMetadata: false,
  });
  for (const userId of ["empty-user", "missing-user"]) {
    expect(getWatchedVideos(persistence.db, { userId }, { userId })).toEqual({
      items: [],
      nextCursor: null,
    });
  }
});

test("list rejects invalid options, cursor encodings, and cursor/query mismatches before database access", () => {
  seedCollection();
  const first = getWatchedVideos(persistence.db, actor, { userId: pair.userId, limit: 1 });
  const cursor = first.nextCursor;
  if (!cursor) throw new Error("Expected another page.");
  const position = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const invalidCursors: unknown[] = [
    "",
    "a",
    "not a cursor!",
    `${cursor}=`,
    null,
    123,
    Buffer.from("invalid JSON").toString("base64url"),
    encode(null),
    encode({}),
    encode({ ...position, version: 2 }),
    encode({ ...position, kind: "recommendations" }),
    encode({ ...position, sortValue: 1.5 }),
    encode({ ...position, sortValue: 9_000_000_000_000 }),
    encode({ ...position, youtubeId: "" }),
    encode({ ...position, extra: true }),
  ];
  const badInputs: unknown[] = [
    undefined,
    null,
    {},
    { userId: "" },
    { userId: 123 },
    ...[0, -1, 1.5, "2", null, Number.NaN].map((limit) => ({ userId: pair.userId, limit })),
    { userId: pair.userId, sortBy: "recommendedAt" },
    { userId: pair.userId, sortOrder: "newest" },
    { userId: pair.userId, includeVideoMetadata: "true" },
    { userId: pair.userId, includeChannelMetadata: null },
    ...invalidCursors.map((cursor) => ({ userId: pair.userId, cursor })),
  ];
  for (const input of badInputs) {
    expect(() =>
      getWatchedVideos(inaccessibleDatabase(), actor, input as { userId: string }),
    ).toThrow(ZodError);
  }
  for (const changed of [
    { sortBy: "createdAt" },
    { sortOrder: "asc" },
    { userId: "user-2" },
  ] as const) {
    const input = { userId: pair.userId, cursor, ...changed };
    expect(() => getWatchedVideos(inaccessibleDatabase(), { userId: input.userId }, input)).toThrow(
      ZodError,
    );
  }
});

test("creating and updating watched records preserve recommendations and update watched filtering", () => {
  const recommendation = addRecommendation(persistence.db, actor, { ...pair, rationale: "Useful" });
  expect(
    getRecommendations(persistence.db, actor, { userId: pair.userId, watchStatus: "unwatched" })
      .items,
  ).toHaveLength(1);
  createWatchedVideo(persistence.db, actor, pair);
  updateWatchedVideo(persistence.db, actor, {
    ...pair,
    notes: "Useful examples",
    ratingHalfStars: 8,
  });
  expect(persistence.db.select().from(videoRecommendations).all()).toEqual([recommendation]);
  expect(
    getRecommendations(persistence.db, actor, { userId: pair.userId, watchStatus: "unwatched" })
      .items,
  ).toHaveLength(0);
  expect(
    getRecommendations(persistence.db, actor, { userId: pair.userId, watchStatus: "watched" })
      .items,
  ).toEqual([recommendation]);
});
