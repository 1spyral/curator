import { videoRecommendations, type VideoRecommendationRecord } from "#persistence/schema";
import type { Persistence } from "#persistence/sqlite";

export type AddRecommendationInput = {
  userId: string;
  youtubeId: string;
  rationale: string;
};

export function addRecommendation(
  db: Persistence["db"],
  input: AddRecommendationInput,
): VideoRecommendationRecord {
  return db.insert(videoRecommendations).values({
    userId: input.userId,
    youtubeId: input.youtubeId,
    rationale: input.rationale,
  }).returning().get()!;
}
