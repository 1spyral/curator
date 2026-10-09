export type YouTubeConfig = Readonly<{
  provider: "youtube-data-api";
  youtubeDataApi: Readonly<{ apiKey?: string }>;
}>;

export function parseYouTubeConfig(input: unknown = {}): YouTubeConfig {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("YouTube config must be an object.");
  }
  const selected = "provider" in input ? input.provider : undefined;
  const provider = selected === undefined ? "youtube-data-api" : selected;
  if (provider !== "youtube-data-api") {
    throw new Error("youtube.provider must be youtube-data-api.");
  }
  const suppliedSection = "youtubeDataApi" in input ? input.youtubeDataApi : undefined;
  const section = suppliedSection === undefined ? {} : suppliedSection;
  if (typeof section !== "object" || section === null || Array.isArray(section)) {
    throw new Error("youtube.youtubeDataApi must be an object.");
  }
  const apiKey = "apiKey" in section ? section.apiKey : undefined;
  if (apiKey !== undefined && (typeof apiKey !== "string" || apiKey.trim().length === 0)) {
    throw new Error("youtube.youtubeDataApi.apiKey must be a non-empty string.");
  }
  const youtubeDataApi = apiKey === undefined ? {} : { apiKey: apiKey.trim() };
  return Object.freeze({ provider, youtubeDataApi: Object.freeze(youtubeDataApi) });
}
