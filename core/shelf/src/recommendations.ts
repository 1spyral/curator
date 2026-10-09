import { type Actor, AuthorizationError, actorSchema } from "#identity";
import { type VideoRecommendationRecord, videoRecommendations } from "#persistence/schema";
import type { Persistence } from "#persistence/sqlite";
import {
  type AddRecommendationInput,
  addRecommendationInputSchema,
} from "./schemas/recommendations";

export type { AddRecommendationInput } from "./schemas/recommendations";

export function addRecommendation(
  db: Persistence["db"],
  actor: Actor,
  input: AddRecommendationInput,
): VideoRecommendationRecord {
  const caller = actorSchema.parse(actor);
  const values = addRecommendationInputSchema.parse(input);
  if (caller.userId !== values.userId) {
    throw new AuthorizationError(
      "The actor is not authorized to add recommendations to this user's shelf.",
    );
  }
  const recommendation = db.insert(videoRecommendations).values(values).returning().get();
  if (!recommendation) throw new Error("Expected the inserted recommendation to be returned.");
  return recommendation;
}
