export { type PersistenceConfig, persistenceConfigSchema } from "./config";
export { getMigrationStatus, migrateDatabase } from "./migrate";
export {
  type NewUserRecord,
  type NewVideoRecommendationRecord,
  type NewWatchedVideoRecord,
  type NewYouTubeChannelRecord,
  type NewYouTubeVideoRecord,
  type UserRecord,
  users,
  type VideoRecommendationRecord,
  videoRecommendations,
  type WatchedVideoRecord,
  watchedVideos,
  type YouTubeChannelRecord,
  type YouTubeVideoRecord,
  youtubeChannels,
  youtubeVideos,
} from "./schema";
export { openDatabase, type Persistence } from "./sqlite";
