import { videoRecommendations, type VideoRecommendationRecord } from "#persistence/schema";
import type { Persistence } from "#persistence/sqlite";
import {
  addRecommendationInputSchema,
  type AddRecommendationInput,
} from "./schemas/recommendations";

export type { AddRecommendationInput } from "./schemas/recommendations";

export function addRecommendation(
  db: Persistence["db"],
  input: AddRecommendationInput,
): VideoRecommendationRecord {
  const values = addRecommendationInputSchema.parse(input);
  return db.insert(videoRecommendations).values(values).returning().get()!;
}
