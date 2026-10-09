import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./users";
import { youtubeVideos } from "./youtube-videos";

export const watchedVideos = sqliteTable("watched_videos", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  youtubeId: text("youtube_id").notNull().references(() => youtubeVideos.youtubeId, { onDelete: "cascade" }),
  watchedAt: integer("watched_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  notes: text("notes"),
  ratingHalfStars: integer("rating_half_stars"),
}, (table) => [
  primaryKey({ columns: [table.userId, table.youtubeId] }),
  index("watched_videos_youtube_id_idx").on(table.youtubeId),
  check("watched_videos_rating_half_stars_check", sql`
    ${table.ratingHalfStars} IS NULL OR (
      typeof(${table.ratingHalfStars}) = 'integer'
      AND ${table.ratingHalfStars} BETWEEN 1 AND 10
    )
  `),
]);

export type WatchedVideoRecord = typeof watchedVideos.$inferSelect;
export type NewWatchedVideoRecord = typeof watchedVideos.$inferInsert;
