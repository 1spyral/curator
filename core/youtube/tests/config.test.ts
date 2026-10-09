import { expect, test } from "bun:test";
import { parseCoreConfig } from "@curator/core/config";
import { createYouTubeProvider, parseYouTubeConfig } from "@curator/core/youtube";

test("defaults to the Data API without requiring a key for core config", () => {
  const config = parseCoreConfig();
  expect(config.persistence.databasePath).toBe(".data/curator.sqlite");
  expect(config.youtube).toEqual({ provider: "youtube-data-api", youtubeDataApi: {} });
  expect(Object.isFrozen(config.youtube)).toBe(true);
  expect(Object.isFrozen(config.youtube.youtubeDataApi)).toBe(true);
  expect(() => createYouTubeProvider(config.youtube)).toThrow(/key is required/);
});

test("accepts and composes a supplied key without reading the environment", () => {
  const config = parseCoreConfig({ youtube: { youtubeDataApi: { apiKey: " test-key " } } });
  expect(config.youtube.youtubeDataApi.apiKey).toBe("test-key");
  expect(createYouTubeProvider(config.youtube)).toHaveProperty("getVideo");
  expect(createYouTubeProvider(config.youtube)).toHaveProperty("getChannel");
});

test("rejects malformed module config, selectors, sections, and keys", () => {
  for (const input of [
    null, [], "config", { provider: "yt-dlp" }, { provider: null },
    { youtubeDataApi: null }, { youtubeDataApi: [] },
    { youtubeDataApi: { apiKey: "" } }, { youtubeDataApi: { apiKey: " " } },
    { youtubeDataApi: { apiKey: 42 } }, { youtubeDataApi: { apiKey: null } },
  ]) expect(() => parseYouTubeConfig(input)).toThrow();
  expect(parseYouTubeConfig({ provider: undefined, youtubeDataApi: undefined }))
    .toEqual(parseYouTubeConfig());
});
