import { z } from "zod";

const nonBlankString = z.string().refine((value) => value.trim().length > 0, "Must not be blank.");

export const addRecommendationInputSchema = z.object({
  userId: nonBlankString,
  youtubeId: nonBlankString,
  rationale: nonBlankString,
});

export type AddRecommendationInput = z.infer<typeof addRecommendationInputSchema>;
