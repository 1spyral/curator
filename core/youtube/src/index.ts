import { youtubeConfigSchema, type YouTubeConfig } from "./config";
import { createDataApiProvider } from "./providers/youtube-data-api";
import type { YouTubeProvider, YouTubeProviderOptions } from "./types";

export { youtubeConfigSchema, type YouTubeConfig } from "./config";
export { videoMetadataSchema, channelMetadataSchema } from "./schemas/metadata";
export type {
  VideoMetadata, ChannelMetadata, YouTubeResult, YouTubeErrorCode,
  YouTubeProvider, YouTubeProviderOptions, YouTubeFetch,
} from "./types";

export function createYouTubeProvider(config: YouTubeConfig, options: YouTubeProviderOptions = {}): YouTubeProvider {
  const parsed = youtubeConfigSchema.parse(config);
  const apiKey = parsed.youtubeDataApi.apiKey;
  if (!apiKey) throw new Error("A YouTube Data API key is required to create the provider.");
  return createDataApiProvider(apiKey, options.fetch ?? globalThis.fetch);
}
