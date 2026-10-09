import {
  and,
  asc,
  desc,
  eq,
  exists,
  getTableColumns,
  gt,
  lt,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { type Actor, AuthorizationError, actorSchema } from "#identity";
import {
  type VideoRecommendationRecord,
  videoRecommendations,
  watchedVideos,
  type YouTubeChannelRecord,
  type YouTubeVideoRecord,
  youtubeChannels,
  youtubeVideos,
} from "#persistence/schema";
import type { Persistence } from "#persistence/sqlite";
import {
  type AddRecommendationInput,
  addRecommendationInputSchema,
  type GetRecommendationsInput,
  getRecommendationsInputSchema,
  recommendationCursorSchema,
} from "./schemas/recommendations";

export type { AddRecommendationInput } from "./schemas/recommendations";

export type RecommendationItem = VideoRecommendationRecord & {
  video?: YouTubeVideoRecord;
  channel?: YouTubeChannelRecord;
};

export type RecommendationsPage = {
  items: RecommendationItem[];
  nextCursor: string | null;
};

export function addRecommendation(
  db: Persistence["db"],
  actor: Actor,
  input: AddRecommendationInput,
): VideoRecommendationRecord {
  const caller = actorSchema.parse(actor);
  const values = addRecommendationInputSchema.parse(input);
  if (caller.userId !== values.userId) {
    throw new AuthorizationError(
      "The actor is not authorized to add recommendations to this user's shelf.",
    );
  }
  const recommendation = db.insert(videoRecommendations).values(values).returning().get();
  if (!recommendation) throw new Error("Expected the inserted recommendation to be returned.");
  return recommendation;
}

export function getRecommendations(
  db: Persistence["db"],
  actor: Actor,
  input: GetRecommendationsInput,
): RecommendationsPage {
  const caller = actorSchema.parse(actor);
  const values = getRecommendationsInputSchema.parse(input);
  if (caller.userId !== values.userId) {
    throw new AuthorizationError(
      "The actor is not authorized to read recommendations from this user's shelf.",
    );
  }

  const position = values.cursor ? recommendationCursorSchema.parse(values.cursor) : undefined;
  const watchedQuery = db
    .select({ value: sql`1` })
    .from(watchedVideos)
    .where(
      and(
        eq(watchedVideos.userId, values.userId),
        eq(watchedVideos.youtubeId, videoRecommendations.youtubeId),
      ),
    );
  const watchedCondition =
    values.watchStatus === "watched"
      ? exists(watchedQuery)
      : values.watchStatus === "unwatched"
        ? notExists(watchedQuery)
        : undefined;

  const compare = values.sortOrder === "asc" ? gt : lt;
  const order = values.sortOrder === "asc" ? asc : desc;
  const positionDate = position ? new Date(position.recommendedAt * 1000) : undefined;
  const cursorCondition =
    position && positionDate
      ? or(
          compare(videoRecommendations.recommendedAt, positionDate),
          and(
            eq(videoRecommendations.recommendedAt, positionDate),
            compare(videoRecommendations.youtubeId, position.youtubeId),
          ),
        )
      : undefined;

  const query = db
    .select({
      ...getTableColumns(videoRecommendations),
      ...(values.includeVideoMetadata ? { video: youtubeVideos } : {}),
      ...(values.includeChannelMetadata ? { channel: youtubeChannels } : {}),
    })
    .from(videoRecommendations)
    .$dynamic();

  const videoQuery =
    values.includeVideoMetadata || values.includeChannelMetadata
      ? query.innerJoin(youtubeVideos, eq(videoRecommendations.youtubeId, youtubeVideos.youtubeId))
      : query;
  const metadataQuery = values.includeChannelMetadata
    ? videoQuery.innerJoin(youtubeChannels, eq(youtubeVideos.channelId, youtubeChannels.youtubeId))
    : videoQuery;

  const rows = metadataQuery
    .where(and(eq(videoRecommendations.userId, values.userId), watchedCondition, cursorCondition))
    .orderBy(order(videoRecommendations.recommendedAt), order(videoRecommendations.youtubeId))
    .limit(values.limit + 1)
    .all();
  const items = rows.slice(0, values.limit);
  const last = items.at(-1);
  const nextCursor =
    rows.length > values.limit && last
      ? Buffer.from(
          JSON.stringify({
            version: 1,
            userId: values.userId,
            watchStatus: values.watchStatus,
            sortBy: values.sortBy,
            sortOrder: values.sortOrder,
            recommendedAt: last.recommendedAt.getTime() / 1000,
            youtubeId: last.youtubeId,
          }),
        ).toString("base64url")
      : null;

  return { items, nextCursor };
}
