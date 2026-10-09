import { afterEach, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import {
  migrateDatabase,
  openDatabase,
  users,
  youtubeChannels,
  youtubeVideos,
  type NewYouTubeVideoRecord,
  type Persistence,
} from "../src";

let persistence: Persistence;

const channel = { youtubeId: "channel-1", title: "Example channel" };
const video: NewYouTubeVideoRecord = {
  youtubeId: "video-1",
  title: "Example video",
  channelId: channel.youtubeId,
  durationSeconds: 120,
  publishedAt: new Date("2026-01-01T12:00:00Z"),
  thumbnailUrl: "https://example.com/thumbnail.jpg",
};

beforeEach(() => {
  persistence = openDatabase({ databasePath: ":memory:" });
  migrateDatabase(persistence.db);
});

afterEach(() => persistence.close());

test("stores multiple videos for a channel and converts publication timestamps", () => {
  const { db } = persistence;
  db.insert(youtubeChannels).values(channel).run();
  db.insert(youtubeVideos)
    .values([video, { ...video, youtubeId: "video-2" }])
    .run();

  const saved = db
    .select()
    .from(youtubeVideos)
    .where(eq(youtubeVideos.youtubeId, video.youtubeId))
    .get();
  expect(saved).toEqual(video);
  expect(saved?.publishedAt).toBeInstanceOf(Date);
  expect(db.select().from(youtubeVideos).all()).toHaveLength(2);
  expect(
    db.$client
      .query("SELECT published_at FROM youtube_videos WHERE youtube_id = ?")
      .get(video.youtubeId),
  ).toEqual({ published_at: video.publishedAt.getTime() / 1000 });
});

test("requires every channel and video metadata field", () => {
  const { db } = persistence;
  expect(() =>
    db.$client.query("INSERT INTO youtube_channels (youtube_id) VALUES (?)").run(channel.youtubeId),
  ).toThrow(/NOT NULL constraint failed/);
  expect(() =>
    db.$client.query("INSERT INTO youtube_channels (title) VALUES (?)").run(channel.title),
  ).toThrow(/NOT NULL constraint failed/);
  db.insert(youtubeChannels).values(channel).run();

  const columns = [
    "youtube_id",
    "title",
    "channel_id",
    "duration_seconds",
    "published_at",
    "thumbnail_url",
  ];
  const values = [
    video.youtubeId,
    video.title,
    video.channelId,
    video.durationSeconds,
    video.publishedAt.getTime() / 1000,
    video.thumbnailUrl,
  ];
  for (const missing of columns) {
    const included = columns.filter((column) => column !== missing);
    const bindings = values.filter((_, index) => columns[index] !== missing);
    const statement = db.$client.query(
      `INSERT INTO youtube_videos (${included.join(", ")}) VALUES (${included.map(() => "?").join(", ")})`,
    );
    expect(() => statement.run(...bindings)).toThrow(/NOT NULL constraint failed/);
  }
});

test("rejects duplicate channel and video YouTube IDs", () => {
  const { db } = persistence;
  db.insert(youtubeChannels).values(channel).run();
  db.insert(youtubeVideos).values(video).run();

  expect(() => db.insert(youtubeChannels).values(channel).run()).toThrow(
    /UNIQUE constraint failed/,
  );
  expect(() => db.insert(youtubeVideos).values(video).run()).toThrow(/UNIQUE constraint failed/);
});

test("requires an existing channel and prevents deleting a referenced channel", () => {
  const { db } = persistence;
  expect(() => db.insert(youtubeVideos).values(video).run()).toThrow(
    /FOREIGN KEY constraint failed/,
  );
  db.insert(youtubeChannels).values(channel).run();
  db.insert(youtubeVideos).values(video).run();
  expect(() =>
    db.delete(youtubeChannels).where(eq(youtubeChannels.youtubeId, channel.youtubeId)).run(),
  ).toThrow(/FOREIGN KEY constraint failed/);

  db.delete(youtubeVideos).where(eq(youtubeVideos.youtubeId, video.youtubeId)).run();
  db.delete(youtubeChannels).where(eq(youtubeChannels.youtubeId, channel.youtubeId)).run();
  expect(db.select().from(youtubeChannels).all()).toHaveLength(0);
});

test("rerunning migrations preserves existing users and YouTube metadata", () => {
  const { db } = persistence;
  db.insert(users).values({ id: "local", name: "Local user" }).run();
  db.insert(youtubeChannels).values(channel).run();
  db.insert(youtubeVideos).values(video).run();
  migrateDatabase(db);

  expect(db.select().from(users).all()).toHaveLength(1);
  expect(db.select().from(youtubeChannels).all()).toEqual([channel]);
  expect(db.select().from(youtubeVideos).all()).toEqual([video]);
});
