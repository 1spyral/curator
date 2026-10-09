import { z } from "zod";

export const actorSchema = z
  .object({
    userId: z.string().refine((value) => value.trim().length > 0, "Must not be blank."),
  })
  .readonly();

export type Actor = z.infer<typeof actorSchema>;

export class AuthorizationError extends Error {
  constructor(message = "The actor is not authorized to perform this operation.") {
    super(message);
    this.name = "AuthorizationError";
  }
}
