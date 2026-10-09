import { z } from "zod";

const youtubeDataApiConfigSchema = z
  .strictObject({
    apiKey: z.string().trim().min(1, "API key must not be empty.").optional(),
  })
  .transform(({ apiKey }) => (apiKey === undefined ? {} : { apiKey }))
  .readonly()
  .prefault({});

export const youtubeConfigSchema = z
  .strictObject({
    provider: z.literal("youtube-data-api").default("youtube-data-api"),
    youtubeDataApi: youtubeDataApiConfigSchema,
  })
  .readonly()
  .prefault({});

export type YouTubeConfig = z.infer<typeof youtubeConfigSchema>;
