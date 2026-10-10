# Config

Each core module owns its Zod config schema. `coreConfigSchema` composes the
persistence and YouTube schemas. Call `coreConfigSchema.parse(input)` to validate
an object and apply defaults. `CoreConfig` is inferred from the composed schema.

Hosts supply objects. Missing or undefined settings receive defaults, and
parsed config objects are frozen, including nested module settings. No files
or environment variables are read here.

```ts
import { coreConfigSchema } from "@curator/core/config";

const config = coreConfigSchema.parse({
  persistence: { databasePath: "./data/curator.sqlite" },
  youtube: { youtubeDataApi: { apiKey: "your-api-key" } },
});
```

All config objects reject unknown fields. Invalid inputs throw `ZodError`;
`error.issues` contains paths such as `youtube.youtubeDataApi.apiKey`. Use
`coreConfigSchema.safeParse(input)` when a result object is preferred to an
exception. Do not log full configuration objects containing credentials.

The default database path is `.data/curator.sqlite`. YouTube defaults to the
Data API provider; a missing API key is allowed until provider creation.

## Displaying config

Mark secret fields in their owning schemas with `.meta({ sensitive: true })`,
after other modifiers. Hosts can call `redactConfig(schema, parsedConfig)` from
`@curator/core/config` to produce a display-only copy with present secrets replaced
by `"[redacted]"`. Missing fields and null values remain unchanged. The original
config is never mutated and parsing, defaults, and transforms are not rerun.

The helper traverses objects, arrays, records, config wrappers, and shape-preserving
transforms. Explicit pipe output schemas may also annotate secrets. Unknown fields
and unsupported schema shapes are masked. Shape-changing transforms can therefore mask otherwise public fields as well.
The returned value is `unknown`: redacted fields may no longer match their original
types. Never use the display copy as runtime config or write it back to disk.
