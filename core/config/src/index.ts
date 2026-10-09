import type { PersistenceConfig } from "#persistence/config";

export type CoreConfig = Readonly<{
  persistence: PersistenceConfig;
}>;

export type ConfigEnvironment = Readonly<Record<string, string | undefined>>;

export function loadCoreConfig(
  env: ConfigEnvironment = process.env,
): CoreConfig {
  const databasePath = env.CURATOR_DATABASE_PATH ?? ".data/curator.sqlite";

  if (databasePath.trim().length === 0) {
    throw new Error("CURATOR_DATABASE_PATH must not be empty.");
  }

  return Object.freeze({ persistence: Object.freeze({ databasePath }) });
}
