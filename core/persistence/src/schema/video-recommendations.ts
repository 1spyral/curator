import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./users";
import { youtubeVideos } from "./youtube-videos";

export const videoRecommendations = sqliteTable("video_recommendations", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  youtubeId: text("youtube_id").notNull().references(() => youtubeVideos.youtubeId, { onDelete: "cascade" }),
  rationale: text("rationale").notNull(),
  recommendedAt: integer("recommended_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
}, (table) => [
  primaryKey({ columns: [table.userId, table.youtubeId] }),
  index("video_recommendations_youtube_id_idx").on(table.youtubeId),
]);

export type VideoRecommendationRecord = typeof videoRecommendations.$inferSelect;
export type NewVideoRecommendationRecord = typeof videoRecommendations.$inferInsert;
