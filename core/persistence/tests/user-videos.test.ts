import { afterEach, beforeEach, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import {
  migrateDatabase,
  openDatabase,
  type Persistence,
  users,
  videoRecommendations,
  watchedVideos,
  youtubeChannels,
  youtubeVideos,
} from "../src";

let persistence: Persistence;
const pair = { userId: "user-1", youtubeId: "video-1" };
const rationale = "Explains a topic you are exploring.";
const linkTables = ["video_recommendations", "watched_videos"] as const;

function insertLink(table: (typeof linkTables)[number], userId: string, youtubeId: string) {
  if (table === "video_recommendations") {
    persistence.db.insert(videoRecommendations).values({ userId, youtubeId, rationale }).run();
  } else {
    persistence.db.insert(watchedVideos).values({ userId, youtubeId }).run();
  }
}

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

test.each(linkTables.map((table) => [table] as const))(
  "%s enforces references and one link per user/video",
  (table) => {
    expect(() => insertLink(table, "missing-user", pair.youtubeId)).toThrow(
      /FOREIGN KEY constraint failed/,
    );
    expect(() => insertLink(table, pair.userId, "missing-video")).toThrow(
      /FOREIGN KEY constraint failed/,
    );
    insertLink(table, pair.userId, pair.youtubeId);
    expect(() => insertLink(table, pair.userId, pair.youtubeId)).toThrow(
      /UNIQUE constraint failed/,
    );
    insertLink(table, "user-2", pair.youtubeId);
    expect(persistence.db.$client.query(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({
      count: 2,
    });
  },
);

test("recommendations require a rationale", () => {
  expect(() =>
    persistence.db.$client
      .query("INSERT INTO video_recommendations (user_id, youtube_id) VALUES (?, ?)")
      .run(pair.userId, pair.youtubeId),
  ).toThrow(/NOT NULL constraint failed/);
});

test("recommendations and watched records exist independently and coexist", () => {
  const { db } = persistence;
  db.insert(videoRecommendations)
    .values({ ...pair, rationale })
    .run();
  expect(db.select().from(watchedVideos).all()).toHaveLength(0);
  db.insert(watchedVideos).values({ userId: "user-2", youtubeId: pair.youtubeId }).run();
  expect(db.select().from(videoRecommendations).all()).toHaveLength(1);

  db.insert(watchedVideos).values(pair).run();
  expect(db.select().from(videoRecommendations).get()?.rationale).toBe(rationale);
  expect(db.select().from(watchedVideos).all()).toHaveLength(2);
});

test("timestamps default at insertion and explicit timestamps round-trip as Dates", () => {
  const { db } = persistence;
  const start = Math.floor(Date.now() / 1000) * 1000;
  db.insert(videoRecommendations)
    .values({ ...pair, rationale })
    .run();
  db.insert(watchedVideos).values(pair).run();
  const recommendation = db.select().from(videoRecommendations).get();
  const watched = db.select().from(watchedVideos).get();
  assert(recommendation, "Expected the inserted recommendation to exist.");
  assert(watched, "Expected the inserted watched video to exist.");
  for (const date of [recommendation.recommendedAt, watched.watchedAt, watched.createdAt]) {
    expect(date).toBeInstanceOf(Date);
    expect(date.getTime()).toBeGreaterThanOrEqual(start);
    expect(date.getTime()).toBeLessThanOrEqual(Date.now());
  }

  const date = new Date("2026-02-01T12:00:00Z");
  db.update(videoRecommendations).set({ recommendedAt: date }).run();
  db.update(watchedVideos).set({ watchedAt: date }).run();
  expect(db.select().from(videoRecommendations).get()?.recommendedAt).toEqual(date);
  expect(db.select().from(watchedVideos).get()?.watchedAt).toEqual(date);
});

test("feedback can be absent, added, edited, and cleared", () => {
  const { db } = persistence;
  db.insert(watchedVideos).values(pair).run();
  expect(db.select().from(watchedVideos).get()).toMatchObject({
    notes: null,
    ratingHalfStars: null,
  });
  const where = and(
    eq(watchedVideos.userId, pair.userId),
    eq(watchedVideos.youtubeId, pair.youtubeId),
  );
  db.update(watchedVideos)
    .set({ notes: "Helpful examples", ratingHalfStars: 9 })
    .where(where)
    .run();
  expect(db.select().from(watchedVideos).get()).toMatchObject({
    notes: "Helpful examples",
    ratingHalfStars: 9,
  });
  db.update(watchedVideos).set({ notes: "Revised note", ratingHalfStars: 10 }).where(where).run();
  expect(db.select().from(watchedVideos).get()).toMatchObject({
    notes: "Revised note",
    ratingHalfStars: 10,
  });
  db.update(watchedVideos).set({ notes: null, ratingHalfStars: null }).where(where).run();
  expect(db.select().from(watchedVideos).get()).toMatchObject({
    notes: null,
    ratingHalfStars: null,
  });
});

test("ratings accept half-star steps and reject invalid stored values", () => {
  const { db } = persistence;
  db.insert(watchedVideos).values(pair).run();
  for (let ratingHalfStars = 1; ratingHalfStars <= 10; ratingHalfStars++) {
    db.update(watchedVideos).set({ ratingHalfStars }).run();
    expect(db.select().from(watchedVideos).get()?.ratingHalfStars).toBe(ratingHalfStars);
  }
  for (const invalid of [-1, 0, 11, 1.5, 9.5, "invalid"]) {
    expect(() =>
      db.$client.query("UPDATE watched_videos SET rating_half_stars = ?").run(invalid),
    ).toThrow(/CHECK constraint failed/);
  }
  expect(db.select().from(watchedVideos).get()?.ratingHalfStars).toBe(10);
});

test("deleting a user removes only their recommendation and watched records", () => {
  const { db } = persistence;
  for (const userId of ["user-1", "user-2"]) {
    for (const table of linkTables) insertLink(table, userId, pair.youtubeId);
  }
  db.delete(users).where(eq(users.id, pair.userId)).run();
  expect(db.select().from(videoRecommendations).all()).toHaveLength(1);
  expect(db.select().from(videoRecommendations).get()?.userId).toBe("user-2");
  expect(db.select().from(watchedVideos).all()).toHaveLength(1);
  expect(db.select().from(watchedVideos).get()?.userId).toBe("user-2");
  expect(db.select().from(youtubeVideos).all()).toHaveLength(1);
});

test("deleting a video removes its recommendation and watched records", () => {
  const { db } = persistence;
  for (const table of linkTables) insertLink(table, pair.userId, pair.youtubeId);
  db.delete(youtubeVideos).where(eq(youtubeVideos.youtubeId, pair.youtubeId)).run();
  expect(db.select().from(videoRecommendations).all()).toHaveLength(0);
  expect(db.select().from(watchedVideos).all()).toHaveLength(0);
  expect(db.select().from(users).all()).toHaveLength(2);
});

test("rerunning migrations preserves recommendations and feedback", () => {
  const { db } = persistence;
  db.insert(videoRecommendations)
    .values({ ...pair, rationale })
    .run();
  db.insert(watchedVideos)
    .values({ ...pair, notes: "Useful", ratingHalfStars: 8 })
    .run();
  const recommendation = db.select().from(videoRecommendations).get();
  const watched = db.select().from(watchedVideos).get();
  assert(recommendation, "Expected the recommendation to exist before rerunning migrations.");
  assert(watched, "Expected the watched video to exist before rerunning migrations.");
  migrateDatabase(db);
  expect(db.select().from(videoRecommendations).all()).toEqual([recommendation]);
  expect(db.select().from(watchedVideos).all()).toEqual([watched]);
});
