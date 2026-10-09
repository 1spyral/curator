import { z } from "zod";

export const nonEmptyTextSchema = z.string().refine((value) => value.trim().length > 0);
export const httpUrlSchema = z.url({ protocol: /^https?$/ });

export const videoMetadataSchema = z.object({
  youtubeId: nonEmptyTextSchema,
  title: nonEmptyTextSchema,
  channelId: nonEmptyTextSchema,
  durationSeconds: z.number().int().nonnegative(),
  publishedAt: z.date(),
  thumbnailUrl: httpUrlSchema,
});

export const channelMetadataSchema = z.object({
  youtubeId: nonEmptyTextSchema,
  title: nonEmptyTextSchema,
});
