import { youtube } from "@googleapis/youtube";
import { channelMetadataSchema, videoMetadataSchema } from "../../schemas/metadata";
import type {
  ChannelMetadata,
  VideoMetadata,
  YouTubeErrorCode,
  YouTubeFetch,
  YouTubeProvider,
  YouTubeResult,
} from "../../types";
import {
  apiErrorReasonSchema,
  apiErrorSchema,
  channelItemSchema,
  itemIdentitySchema,
  itemListSchema,
  thumbnailSchema,
  videoItemSchema,
  youtubeIdSchema,
} from "./schemas";

function failure(code: YouTubeErrorCode, message: string): YouTubeResult<never> {
  return { success: false, error: { code, message } };
}

function durationSeconds(value: unknown): number | null {
  if (typeof value !== "string" || value.endsWith("T")) return null;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  if (!match?.slice(1).some((part) => part !== undefined)) return null;
  const seconds =
    Number(match[1] ?? 0) * 86400 +
    Number(match[2] ?? 0) * 3600 +
    Number(match[3] ?? 0) * 60 +
    Number(match[4] ?? 0);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

function thumbnailUrl(value: Record<string, unknown>): string | null {
  for (const size of ["maxres", "standard", "high", "medium", "default"]) {
    const thumbnail = thumbnailSchema.safeParse(value[size]);
    if (thumbnail.success) return thumbnail.data.url;
  }
  return null;
}

export function createDataApiProvider(apiKey: string, fetcher: YouTubeFetch): YouTubeProvider {
  const client = youtube({
    version: "v3",
    auth: apiKey,
    // Gaxios only calls fetch; Bun's extra typed preconnect property is unused.
    fetchImplementation: fetcher as typeof globalThis.fetch,
    responseType: "json",
    retry: false,
    // Keep HTTP failure mapping inside the provider's credential-safe result contract.
    validateStatus: () => true,
  });

  async function request(
    resource: "videos" | "channels",
    id: string,
  ): Promise<YouTubeResult<Record<string, unknown>>> {
    if (!youtubeIdSchema.safeParse(id).success) {
      return failure("invalid-input", "Provide a single YouTube ID, not a URL or list.");
    }
    const signal = AbortSignal.timeout(15000);
    try {
      const response =
        resource === "videos"
          ? await client.videos.list({ id: [id], part: ["snippet", "contentDetails"] }, { signal })
          : await client.channels.list({ id: [id], part: ["snippet"] }, { signal });
      const body: unknown = response.data;
      if (!response.ok) {
        const result: YouTubeResult<never> = {
          success: false,
          error: {
            code: "provider-error",
            message: "YouTube Data API request failed.",
            status: response.status,
          },
        };
        const apiError = apiErrorSchema.safeParse(body);
        if (apiError.success) {
          const reason = apiErrorReasonSchema.safeParse(apiError.data.error.errors[0]);
          if (reason.success && !reason.data.reason.includes(apiKey)) {
            result.error.reason = reason.data.reason;
          }
        }
        return result;
      }
      const list = itemListSchema.safeParse(body);
      if (!list.success) {
        return failure("invalid-response", "YouTube returned an invalid item list.");
      }
      if (list.data.items.length === 0)
        return failure("not-found", "No accessible matching YouTube item was found.");
      for (const entry of list.data.items) {
        const item = itemIdentitySchema.safeParse(entry);
        if (item.success && item.data.id === id) return { success: true, data: item.data };
      }
      return failure("invalid-response", "YouTube returned no matching item ID.");
    } catch (error) {
      if (
        signal.aborted ||
        (error instanceof Error &&
          (error.name === "TimeoutError" ||
            (error.cause instanceof Error && error.cause.name === "TimeoutError")))
      ) {
        return failure("timeout", "YouTube Data API request timed out.");
      }
      return failure("network-error", "YouTube Data API request could not be completed.");
    }
  }

  return {
    async getVideo(youtubeId): Promise<YouTubeResult<VideoMetadata>> {
      const result = await request("videos", youtubeId);
      if (!result.success) return result;
      const item = videoItemSchema.safeParse(result.data);
      if (!item.success) {
        return failure("invalid-response", "Video metadata is incomplete.");
      }
      const { snippet, contentDetails } = item.data;
      const metadata = videoMetadataSchema.safeParse({
        youtubeId,
        title: snippet.title,
        channelId: snippet.channelId,
        channelTitle: snippet.channelTitle,
        durationSeconds: durationSeconds(contentDetails.duration),
        publishedAt: snippet.publishedAt,
        thumbnailUrl: thumbnailUrl(snippet.thumbnails),
      });
      if (!metadata.success) {
        return failure("invalid-response", "Video metadata is incomplete or invalid.");
      }
      return { success: true, data: metadata.data };
    },
    async getChannel(youtubeId): Promise<YouTubeResult<ChannelMetadata>> {
      const result = await request("channels", youtubeId);
      if (!result.success) return result;
      const item = channelItemSchema.safeParse(result.data);
      if (!item.success) {
        return failure("invalid-response", "Channel metadata is incomplete or invalid.");
      }
      const metadata = channelMetadataSchema.safeParse({
        youtubeId,
        title: item.data.snippet.title,
      });
      if (!metadata.success)
        return failure("invalid-response", "Channel metadata is incomplete or invalid.");
      return { success: true, data: metadata.data };
    },
  };
}
