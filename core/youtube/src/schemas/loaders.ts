import { z } from "zod";

export const loadYouTubeInputSchema = z.object({
  youtubeId: z.string().regex(/^[A-Za-z0-9_-]+$/),
});

export type LoadYouTubeInput = z.infer<typeof loadYouTubeInputSchema>;
