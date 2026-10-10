import { eq } from "drizzle-orm";
import { type Persistence, users, youtubeVideos } from "#persistence";
import { loadVideo, type YouTubeProvider, type YouTubeResult } from "#youtube";

export type ShelfCreationDependencies = {
  getYouTubeProvider: () => YouTubeProvider;
};

export class VideoLoadError extends Error {
  constructor(readonly error: Extract<YouTubeResult<never>, { success: false }>["error"]) {
    super(error.message);
    this.name = "VideoLoadError";
  }
}

// Call only after validating input and authorizing the explicit shelf target.
export async function ensureShelfVideo(
  db: Persistence["db"],
  userId: string,
  youtubeId: string,
  dependencies: ShelfCreationDependencies,
): Promise<void> {
  if (!db.select({ id: users.id }).from(users).where(eq(users.id, userId)).get()) {
    throw new Error("Target user does not exist.");
  }
  if (
    db
      .select({ id: youtubeVideos.youtubeId })
      .from(youtubeVideos)
      .where(eq(youtubeVideos.youtubeId, youtubeId))
      .get()
  )
    return;
  const result = await loadVideo(db, dependencies.getYouTubeProvider(), { youtubeId });
  if (!result.success) throw new VideoLoadError(result.error);
}
