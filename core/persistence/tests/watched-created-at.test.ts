import { afterEach, beforeEach, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
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
let previousMigrations: string | undefined;

beforeEach(() => {
  persistence = openDatabase({ databasePath: ":memory:" });
});

afterEach(() => {
  persistence.close();
  if (previousMigrations) rmSync(previousMigrations, { recursive: true, force: true });
  previousMigrations = undefined;
});

test("upgrades populated legacy watched records while preserving feedback, relationships, and constraints", () => {
  const source = fileURLToPath(new URL("../migrations/", import.meta.url));
  previousMigrations = mkdtempSync(join(tmpdir(), "curator-watched-migration-"));
  mkdirSync(join(previousMigrations, "meta"));
  const journal = JSON.parse(readFileSync(join(source, "meta/_journal.json"), "utf8"));
  writeFileSync(
    join(previousMigrations, "meta/_journal.json"),
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, 3) }),
  );
  for (const name of [
    "0000_initial_users",
    "0001_youtube_channels_and_videos",
    "0002_user_video_relationships",
  ]) {
    copyFileSync(join(source, `${name}.sql`), join(previousMigrations, `${name}.sql`));
  }

  const { db } = persistence;
  migrate(db, { migrationsFolder: previousMigrations });
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
  const watchedAt = new Date("2025-01-01T12:00:00Z");
  const otherWatchedAt = new Date("2025-02-01T12:00:00Z");
  const insertLegacy = db.$client.query(
    "INSERT INTO watched_videos (user_id, youtube_id, watched_at, notes, rating_half_stars) VALUES (?, ?, ?, ?, ?)",
  );
  insertLegacy.run("user-1", "video-1", watchedAt.getTime() / 1000, "Legacy note", 9);
  insertLegacy.run("user-2", "video-1", otherWatchedAt.getTime() / 1000, null, null);
  const recommendation = db
    .insert(videoRecommendations)
    .values({ userId: "user-1", youtubeId: "video-1", rationale: "Preserve this recommendation" })
    .returning()
    .get();

  migrateDatabase(db);
  const expected = [
    {
      userId: "user-1",
      youtubeId: "video-1",
      watchedAt,
      createdAt: watchedAt,
      notes: "Legacy note",
      ratingHalfStars: 9,
    },
    {
      userId: "user-2",
      youtubeId: "video-1",
      watchedAt: otherWatchedAt,
      createdAt: otherWatchedAt,
      notes: null,
      ratingHalfStars: null,
    },
  ];
  expect(db.select().from(watchedVideos).orderBy(watchedVideos.userId).all()).toEqual(expected);
  expect(db.select().from(videoRecommendations).all()).toEqual([recommendation]);
  expect(db.$client.query("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(
    db.$client
      .query(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'watched_videos_youtube_id_idx'",
      )
      .get(),
  ).toEqual({
    name: "watched_videos_youtube_id_idx",
  });

  migrateDatabase(db);
  expect(db.select().from(watchedVideos).orderBy(watchedVideos.userId).all()).toEqual(expected);
  expect(() =>
    db.insert(watchedVideos).values({ userId: "user-1", youtubeId: "video-1" }).run(),
  ).toThrow(/UNIQUE constraint failed/);
  expect(() =>
    db.insert(watchedVideos).values({ userId: "missing-user", youtubeId: "video-1" }).run(),
  ).toThrow(/FOREIGN KEY constraint failed/);
  expect(() =>
    db.insert(watchedVideos).values({ userId: "user-1", youtubeId: "missing-video" }).run(),
  ).toThrow(/FOREIGN KEY constraint failed/);
  for (const rating of [0, 11, 1.5]) {
    expect(() =>
      db.$client
        .query("UPDATE watched_videos SET rating_half_stars = ? WHERE user_id = 'user-1'")
        .run(rating),
    ).toThrow(/CHECK constraint failed/);
  }
  db.delete(users).where(eq(users.id, "user-1")).run();
  expect(db.select().from(watchedVideos).all()).toEqual(
    expected.filter((record) => record.userId === "user-2"),
  );
  expect(db.select().from(videoRecommendations).all()).toHaveLength(0);
});
