import { type YouTubeConfig, youtubeConfigSchema } from "./config";
import { createDataApiProvider } from "./providers/youtube-data-api";
import type { YouTubeProvider, YouTubeProviderOptions } from "./types";

export { type YouTubeConfig, youtubeConfigSchema } from "./config";
export { loadChannel, loadVideo } from "./loaders";
export { type LoadYouTubeInput, loadYouTubeInputSchema } from "./schemas/loaders";
export { channelMetadataSchema, videoMetadataSchema } from "./schemas/metadata";
export type {
  ChannelMetadata,
  VideoMetadata,
  YouTubeErrorCode,
  YouTubeFetch,
  YouTubeProvider,
  YouTubeProviderOptions,
  YouTubeResult,
} from "./types";

export function createYouTubeProvider(
  config: YouTubeConfig,
  options: YouTubeProviderOptions = {},
): YouTubeProvider {
  const parsed = youtubeConfigSchema.parse(config);
  const apiKey = parsed.youtubeDataApi.apiKey;
  if (!apiKey) throw new Error("A YouTube Data API key is required to create the provider.");
  return createDataApiProvider(apiKey, options.fetch ?? globalThis.fetch);
}
