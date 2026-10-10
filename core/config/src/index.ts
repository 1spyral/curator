import { z } from "zod";
import { persistenceConfigSchema } from "#persistence/config";
import { youtubeConfigSchema } from "#youtube/config";

export const coreConfigSchema = z
  .strictObject({
    persistence: persistenceConfigSchema,
    youtube: youtubeConfigSchema,
  })
  .readonly()
  .prefault({});

export type CoreConfig = z.infer<typeof coreConfigSchema>;

export { redactConfig } from "./redact";
