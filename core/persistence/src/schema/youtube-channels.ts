import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const youtubeChannels = sqliteTable("youtube_channels", {
  youtubeId: text("youtube_id").primaryKey(),
  title: text("title").notNull(),
});

export type YouTubeChannelRecord = typeof youtubeChannels.$inferSelect;
export type NewYouTubeChannelRecord = typeof youtubeChannels.$inferInsert;
