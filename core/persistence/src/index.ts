export { openDatabase, type Persistence } from "./sqlite";
export { parsePersistenceConfig, type PersistenceConfig } from "./config";
export { migrateDatabase } from "./migrate";
export { users, type UserRecord, type NewUserRecord } from "./schema";
export {
  youtubeChannels,
  type YouTubeChannelRecord,
  type NewYouTubeChannelRecord,
  youtubeVideos,
  type YouTubeVideoRecord,
  type NewYouTubeVideoRecord,
} from "./schema";
