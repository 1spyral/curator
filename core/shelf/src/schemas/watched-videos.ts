import { z } from "zod";

const nonBlankString = z.string().refine((value) => value.trim().length > 0, "Must not be blank.");
const targetFields = { userId: nonBlankString, youtubeId: nonBlankString };
const metadataFields = {
  includeVideoMetadata: z.boolean().default(false),
  includeChannelMetadata: z.boolean().default(false),
};
const sortBySchema = z.enum(["watchedAt", "createdAt"]);
const sortOrderSchema = z.enum(["asc", "desc"]);

export const createWatchedVideoInputSchema = z.object({
  ...targetFields,
  watchedAt: z.date().optional(),
  notes: z.string().nullable().optional(),
  ratingHalfStars: z.number().int().min(1).max(10).nullable().optional(),
});

export const updateWatchedVideoInputSchema = createWatchedVideoInputSchema.refine(
  ({ watchedAt, notes, ratingHalfStars }) =>
    watchedAt !== undefined || notes !== undefined || ratingHalfStars !== undefined,
  "At least one editable field must be supplied.",
);

export const getWatchedVideoInputSchema = z.object({ ...targetFields, ...metadataFields });

const cursorDataSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("watched-videos"),
  userId: nonBlankString,
  sortBy: sortBySchema,
  sortOrder: sortOrderSchema,
  sortValue: z.number().int().min(-8_640_000_000_000).max(8_640_000_000_000),
  youtubeId: nonBlankString,
});

export const watchedVideosCursorSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid watched videos cursor.")
  .transform((encoded, context) => {
    try {
      const bytes = Buffer.from(encoded, "base64url");
      if (bytes.toString("base64url") !== encoded) throw new Error("Invalid encoding.");
      return JSON.parse(bytes.toString("utf8")) as unknown;
    } catch {
      context.addIssue({ code: "custom", message: "Invalid watched videos cursor." });
      return z.NEVER;
    }
  })
  .pipe(cursorDataSchema);

export const getWatchedVideosInputSchema = z
  .object({
    userId: nonBlankString,
    ...metadataFields,
    limit: z.number().int().positive().default(50),
    sortBy: sortBySchema.default("watchedAt"),
    sortOrder: sortOrderSchema.default("desc"),
    cursor: z.string().optional(),
  })
  .superRefine((input, context) => {
    if (input.cursor === undefined) return;
    const result = watchedVideosCursorSchema.safeParse(input.cursor);
    if (!result.success) {
      for (const issue of result.error.issues) {
        context.addIssue({ ...issue, path: ["cursor", ...issue.path] });
      }
      return;
    }
    if (
      (["userId", "sortBy", "sortOrder"] as const).some(
        (field) => result.data[field] !== input[field],
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["cursor"],
        message: "Cursor does not match the target or sort settings.",
      });
    }
  });

export type CreateWatchedVideoInput = z.input<typeof createWatchedVideoInputSchema>;
export type UpdateWatchedVideoInput = z.input<typeof updateWatchedVideoInputSchema>;
export type GetWatchedVideoInput = z.input<typeof getWatchedVideoInputSchema>;
export type GetWatchedVideosInput = z.input<typeof getWatchedVideosInputSchema>;
