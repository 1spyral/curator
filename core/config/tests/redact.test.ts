import { expect, test } from "bun:test";
import { coreConfigSchema, redactConfig } from "@curator/core/config";
import { z } from "zod";

test("redacts the annotated YouTube key through the composed config schema without mutation", () => {
  const config = coreConfigSchema.parse({ youtube: { youtubeDataApi: { apiKey: "test-secret" } } });
  const result = redactConfig(coreConfigSchema, config);
  expect(result).toEqual({
    ...config,
    youtube: { provider: "youtube-data-api", youtubeDataApi: { apiKey: "[redacted]" } },
  });
  expect(JSON.stringify(result)).not.toContain("test-secret");
  expect(config.youtube.youtubeDataApi.apiKey).toBe("test-secret");
  expect(Object.isFrozen(config.youtube.youtubeDataApi)).toBe(true);
  expect(redactConfig(coreConfigSchema, coreConfigSchema.parse({}))).toEqual(
    coreConfigSchema.parse({}),
  );
});

test("future secret fields and whole sections only need schema metadata", () => {
  const schema = z.strictObject({
    name: z.string(),
    token: z.string().optional().meta({ sensitive: true }),
    credentials: z
      .strictObject({ username: z.string(), password: z.string() })
      .meta({ sensitive: true }),
    enabled: z.boolean(),
    retries: z.number(),
  });
  const input = schema.parse({
    name: "host",
    token: "secret-token",
    credentials: { username: "admin", password: "secret-password" },
    enabled: false,
    retries: 0,
  });
  expect(redactConfig(schema, input)).toEqual({
    name: "host",
    token: "[redacted]",
    credentials: "[redacted]",
    enabled: false,
    retries: 0,
  });
  expect(input.credentials.password).toBe("secret-password");
  expect(redactConfig(schema, { ...input, token: undefined })).toMatchObject({ token: undefined });
});

test("traverses arrays, records and wrappers, preserving missing and null values", () => {
  const secret = z.string().meta({ sensitive: true });
  const schema = z
    .strictObject({
      connections: z.array(z.strictObject({ name: z.string(), token: secret })).readonly(),
      keys: z.record(z.string(), secret),
      nested: z
        .strictObject({
          defaulted: secret.default("secret-default"),
          prefaulted: secret.prefault("secret-prefault"),
          optional: secret.optional(),
          nullable: secret.nullable(),
          fallback: secret.catch("secret-fallback"),
        })
        .readonly()
        .prefault({ nullable: null, fallback: "secret-fallback" }),
    })
    .readonly();
  const input = schema.parse({
    connections: [{ name: "one", token: "secret-one" }],
    keys: { two: "secret-two" },
    nested: { nullable: null },
  });
  expect(redactConfig(schema, input)).toEqual({
    connections: [{ name: "one", token: "[redacted]" }],
    keys: { two: "[redacted]" },
    nested: {
      defaulted: "[redacted]",
      prefaulted: "[redacted]",
      nullable: null,
      fallback: "[redacted]",
    },
  });
  expect(input.connections[0]?.token).toBe("secret-one");
  expect(Object.isFrozen(input.connections)).toBe(true);
});

test("redaction does not rerun transforms or populate omitted defaults", () => {
  let calls = 0;
  const schema = z
    .strictObject({ token: z.string().meta({ sensitive: true }) })
    .transform((value) => {
      calls++;
      return value;
    })
    .readonly()
    .prefault({ token: "secret" });
  const input = schema.parse(undefined);
  expect(calls).toBe(1);
  expect(redactConfig(schema, input)).toEqual({ token: "[redacted]" });
  expect(calls).toBe(1);
  const optional = z.strictObject({ token: z.string().optional().meta({ sensitive: true }) });
  expect(redactConfig(optional, {})).toEqual({});
});

test("explicit output schemas, catchalls and unsupported shapes cannot leak secrets", () => {
  const output = z.strictObject({ token: z.string().meta({ sensitive: true }) });
  const pipeline = z.strictObject({ token: z.string() }).pipe(output);
  expect(redactConfig(pipeline, pipeline.parse({ token: "secret" }))).toEqual({
    token: "[redacted]",
  });
  const catchall = z.object({ name: z.string() }).catchall(z.string().meta({ sensitive: true }));
  expect(redactConfig(catchall, catchall.parse({ name: "visible", extra: "secret" }))).toEqual({
    name: "visible",
    extra: "[redacted]",
  });
  const renamed = z
    .object({ token: z.string().meta({ sensitive: true }) })
    .transform(({ token }) => ({ newToken: token }));
  expect(redactConfig(renamed, renamed.parse({ token: "secret" }))).toEqual({
    newToken: "[redacted]",
  });
  const unsupported = z.union([z.string().meta({ sensitive: true }), z.number()]);
  expect(redactConfig(unsupported, "secret")).toBe("[redacted]");
});
