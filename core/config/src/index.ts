import { parsePersistenceConfig, type PersistenceConfig } from "#persistence/config";

export type CoreConfig = Readonly<{
  persistence: PersistenceConfig;
}>;

export function parseCoreConfig(input: unknown = {}): CoreConfig {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Core config must be an object.");
  }

  const persistence = "persistence" in input ? input.persistence : undefined;
  return Object.freeze({ persistence: parsePersistenceConfig(persistence) });
}
