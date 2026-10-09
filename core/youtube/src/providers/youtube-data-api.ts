import type {
  ChannelMetadata, VideoMetadata, YouTubeErrorCode, YouTubeFetch,
  YouTubeProvider, YouTubeResult,
} from "../types";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function failure(code: YouTubeErrorCode, message: string): YouTubeResult<never> {
  return { success: false, error: { code, message } };
}

function durationSeconds(value: unknown): number | null {
  if (typeof value !== "string" || value.endsWith("T")) return null;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  if (!match || !match.slice(1).some((part) => part !== undefined)) return null;
  const seconds = Number(match[1] ?? 0) * 86400 + Number(match[2] ?? 0) * 3600
    + Number(match[3] ?? 0) * 60 + Number(match[4] ?? 0);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

function thumbnailUrl(value: unknown): string | null {
  if (!isObject(value)) return null;
  for (const size of ["maxres", "standard", "high", "medium", "default"]) {
    const thumbnail = value[size];
    if (!isObject(thumbnail) || !isText(thumbnail.url)) continue;
    try {
      const url = new URL(thumbnail.url);
      if (url.protocol === "https:" || url.protocol === "http:") return thumbnail.url;
    } catch {
      // Try the next available thumbnail size.
    }
  }
  return null;
}

export function createDataApiProvider(apiKey: string, fetcher: YouTubeFetch): YouTubeProvider {
  async function request(resource: "videos" | "channels", id: string): Promise<YouTubeResult<Record<string, unknown>>> {
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]+$/.test(id)) {
      return failure("invalid-input", "Provide a single YouTube ID, not a URL or list.");
    }
    const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
    url.searchParams.set("part", resource === "videos" ? "snippet,contentDetails" : "snippet");
    url.searchParams.set("id", id);
    url.searchParams.set("key", apiKey);
    const signal = AbortSignal.timeout(15000);
    try {
      const response = await fetcher(url, { signal });
      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        if (signal.aborted || !(error instanceof SyntaxError)) throw error;
        if (response.ok) return failure("invalid-response", "YouTube returned invalid JSON.");
      }
      if (!response.ok) {
        const result: YouTubeResult<never> = {
          success: false,
          error: { code: "provider-error", message: "YouTube Data API request failed.", status: response.status },
        };
        if (isObject(body) && isObject(body.error) && Array.isArray(body.error.errors)) {
          const first = body.error.errors[0];
          if (isObject(first) && typeof first.reason === "string"
            && /^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(first.reason) && !first.reason.includes(apiKey)) {
            result.error.reason = first.reason;
          }
        }
        return result;
      }
      if (!isObject(body) || !Array.isArray(body.items)) {
        return failure("invalid-response", "YouTube returned an invalid item list.");
      }
      if (body.items.length === 0) return failure("not-found", "No accessible matching YouTube item was found.");
      const item = body.items.find((entry: unknown) => isObject(entry) && entry.id === id);
      if (!isObject(item)) return failure("invalid-response", "YouTube returned no matching item ID.");
      return { success: true, data: item };
    } catch (error) {
      if (signal.aborted || (error instanceof Error && error.name === "TimeoutError")) {
        return failure("timeout", "YouTube Data API request timed out.");
      }
      return failure("network-error", "YouTube Data API request could not be completed.");
    }
  }

  return {
    async getVideo(youtubeId): Promise<YouTubeResult<VideoMetadata>> {
      const result = await request("videos", youtubeId);
      if (!result.success) return result;
      const { snippet, contentDetails } = result.data;
      if (!isObject(snippet) || !isObject(contentDetails)) {
        return failure("invalid-response", "Video metadata is incomplete.");
      }
      const duration = durationSeconds(contentDetails.duration);
      const thumbnail = thumbnailUrl(snippet.thumbnails);
      const publishedAt = isText(snippet.publishedAt) && /^\d{4}-\d{2}-\d{2}T/.test(snippet.publishedAt)
        ? new Date(snippet.publishedAt) : null;
      if (!isText(snippet.title) || !isText(snippet.channelId) || duration === null || thumbnail === null
        || publishedAt === null || !Number.isFinite(publishedAt.getTime())) {
        return failure("invalid-response", "Video metadata is incomplete or invalid.");
      }
      return { success: true, data: {
        youtubeId, title: snippet.title, channelId: snippet.channelId,
        durationSeconds: duration, publishedAt, thumbnailUrl: thumbnail,
      } };
    },
    async getChannel(youtubeId): Promise<YouTubeResult<ChannelMetadata>> {
      const result = await request("channels", youtubeId);
      if (!result.success) return result;
      const { snippet } = result.data;
      if (!isObject(snippet) || !isText(snippet.title)) {
        return failure("invalid-response", "Channel metadata is incomplete or invalid.");
      }
      return { success: true, data: { youtubeId, title: snippet.title } };
    },
  };
}
