import {
  type Persistence,
  type YouTubeChannelRecord,
  type YouTubeVideoRecord,
  youtubeChannels,
  youtubeVideos,
} from "#persistence";
import { type LoadYouTubeInput, loadYouTubeInputSchema } from "./schemas/loaders";
import { channelMetadataSchema, videoMetadataSchema } from "./schemas/metadata";
import type { YouTubeProvider, YouTubeResult } from "./types";

function invalidInput(): YouTubeResult<never> {
  return {
    success: false,
    error: { code: "invalid-input", message: "Provide a single YouTube ID, not a URL or list." },
  };
}

function invalidMetadata(): YouTubeResult<never> {
  return {
    success: false,
    error: {
      code: "invalid-response",
      message: "Provider metadata is invalid or mismatches the requested ID.",
    },
  };
}

// Trusted hosts control access to these shared catalog writes.
export async function loadVideo(
  db: Persistence["db"],
  provider: YouTubeProvider,
  input: LoadYouTubeInput,
): Promise<YouTubeResult<YouTubeVideoRecord>> {
  const parsed = loadYouTubeInputSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const result = await provider.getVideo(parsed.data.youtubeId);
  if (!result.success) return result;
  const metadata = videoMetadataSchema.safeParse(result.data);
  if (!metadata.success || metadata.data.youtubeId !== parsed.data.youtubeId) {
    return invalidMetadata();
  }
  const { channelTitle, ...video } = metadata.data;
  const saved = db.transaction((tx) => {
    tx.insert(youtubeChannels)
      .values({ youtubeId: video.channelId, title: channelTitle })
      .onConflictDoUpdate({ target: youtubeChannels.youtubeId, set: { title: channelTitle } })
      .run();
    return tx
      .insert(youtubeVideos)
      .values(video)
      .onConflictDoUpdate({ target: youtubeVideos.youtubeId, set: video })
      .returning()
      .get();
  });
  return { success: true, data: saved };
}

export async function loadChannel(
  db: Persistence["db"],
  provider: YouTubeProvider,
  input: LoadYouTubeInput,
): Promise<YouTubeResult<YouTubeChannelRecord>> {
  const parsed = loadYouTubeInputSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const result = await provider.getChannel(parsed.data.youtubeId);
  if (!result.success) return result;
  const metadata = channelMetadataSchema.safeParse(result.data);
  if (!metadata.success || metadata.data.youtubeId !== parsed.data.youtubeId) {
    return invalidMetadata();
  }
  const saved = db
    .insert(youtubeChannels)
    .values(metadata.data)
    .onConflictDoUpdate({ target: youtubeChannels.youtubeId, set: { title: metadata.data.title } })
    .returning()
    .get();
  return { success: true, data: saved };
}
