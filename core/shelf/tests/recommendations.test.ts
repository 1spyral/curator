import { afterEach, beforeEach, expect, test } from "bun:test";
import { type Actor, AuthorizationError } from "@curator/core/identity";
import {
  type AddRecommendationInput,
  addRecommendation,
  addRecommendationInputSchema,
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

test("adds a recommendation and returns the saved record with its default timestamp", () => {
  const start = Math.floor(Date.now() / 1000) * 1000;
  const recommendation = addRecommendation(persistence.db, actor, input);
  expect(recommendation).toMatchObject(input);
  expect(recommendation.recommendedAt).toBeInstanceOf(Date);
  expect(recommendation.recommendedAt.getTime()).toBeGreaterThanOrEqual(start);
  expect(recommendation.recommendedAt.getTime()).toBeLessThanOrEqual(Date.now());
  expect(persistence.db.select().from(videoRecommendations).all()).toEqual([recommendation]);
});

test("rejects duplicates without changing the original rationale or timestamp", () => {
  const { db } = persistence;
  const original = {
    ...input,
    recommendedAt: new Date("2026-01-01T12:00:00Z"),
  };
  db.insert(videoRecommendations).values(original).run();
  expect(() =>
    addRecommendation(db, actor, { ...input, rationale: "A different rationale" }),
  ).toThrow(/UNIQUE constraint failed/);
  expect(db.select().from(videoRecommendations).all()).toEqual([original]);
});

test("rejects missing users and videos without creating recommendations", () => {
  const { db } = persistence;
  expect(() =>
    addRecommendation(db, { userId: "missing-user" }, { ...input, userId: "missing-user" }),
  ).toThrow(/FOREIGN KEY constraint failed/);
  expect(() => addRecommendation(db, actor, { ...input, youtubeId: "missing-video" })).toThrow(
    /FOREIGN KEY constraint failed/,
  );
  expect(db.select().from(videoRecommendations).all()).toHaveLength(0);
});

test("allows separate users to recommend the same video", () => {
  const { db } = persistence;
  const first = addRecommendation(db, actor, input);
  const second = addRecommendation(db, { userId: "user-2" }, { ...input, userId: "user-2" });
  expect(first.userId).toBe("user-1");
  expect(second.userId).toBe("user-2");
  expect(db.select().from(videoRecommendations).all()).toHaveLength(2);
});

test("recommends watched videos without altering watched timestamps or feedback", () => {
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
  expect(addRecommendation(db, actor, input)).toMatchObject(input);
  expect(db.select().from(watchedVideos).all()).toEqual([watched]);
});

test("rejects blank fields before inserting a recommendation", () => {
  for (const field of ["userId", "youtubeId", "rationale"] as const) {
    for (const value of ["", " \t\n"]) {
      expect(() => addRecommendation(persistence.db, actor, { ...input, [field]: value })).toThrow(
        ZodError,
      );
    }
  }
  expect(persistence.db.select().from(videoRecommendations).all()).toHaveLength(0);
});

test("rejects missing or wrongly typed input fields without inferring targets", () => {
  for (const field of ["userId", "youtubeId", "rationale"] as const) {
    for (const value of [undefined, null, 123]) {
      const result = addRecommendationInputSchema.safeParse({
        ...input,
        [field]: value,
      });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0]?.path).toEqual([field]);
      const invalidInput = { ...input, [field]: value } as AddRecommendationInput;
      expect(() => addRecommendation(persistence.db, actor, invalidInput)).toThrow(ZodError);
    }
  }
  expect(persistence.db.select().from(videoRecommendations).all()).toHaveLength(0);
});

test("preserves rationale text and excludes extra fields from insertion", () => {
  const extended = {
    ...input,
    rationale: "  Helpful examples.  ",
    recommendedAt: new Date("2000-01-01"),
  };
  expect(addRecommendationInputSchema.parse(extended)).toEqual({
    ...input,
    rationale: extended.rationale,
  });
  const result = addRecommendation(persistence.db, actor, extended);
  expect(result.rationale).toBe(extended.rationale);
  expect(result.recommendedAt.getTime()).toBeGreaterThan(extended.recommendedAt.getTime());
});

test("rejects other users' shelves before database access, even for nonexistent targets", () => {
  const { db } = persistence;
  const original = addRecommendation(db, actor, input);
  const inaccessibleDb = new Proxy(db, {
    get() {
      throw new Error("Authorization must happen before database access.");
    },
  });
  for (const userId of ["user-2", "missing-user"]) {
    expect(() => addRecommendation(inaccessibleDb, actor, { ...input, userId })).toThrow(
      AuthorizationError,
    );
  }
  expect(db.select().from(videoRecommendations).all()).toEqual([original]);
});

test("rejects invalid actors before database access", () => {
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
    expect(() => addRecommendation(inaccessibleDb, invalidActor as Actor, input)).toThrow(ZodError);
  }
  expect(persistence.db.select().from(videoRecommendations).all()).toHaveLength(0);
});
