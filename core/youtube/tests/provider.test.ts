import { expect, mock, test } from "bun:test";
import {
  createYouTubeProvider, parseYouTubeConfig,
  type YouTubeFetch, type YouTubeProviderOptions,
} from "@curator/core/youtube";

const videoId = "dQw4w9WgXcQ";
const channelId = "UCabcdefghijABCDEFGHIJKL";
const key = "secret-test-api-key";
const config = parseYouTubeConfig({ youtubeDataApi: { apiKey: key } });

function videoItem() {
  return {
    id: videoId,
    snippet: {
      title: "Example video", channelId, publishedAt: "2026-01-01T12:00:00Z",
      thumbnails: { high: { url: "https://example.com/high.jpg" } },
    },
    contentDetails: { duration: "PT15M33S" },
  };
}

function provider(body: unknown, status = 200) {
  return createYouTubeProvider(config, { fetch: async () => Response.json(body, { status }) });
}

test("requests and normalizes video metadata", async () => {
  const fetcher = mock<YouTubeFetch>(async () => Response.json({ items: [videoItem()] }));
  const youtube = createYouTubeProvider(config, { fetch: fetcher });
  expect(await youtube.getVideo(videoId)).toEqual({ success: true, data: {
    youtubeId: videoId, title: "Example video", channelId, durationSeconds: 933,
    publishedAt: new Date("2026-01-01T12:00:00Z"), thumbnailUrl: "https://example.com/high.jpg",
  } });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [input, init] = fetcher.mock.calls[0]!;
  const url = new URL(String(input));
  expect(url.origin + url.pathname).toBe("https://www.googleapis.com/youtube/v3/videos");
  expect(url.searchParams.get("id")).toBe(videoId);
  expect(url.searchParams.get("part")).toBe("snippet,contentDetails");
  expect(url.searchParams.get("key")).toBe(key);
  expect(init?.signal).toBeInstanceOf(AbortSignal);
});

test("requests and normalizes channel metadata", async () => {
  const fetcher = mock<YouTubeFetch>(async () => Response.json({ items: [{ id: channelId, snippet: { title: "Example channel" } }] }));
  const result = await createYouTubeProvider(config, { fetch: fetcher }).getChannel(channelId);
  expect(result).toEqual({ success: true, data: { youtubeId: channelId, title: "Example channel" } });
  const url = new URL(String(fetcher.mock.calls[0]![0]));
  expect(url.pathname).toBe("/youtube/v3/channels");
  expect(url.searchParams.get("id")).toBe(channelId);
  expect(url.searchParams.get("part")).toBe("snippet");
});

test("converts zero, second, hour, and day durations", async () => {
  for (const [duration, seconds] of [
    ["PT0S", 0], ["PT45S", 45], ["PT1H2M3S", 3723], ["P2DT1H2M3S", 176523],
  ] as const) {
    const item = videoItem();
    item.contentDetails.duration = duration;
    const result = await provider({ items: [item] }).getVideo(videoId);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.durationSeconds).toBe(seconds);
  }
});

test("selects the best available valid thumbnail", async () => {
  const sizes = ["maxres", "standard", "high", "medium", "default"];
  for (let start = 0; start < sizes.length; start++) {
    const item = videoItem();
    item.snippet.thumbnails = Object.fromEntries(sizes.slice(start).map((size) => [size, { url: `https://example.com/${size}.jpg` }])) as typeof item.snippet.thumbnails;
    const result = await provider({ items: [item] }).getVideo(videoId);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.thumbnailUrl).toBe(`https://example.com/${sizes[start]}.jpg`);
  }
});

test("rejects blank IDs, URLs, handles, and lists without making a request", async () => {
  const fetcher = mock<YouTubeFetch>(async () => Response.json({ items: [] }));
  const youtube = createYouTubeProvider(config, { fetch: fetcher });
  for (const id of ["", " ", "https://youtube.com/watch?v=test", "@handle", "first,second"]) {
    expect(await youtube.getVideo(id)).toMatchObject({ success: false, error: { code: "invalid-input" } });
    expect(await youtube.getChannel(id)).toMatchObject({ success: false, error: { code: "invalid-input" } });
  }
  expect(fetcher).not.toHaveBeenCalled();
});

test("reports unavailable items for both lookups", async () => {
  const youtube = provider({ items: [] });
  expect(await youtube.getVideo(videoId)).toMatchObject({ success: false, error: { code: "not-found" } });
  expect(await youtube.getChannel(channelId)).toMatchObject({ success: false, error: { code: "not-found" } });
});

test("rejects malformed lists and mismatched IDs", async () => {
  for (const body of [null, {}, { items: null }, { items: [null] }, { items: [{ id: "different" }] }]) {
    expect(await provider(body).getVideo(videoId)).toMatchObject({ success: false, error: { code: "invalid-response" } });
    expect(await provider(body).getChannel(channelId)).toMatchObject({ success: false, error: { code: "invalid-response" } });
  }
});

test("requires all normalized video fields and valid channel titles", async () => {
  const mutations: ((item: ReturnType<typeof videoItem>) => void)[] = [
    (item) => { item.snippet.title = ""; },
    (item) => { item.snippet.channelId = ""; },
    (item) => { item.snippet.publishedAt = "invalid"; },
    (item) => { item.snippet.thumbnails = {} as typeof item.snippet.thumbnails; },
  ];
  for (const duration of ["", "P", "PT", "P1DT", "PT1.5S", "PT-1S", "PT9999999999999999999S"]) {
    mutations.push((item) => { item.contentDetails.duration = duration; });
  }
  for (const mutate of mutations) {
    const item = videoItem();
    mutate(item);
    expect(await provider({ items: [item] }).getVideo(videoId)).toMatchObject({ success: false, error: { code: "invalid-response" } });
  }
  const incomplete = videoItem();
  const { contentDetails: _, ...noDuration } = incomplete;
  expect(await provider({ items: [noDuration] }).getVideo(videoId)).toMatchObject({ success: false, error: { code: "invalid-response" } });
  expect(await provider({ items: [{ id: channelId, snippet: {} }] }).getChannel(channelId))
    .toMatchObject({ success: false, error: { code: "invalid-response" } });
});

test("reports API errors with safe status and reason", async () => {
  const result = await provider({ error: { message: `Secret ${key}`, errors: [{ reason: "quotaExceeded" }] } }, 403).getVideo(videoId);
  expect(result).toMatchObject({ success: false, error: { code: "provider-error", status: 403, reason: "quotaExceeded" } });
  expect(JSON.stringify(result)).not.toContain(key);
  expect(JSON.stringify(result)).not.toContain("googleapis.com");
  const unsafe = await provider({ error: { errors: [{ reason: key }] } }, 400).getVideo(videoId);
  expect(JSON.stringify(unsafe)).not.toContain(key);
});

test("handles invalid JSON for success and error responses", async () => {
  for (const status of [200, 500]) {
    const youtube = createYouTubeProvider(config, { fetch: async () => new Response("not json", { status }) });
    expect(await youtube.getVideo(videoId)).toMatchObject({ success: false, error: { code: status === 200 ? "invalid-response" : "provider-error" } });
  }
});

test("wraps network failures and timeouts without exposing credentials", async () => {
  for (const [name, code] of [["TypeError", "network-error"], ["TimeoutError", "timeout"]] as const) {
    const fetcher: YouTubeProviderOptions["fetch"] = async () => {
      const error = new Error(`Request URL contains key=${key}`);
      error.name = name;
      throw error;
    };
    const result = await createYouTubeProvider(config, { fetch: fetcher }).getVideo(videoId);
    expect(result).toMatchObject({ success: false, error: { code } });
    expect(JSON.stringify(result)).not.toContain(key);
  }
});
