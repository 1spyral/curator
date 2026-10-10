# MCP host

`@curator/mcp` is a single-user Bun host serving core over stdio, using the
[official MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio).
An MCP client launches it as a local process. All protocol output goes to stdout;
startup and transport diagnostics go to stderr.

Run with defaults:

```sh
bun run mcp
```

The host applies migrations and creates user `local` (name `Local user`) if missing.
It uses `.data/curator.sqlite`. Existing users and shelf data are preserved on
restart; startup does not rename an existing user. Relative database paths resolve
against the repository root, regardless of the client's working directory.

For custom settings, copy `config.example.json` to `config.local.json`, supply your
YouTube API key, and start with:

```sh
bun run mcp --config mcp/config.local.json
```

Config is optional JSON read once by the host. Core receives parsed objects and
reads no environment variables. Unknown config fields are rejected. The YouTube
key is only needed when a creation operation loads a missing video; cached videos
and shelf reads/updates work without it.
Config file paths resolve against the process's working directory.

Example client configuration (replace the paths with absolute paths on your machine):

```json
{
  "mcpServers": {
    "curator": {
      "command": "/absolute/path/to/bun",
      "args": [
        "/absolute/path/to/curator/mcp/src/index.ts",
        "--config",
        "/absolute/path/to/curator/mcp/config.local.json"
      ]
    }
  }
}
```

Omit `--config` and its path to use defaults. This host supports only local stdio;
there is no network listener or login flow. The process serves the configured user,
constructs a trusted actor, and supplies explicit shelf targets from host config.
Tool arguments cannot select another user or supply an actor. Core ownership
checks still run. Catalog loaders operate as trusted host writes without an actor.

## Tools

- `get_context`: the configured local user.
- `create_recommendation`: recommend a video by YouTube ID with a rationale; missing metadata loads automatically.
- `get_recommendation`, `get_recommendations`: individual and paginated retrieval,
  optional video/channel metadata, watched filtering, and recommendation-date sorting.
- `create_watched_video`, `update_watched_video`: watch time, notes, and rating.
- `get_watched_video`, `get_watched_videos`: individual and paginated retrieval,
  optional metadata, and watched/creation-date sorting.

Recommend or mark watched directly by YouTube ID. Core shelf operations load
missing video and channel metadata, and reuse existing catalog records without
refreshing or contacting YouTube. Both creation tools accept `includeVideoMetadata`
and `includeChannelMetadata` (default false) to return stored nested records in
the same response. Loader functions remain available to host code
in core but are not MCP tools. Creation operations reject
duplicates; watched updates return null for missing records. Dates enter as ISO
strings with time zones and leave as UTC ISO strings. `ratingHalfStars` ranges from
1 to 10 (0.5 to 5 stars). Null clears notes or rating on update; omitted fields stay
unchanged. Pagination defaults to 50 items; reuse `nextCursor` with the same filter
and sort options until it returns null.

Results include JSON text and matching `structuredContent`, wrapped as `{ data }`.
Loading failures include the provider error as `{ data: { error } }`. Tool
failures set `isError`; database errors use a generic message and do
not expose raw exceptions or configuration. SDK argument validation runs before
the handler, and core validates the translated operation input as well.

`createMcpHost(config, { provider })` accepts an injected provider for tests.
`close()` closes the server and database; the CLI also cleans up on stdin EOF,
SIGINT, and SIGTERM. The host TypeScript config inherits core's config so its
internal aliases resolve while checking imported core sources. Host code uses
public workspace exports.
