import { parsePersistenceConfig, type PersistenceConfig } from "#persistence/config";
import { parseYouTubeConfig, type YouTubeConfig } from "#youtube/config";

export type CoreConfig = Readonly<{
  persistence: PersistenceConfig;
  youtube: YouTubeConfig;
}>;

export function parseCoreConfig(input: unknown = {}): CoreConfig {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Core config must be an object.");
  }

  const persistence = "persistence" in input ? input.persistence : undefined;
  const youtube = "youtube" in input ? input.youtube : undefined;
  return Object.freeze({ persistence: parsePersistenceConfig(persistence), youtube: parseYouTubeConfig(youtube) });
}
