import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { youtubeChannels } from "./youtube-channels";

export const youtubeVideos = sqliteTable("youtube_videos", {
  youtubeId: text("youtube_id").primaryKey(),
  title: text("title").notNull(),
  channelId: text("channel_id")
    .notNull()
    .references(() => youtubeChannels.youtubeId, { onDelete: "restrict" }),
  durationSeconds: integer("duration_seconds").notNull(),
  publishedAt: integer("published_at", { mode: "timestamp" }).notNull(),
  thumbnailUrl: text("thumbnail_url").notNull(),
});

export type YouTubeVideoRecord = typeof youtubeVideos.$inferSelect;
export type NewYouTubeVideoRecord = typeof youtubeVideos.$inferInsert;
