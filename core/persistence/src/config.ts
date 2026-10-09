export type PersistenceConfig = Readonly<{
  databasePath: string;
}>;

export function parsePersistenceConfig(input: unknown = {}): PersistenceConfig {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Persistence config must be an object.");
  }

  const value = "databasePath" in input ? input.databasePath : undefined;
  const databasePath = value === undefined ? ".data/curator.sqlite" : value;

  if (typeof databasePath !== "string" || databasePath.trim().length === 0) {
    throw new Error("persistence.databasePath must be a non-empty string.");
  }

  return Object.freeze({ databasePath });
}
