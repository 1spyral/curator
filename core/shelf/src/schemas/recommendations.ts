import { z } from "zod";

const nonBlankString = z.string().refine((value) => value.trim().length > 0, "Must not be blank.");

export const addRecommendationInputSchema = z.object({
  userId: nonBlankString,
  youtubeId: nonBlankString,
  rationale: nonBlankString,
});

export type AddRecommendationInput = z.infer<typeof addRecommendationInputSchema>;

export const getRecommendationInputSchema = z.object({
  userId: nonBlankString,
  youtubeId: nonBlankString,
  includeVideoMetadata: z.boolean().default(false),
  includeChannelMetadata: z.boolean().default(false),
});

export type GetRecommendationInput = z.input<typeof getRecommendationInputSchema>;

const watchStatusSchema = z.enum(["watched", "unwatched", "both"]);
const sortBySchema = z.literal("recommendedAt");
const sortOrderSchema = z.enum(["asc", "desc"]);

const cursorDataSchema = z.strictObject({
  version: z.literal(1),
  userId: nonBlankString,
  watchStatus: watchStatusSchema,
  sortBy: sortBySchema,
  sortOrder: sortOrderSchema,
  recommendedAt: z.number().int().min(-8_640_000_000_000).max(8_640_000_000_000),
  youtubeId: nonBlankString,
});

export const recommendationCursorSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid recommendation cursor.")
  .transform((encoded, context) => {
    try {
      const bytes = Buffer.from(encoded, "base64url");
      if (bytes.toString("base64url") !== encoded) throw new Error("Invalid encoding.");
      return JSON.parse(bytes.toString("utf8")) as unknown;
    } catch {
      context.addIssue({ code: "custom", message: "Invalid recommendation cursor." });
      return z.NEVER;
    }
  })
  .pipe(cursorDataSchema);

export const getRecommendationsInputSchema = z
  .object({
    userId: nonBlankString,
    includeVideoMetadata: z.boolean().default(false),
    includeChannelMetadata: z.boolean().default(false),
    limit: z.number().int().positive().default(50),
    watchStatus: watchStatusSchema.default("both"),
    sortBy: sortBySchema.default("recommendedAt"),
    sortOrder: sortOrderSchema.default("desc"),
    cursor: z.string().optional(),
  })
  .superRefine((input, context) => {
    if (input.cursor === undefined) return;
    const result = recommendationCursorSchema.safeParse(input.cursor);
    if (!result.success) {
      for (const issue of result.error.issues) {
        context.addIssue({ ...issue, path: ["cursor", ...issue.path] });
      }
      return;
    }
    if (
      (["userId", "watchStatus", "sortBy", "sortOrder"] as const).some(
        (field) => result.data[field] !== input[field],
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["cursor"],
        message: "Cursor does not match the target, watched filter, or sort settings.",
      });
    }
  });

export type GetRecommendationsInput = z.input<typeof getRecommendationsInputSchema>;
