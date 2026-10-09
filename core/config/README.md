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
