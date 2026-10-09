import { z } from "zod";

export const persistenceConfigSchema = z.strictObject({
  databasePath: z.string()
    .refine((value) => value.trim().length > 0, "Database path must not be empty.")
    .default(".data/curator.sqlite"),
}).readonly().prefault({});

export type PersistenceConfig = z.infer<typeof persistenceConfigSchema>;
