import { afterEach, beforeEach, expect, test } from "bun:test";
import { type Actor, AuthorizationError } from "@curator/core/identity";
import {
  type CreateRecommendationInput,
  createRecommendation,
  createRecommendationInputSchema,
} from "@curator/core/shelf";
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
} from "#persistence/index";

const dependencies = {
  getYouTubeProvider: () => {
    throw new Error("Provider should not be called for stored videos.");
  },
};
let persistence: Persistence;
const actor: Actor = { userId: "user-1" };
const input = {
  userId: "user-1",
  youtubeId: "video-1",
  rationale: "Explains a topic you are exploring.",
};

beforeEach(() => {
  persistence = openDatabase({ databasePath: ":memory:" });
  const { db } = persistence;
  migrateDatabase(db);
  db.insert(users)
    .values([
      { id: "user-1", name: "First user" },
      { id: "user-2", name: "Second user" },
    ])
    .run();
  db.insert(youtubeChannels).values({ youtubeId: "channel-1", title: "Example channel" }).run();
  db.insert(youtubeVideos)
    .values({
      youtubeId: "video-1",
      title: "Example video",
      channelId: "channel-1",
      durationSeconds: 120,
      publishedAt: new Date("2026-01-01T12:00:00Z"),
      thumbnailUrl: "https://example.com/thumbnail.jpg",
    })
    .run();
});

afterEach(() => persistence.close());

test("creates a recommendation and returns the saved record with its default timestamp", async () => {
  const start = Math.floor(Date.now() / 1000) * 1000;
  const recommendation = await createRecommendation(persistence.db, actor, input, dependencies);
  expect(recommendation).toMatchObject(input);
  expect(recommendation.recommendedAt).toBeInstanceOf(Date);
  expect(recommendation.recommendedAt.getTime()).toBeGreaterThanOrEqual(start);
  expect(recommendation.recommendedAt.getTime()).toBeLessThanOrEqual(Date.now());
  expect(persistence.db.select().from(videoRecommendations).all()).toEqual([recommendation]);
});

test("rejects duplicates without changing the original rationale or timestamp", async () => {
  const { db } = persistence;
  const original = {
    ...input,
    recommendedAt: new Date("2026-01-01T12:00:00Z"),
  };
  db.insert(videoRecommendations).values(original).run();
  await expect(
    createRecommendation(db, actor, { ...input, rationale: "A different rationale" }, dependencies),
  ).rejects.toThrow(/UNIQUE constraint failed/);
  expect(db.select().from(videoRecommendations).all()).toEqual([original]);
});

test("rejects missing users and videos without creating recommendations", async () => {
  const { db } = persistence;
  await expect(
    createRecommendation(
      db,
      { userId: "missing-user" },
      { ...input, userId: "missing-user" },
      dependencies,
    ),
  ).rejects.toThrow("Target user does not exist.");
  await expect(
    createRecommendation(db, actor, { ...input, youtubeId: "missing-video" }, dependencies),
  ).rejects.toThrow("Provider should not be called for stored videos.");
  expect(db.select().from(videoRecommendations).all()).toHaveLength(0);
});

test("allows separate users to recommend the same video", async () => {
  const { db } = persistence;
  const first = await createRecommendation(db, actor, input, dependencies);
  const second = await createRecommendation(
    db,
    { userId: "user-2" },
    { ...input, userId: "user-2" },
    dependencies,
  );
  expect(first.userId).toBe("user-1");
  expect(second.userId).toBe("user-2");
  expect(db.select().from(videoRecommendations).all()).toHaveLength(2);
});

test("recommends watched videos without altering watched timestamps or feedback", async () => {
  const { db } = persistence;
  const watched = {
    userId: input.userId,
    youtubeId: input.youtubeId,
    watchedAt: new Date("2026-01-01T12:00:00Z"),
    createdAt: new Date("2026-02-01T12:00:00Z"),
    notes: "Useful examples",
    ratingHalfStars: 9,
  };
  db.insert(watchedVideos).values(watched).run();
  expect(await createRecommendation(db, actor, input, dependencies)).toMatchObject(input);
  expect(db.select().from(watchedVideos).all()).toEqual([watched]);
});

test("rejects blank fields before inserting a recommendation", async () => {
  for (const field of ["userId", "youtubeId", "rationale"] as const) {
    for (const value of ["", " \t\n"]) {
      await expect(
        createRecommendation(persistence.db, actor, { ...input, [field]: value }, dependencies),
      ).rejects.toThrow(ZodError);
    }
  }
  expect(persistence.db.select().from(videoRecommendations).all()).toHaveLength(0);
});

test("rejects missing or wrongly typed input fields without inferring targets", async () => {
  for (const field of ["userId", "youtubeId", "rationale"] as const) {
    for (const value of [undefined, null, 123]) {
      const result = createRecommendationInputSchema.safeParse({
        ...input,
        [field]: value,
      });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0]?.path).toEqual([field]);
      const invalidInput = { ...input, [field]: value } as CreateRecommendationInput;
      await expect(
        createRecommendation(persistence.db, actor, invalidInput, dependencies),
      ).rejects.toThrow(ZodError);
    }
  }
  expect(persistence.db.select().from(videoRecommendations).all()).toHaveLength(0);
});

test("preserves rationale text and excludes extra fields from insertion", async () => {
  const extended = {
    ...input,
    rationale: "  Helpful examples.  ",
    recommendedAt: new Date("2000-01-01"),
  };
  expect(createRecommendationInputSchema.parse(extended)).toEqual({
    ...input,
    rationale: extended.rationale,
  });
  const result = await createRecommendation(persistence.db, actor, extended, dependencies);
  expect(result.rationale).toBe(extended.rationale);
  expect(result.recommendedAt.getTime()).toBeGreaterThan(extended.recommendedAt.getTime());
});

test("rejects other users' shelves before database access, even for nonexistent targets", async () => {
  const { db } = persistence;
  const original = await createRecommendation(db, actor, input, dependencies);
  const inaccessibleDb = new Proxy(db, {
    get() {
      throw new Error("Authorization must happen before database access.");
    },
  });
  for (const userId of ["user-2", "missing-user"]) {
    await expect(
      createRecommendation(inaccessibleDb, actor, { ...input, userId }, dependencies),
    ).rejects.toThrow(AuthorizationError);
  }
  expect(db.select().from(videoRecommendations).all()).toEqual([original]);
});

test("rejects invalid actors before database access", async () => {
  const inaccessibleDb = new Proxy(persistence.db, {
    get() {
      throw new Error("Actor validation must happen before database access.");
    },
  });
  const invalidActors: unknown[] = [
    undefined,
    null,
    {},
    { userId: undefined },
    { userId: null },
    { userId: 123 },
    { userId: "" },
    { userId: " \t\n" },
  ];
  for (const invalidActor of invalidActors) {
    await expect(
      createRecommendation(inaccessibleDb, invalidActor as Actor, input, dependencies),
    ).rejects.toThrow(ZodError);
  }
  expect(persistence.db.select().from(videoRecommendations).all()).toHaveLength(0);
});
