import { z } from "zod";
import { httpUrlSchema, nonEmptyTextSchema } from "../../schemas/metadata";

export const youtubeIdSchema = z.string().regex(/^[A-Za-z0-9_-]+$/);
export const itemListSchema = z.object({ items: z.array(z.unknown()) });
export const itemIdentitySchema = z.looseObject({ id: z.string() });
export const thumbnailSchema = z.object({ url: httpUrlSchema });

export const videoItemSchema = z.object({
  id: z.string(),
  snippet: z.object({
    title: nonEmptyTextSchema,
    channelId: nonEmptyTextSchema,
    publishedAt: z
      .string()
      .refine(
        (value) => /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(new Date(value).getTime()),
      )
      .transform((value) => new Date(value)),
    thumbnails: z.record(z.string(), z.unknown()),
  }),
  contentDetails: z.object({ duration: z.string() }),
});

export const channelItemSchema = z.object({
  id: z.string(),
  snippet: z.object({ title: nonEmptyTextSchema }),
});

// Preserve the first error's position even if its contents are malformed.
export const apiErrorSchema = z.object({
  error: z.object({ errors: z.array(z.unknown()) }),
});
export const apiErrorReasonSchema = z.object({
  reason: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,99}$/),
});
