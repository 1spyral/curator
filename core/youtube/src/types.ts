export type VideoMetadata = {
  youtubeId: string;
  title: string;
  channelId: string;
  durationSeconds: number;
  publishedAt: Date;
  thumbnailUrl: string;
};

export type ChannelMetadata = { youtubeId: string; title: string };

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
