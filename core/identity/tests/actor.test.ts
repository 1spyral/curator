import { expect, test } from "bun:test";
import { actorSchema } from "@curator/core/identity";

test("preserves user IDs, strips unknown fields, and freezes the parsed actor", () => {
  const actor = actorSchema.parse({ userId: " user-1 ", extra: "ignored" });
  expect(actor).toEqual({ userId: " user-1 " });
  expect(Object.isFrozen(actor)).toBe(true);
});

test("requires a nonblank string user ID and has no default actor", () => {
  for (const value of [undefined, null, {}, { userId: 123 }, { userId: "" }, { userId: " \t\n" }]) {
    expect(actorSchema.safeParse(value).success).toBe(false);
  }
});
