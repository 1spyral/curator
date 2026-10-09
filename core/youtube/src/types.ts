import type { z } from "zod";
import type { channelMetadataSchema, videoMetadataSchema } from "./schemas/metadata";

export type VideoMetadata = z.infer<typeof videoMetadataSchema>;
export type ChannelMetadata = z.infer<typeof channelMetadataSchema>;

export type YouTubeErrorCode =
  | "invalid-input"
  | "not-found"
  | "invalid-response"
  | "provider-error"
  | "network-error"
  | "timeout";

export type YouTubeResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: { code: YouTubeErrorCode; message: string; status?: number; reason?: string };
    };

export interface YouTubeProvider {
  getVideo(youtubeId: string): Promise<YouTubeResult<VideoMetadata>>;
  getChannel(youtubeId: string): Promise<YouTubeResult<ChannelMetadata>>;
}

export type YouTubeFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type YouTubeProviderOptions = { fetch?: YouTubeFetch };
