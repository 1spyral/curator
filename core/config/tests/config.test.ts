import { expect, test } from "bun:test";
import { ZodError } from "zod";
import { coreConfigSchema } from "@curator/core/config";
import { persistenceConfigSchema } from "@curator/core/persistence";
import { youtubeConfigSchema } from "@curator/core/youtube";

test("exported schemas apply defaults for omitted and undefined sections", () => {
  const expected = coreConfigSchema.parse({});
  expect(coreConfigSchema.parse(undefined)).toEqual(expected);
  expect(coreConfigSchema.parse({ persistence: undefined, youtube: undefined })).toEqual(expected);
  expect(
    coreConfigSchema.parse({
      persistence: {},
      youtube: { youtubeDataApi: {} },
    }),
  ).toEqual(expected);
  expect(persistenceConfigSchema.parse(undefined)).toEqual(expected.persistence);
  expect(youtubeConfigSchema.parse(undefined)).toEqual(expected.youtube);
  expect(youtubeConfigSchema.parse({ youtubeDataApi: { apiKey: undefined } })).toEqual(
    expected.youtube,
  );
});

test("rejects unknown keys at every config level with their nesting paths", () => {
  for (const [input, path] of [
    [{ extra: true }, []],
    [{ persistence: { databasePaht: "test.sqlite" } }, ["persistence"]],
    [{ youtube: { extra: true } }, ["youtube"]],
    [{ youtube: { youtubeDataApi: { apiKee: "test" } } }, ["youtube", "youtubeDataApi"]],
  ] as const) {
    const result = coreConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(ZodError);
      expect(result.error.issues[0]?.code).toBe("unrecognized_keys");
      expect(result.error.issues[0]?.path).toEqual([...path]);
    }
  }
  expect(() => persistenceConfigSchema.parse({ extra: true })).toThrow(ZodError);
  expect(() => youtubeConfigSchema.parse({ extra: true })).toThrow(ZodError);
});

test("reports nested validation paths without coercing values", () => {
  const result = coreConfigSchema.safeParse({
    youtube: { youtubeDataApi: { apiKey: 123 } },
  });
  expect(result.success).toBe(false);
  if (!result.success)
    expect(result.error.issues[0]?.path).toEqual(["youtube", "youtubeDataApi", "apiKey"]);
  for (const value of [
    null,
    [],
    "path",
    { databasePath: null },
    { databasePath: 12 },
    { databasePath: " " },
  ]) {
    expect(() => persistenceConfigSchema.parse(value)).toThrow(ZodError);
  }
  for (const value of [null, [], "config"])
    expect(() => coreConfigSchema.parse(value)).toThrow(ZodError);
});

test("preserves database path whitespace, trims API keys, and freezes nested output", () => {
  const config = coreConfigSchema.parse({
    persistence: { databasePath: " ./data/my database.sqlite " },
    youtube: { youtubeDataApi: { apiKey: " test-key " } },
  });
  expect(config.persistence.databasePath).toBe(" ./data/my database.sqlite ");
  expect(config.youtube.youtubeDataApi.apiKey).toBe("test-key");
  for (const object of [
    config,
    config.persistence,
    config.youtube,
    config.youtube.youtubeDataApi,
  ]) {
    expect(Object.isFrozen(object)).toBe(true);
  }
});
