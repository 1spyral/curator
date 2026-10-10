import { actorSchema } from "@curator/core/identity";
import {
  getMigrationStatus,
  migrateDatabase,
  openDatabase,
  users,
} from "@curator/core/persistence";
import { createYouTubeProvider, type YouTubeProvider } from "@curator/core/youtube";
import { eq } from "drizzle-orm";
import { type CliConfig, CliError } from "./config";

export function openRuntime(config: CliConfig, options: { provider?: YouTubeProvider } = {}) {
  const persistence = openDatabase(config.core.persistence);
  try {
    if (getMigrationStatus(persistence.db).drifted)
      throw new CliError(
        "Database migration history differs from this version; run doctor before proceeding.",
      );
    migrateDatabase(persistence.db);
    const { userId, name } = config.singleUser;
    persistence.db.insert(users).values({ id: userId, name }).onConflictDoNothing().run();
    const user = persistence.db.select().from(users).where(eq(users.id, userId)).get();
    const actor = actorSchema.parse({ userId });
    let provider = options.provider;
    return {
      ...persistence,
      actor,
      userId,
      user,
      dependencies: {
        getYouTubeProvider: () => {
          if (!provider && !config.core.youtube.youtubeDataApi.apiKey)
            throw new CliError(
              "Missing YouTube API key. Edit core.youtube.youtubeDataApi.apiKey in the selected config to load new videos.",
            );
          provider ??= createYouTubeProvider(config.core.youtube);
          return provider;
        },
      },
    };
  } catch (error) {
    persistence.close();
    throw error;
  }
}
