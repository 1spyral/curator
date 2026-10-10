import { and, asc, desc, eq, getTableColumns, gt, lt, or } from "drizzle-orm";
import { type Actor, AuthorizationError, actorSchema } from "#identity";
import {
  type WatchedVideoRecord,
  watchedVideos,
  type YouTubeChannelRecord,
  type YouTubeVideoRecord,
  youtubeChannels,
  youtubeVideos,
} from "#persistence/schema";
import type { Persistence } from "#persistence/sqlite";
import {
  type CreateWatchedVideoInput,
  createWatchedVideoInputSchema,
  type GetWatchedVideoInput,
  type GetWatchedVideosInput,
  getWatchedVideoInputSchema,
  getWatchedVideosInputSchema,
  type UpdateWatchedVideoInput,
  updateWatchedVideoInputSchema,
  watchedVideosCursorSchema,
} from "./schemas/watched-videos";
import { ensureShelfVideo, type ShelfCreationDependencies } from "./video-loading";

export type WatchedVideoItem = WatchedVideoRecord & {
  video?: YouTubeVideoRecord;
  channel?: YouTubeChannelRecord;
};

export type WatchedVideosPage = {
  items: WatchedVideoItem[];
  nextCursor: string | null;
};

function authorizeWatchedAccess(actor: Actor, targetUserId: string) {
  const caller = actorSchema.parse(actor);
  if (caller.userId !== targetUserId) {
    throw new AuthorizationError(
      "The actor is not authorized to access this user's watched videos.",
    );
  }
}

function selectWatchedVideos(
  db: Persistence["db"],
  options: { includeVideoMetadata: boolean; includeChannelMetadata: boolean },
) {
  const query = db
    .select({
      ...getTableColumns(watchedVideos),
      ...(options.includeVideoMetadata ? { video: youtubeVideos } : {}),
      ...(options.includeChannelMetadata ? { channel: youtubeChannels } : {}),
    })
    .from(watchedVideos)
    .$dynamic();
  const videoQuery =
    options.includeVideoMetadata || options.includeChannelMetadata
      ? query.innerJoin(youtubeVideos, eq(watchedVideos.youtubeId, youtubeVideos.youtubeId))
      : query;
  return options.includeChannelMetadata
    ? videoQuery.innerJoin(youtubeChannels, eq(youtubeVideos.channelId, youtubeChannels.youtubeId))
    : videoQuery;
}

export async function createWatchedVideo(
  db: Persistence["db"],
  actor: Actor,
  input: CreateWatchedVideoInput,
  dependencies: ShelfCreationDependencies,
): Promise<WatchedVideoRecord> {
  const values = createWatchedVideoInputSchema.parse(input);
  authorizeWatchedAccess(actor, values.userId);
  await ensureShelfVideo(db, values.userId, values.youtubeId, dependencies);
  const record = db.insert(watchedVideos).values(values).returning().get();
  if (!record) throw new Error("Expected the inserted watched record to be returned.");
  return record;
}

export function updateWatchedVideo(
  db: Persistence["db"],
  actor: Actor,
  input: UpdateWatchedVideoInput,
): WatchedVideoRecord | null {
  const values = updateWatchedVideoInputSchema.parse(input);
  authorizeWatchedAccess(actor, values.userId);
  return (
    db
      .update(watchedVideos)
      .set({
        watchedAt: values.watchedAt,
        notes: values.notes,
        ratingHalfStars: values.ratingHalfStars,
      })
      .where(
        and(eq(watchedVideos.userId, values.userId), eq(watchedVideos.youtubeId, values.youtubeId)),
      )
      .returning()
      .get() ?? null
  );
}

export function getWatchedVideo(
  db: Persistence["db"],
  actor: Actor,
  input: GetWatchedVideoInput,
): WatchedVideoItem | null {
  const values = getWatchedVideoInputSchema.parse(input);
  authorizeWatchedAccess(actor, values.userId);
  return (
    selectWatchedVideos(db, values)
      .where(
        and(eq(watchedVideos.userId, values.userId), eq(watchedVideos.youtubeId, values.youtubeId)),
      )
      .get() ?? null
  );
}

export function getWatchedVideos(
  db: Persistence["db"],
  actor: Actor,
  input: GetWatchedVideosInput,
): WatchedVideosPage {
  const values = getWatchedVideosInputSchema.parse(input);
  authorizeWatchedAccess(actor, values.userId);
  const position = values.cursor ? watchedVideosCursorSchema.parse(values.cursor) : undefined;
  const sortColumn = watchedVideos[values.sortBy];
  const compare = values.sortOrder === "asc" ? gt : lt;
  const order = values.sortOrder === "asc" ? asc : desc;
  const positionDate = position ? new Date(position.sortValue * 1000) : undefined;
  const cursorCondition =
    position && positionDate
      ? or(
          compare(sortColumn, positionDate),
          and(eq(sortColumn, positionDate), compare(watchedVideos.youtubeId, position.youtubeId)),
        )
      : undefined;

  const rows = selectWatchedVideos(db, values)
    .where(and(eq(watchedVideos.userId, values.userId), cursorCondition))
    .orderBy(order(sortColumn), order(watchedVideos.youtubeId))
    .limit(values.limit + 1)
    .all();
  const items = rows.slice(0, values.limit);
  const last = items.at(-1);
  const nextCursor =
    rows.length > values.limit && last
      ? Buffer.from(
          JSON.stringify({
            version: 1,
            kind: "watched-videos",
            userId: values.userId,
            sortBy: values.sortBy,
            sortOrder: values.sortOrder,
            sortValue: last[values.sortBy].getTime() / 1000,
            youtubeId: last.youtubeId,
          }),
        ).toString("base64url")
      : null;
  return { items, nextCursor };
}
