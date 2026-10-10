# CLI

`@curator/cli` manages a local installation, operates its shelf, diagnoses setup,
and launches MCP with its persistent settings. Run it from the repository:

```sh
bun run cli --help
bun run cli recommendations list
bun run cli doctor
bun run cli doctor mcp
bun run cli mcp
```

Commands and help are defined with [citty](https://github.com/unjs/citty).
Use `--help` or `-h` on any command, or `help <command>` (for example,
`bun run cli help recommendations create`). Bare command groups show their help.
`--version` or `-v` shows the CLI package version. Global `--config` and `--json`
options may appear before, between, or after command names.

The package also provides a `curator` executable entrypoint for installations
that link or install the CLI package. Examples below use `bun run cli`.

## Persistent setup

Ordinary shelf commands, `init`, `db migrate`, and `mcp` initialize missing setup.
The default config is `~/.curator/config.json`, with `curator.sqlite` beside it.
Config records version 1, `mode: "single-user"`, and a stable user ID `local` with
name `Local user`. New config files are created atomically with private permissions.
Repeated startup preserves the config and existing users, names, and shelf records.

`--config PATH` selects a separate installation. Relative database paths in JSON
resolve against the config's directory. Paths passed to `init --database` resolve
against the current working directory and are saved as absolute paths.

```sh
bun run cli --config /path/to/installation/config.json init
bun run cli config path
bun run cli config show
bun run cli db migrate
```

`config path`, `config show`, help, and doctor do not initialize missing setup.
`config show` redacts API keys. Edit the selected JSON file to configure
`core.youtube.youtubeDataApi.apiKey`; [config.example.json](config.example.json)
shows the structure. Core receives parsed config objects and does not read files
or environment variables. Invalid existing config is never overwritten. Unsupported
versions and modes are rejected.

To adopt the repository's existing database, point a **new** CLI config at that
file and specify its existing user ID:

```sh
bun run cli --config /path/to/new/config.json init \
  --database /absolute/path/to/curator/.data/curator.sqlite \
  --user-id local --name "Local user"
```

Initialization creates the configured user only if absent; it does not rename an
existing user. `init` without customization is repeatable. Customization flags
cannot overwrite an existing installation. CLI defaults do not automatically
adopt the repository's `.data` database.

Multi-user conversion and authentication are deferred. The explicit mode and
stable identity prepare for a future conversion that preserves ownership and
records. This CLI currently serves only its configured user; shelf commands do
not accept actor or target-user arguments.

## Shelf commands

```sh
bun run cli recommendations create dQw4w9WgXcQ --rationale "Worth exploring" \
  --include-video-metadata --include-channel-metadata
bun run cli recommendations get dQw4w9WgXcQ --include-video-metadata
bun run cli recommendations list --watch-status unwatched --limit 20 --sort-order desc

bun run cli watched create dQw4w9WgXcQ --notes "Useful examples" --rating 4.5 \
  --watched-at 2026-03-01T12:00:00Z --include-channel-metadata
bun run cli watched update dQw4w9WgXcQ --rating 5 --clear-notes
bun run cli watched get dQw4w9WgXcQ
bun run cli watched list --sort-by createdAt --sort-order asc
```

Creation automatically loads missing videos and channels through core shelf
operations. Cached videos, reads, and updates do not need an API key. Duplicate
creation fails; missing individual reads or updates return null. Watched updates
require at least one editable field.

Creation, individual retrieval, and listing accept `--include-video-metadata`
and `--include-channel-metadata`, defaulting to false. Lists accept `--limit`,
`--cursor`, `--sort-order asc|desc`, and `--sort-by`. Recommendation sorting supports
`recommendedAt`; watched sorting supports `watchedAt|createdAt`. Recommendation
lists also accept `--watch-status watched|unwatched|both`. Defaults match core:
50 items, descending order, recommendations sorted by recommendation time and
watched records by watch time.

Pass the returned `nextCursor` unchanged with the same filters and sorting to
continue pagination. Metadata flags and page size may change.

`--rating` accepts 0.5–5 stars in 0.5 increments, translating to core's
`ratingHalfStars` (1–10). `--watched-at` accepts ISO timestamps with a time zone;
returned dates use UTC ISO strings. Updates accept `--clear-notes` and
`--clear-rating`; each is mutually exclusive with its corresponding value flag.
An empty `--notes ""` is valid.

Ordinary results are pretty-printed JSON. `--json` emits compact `{ data }` JSON,
including structured failures. Commands exit 0 on success and 1 on error.
Credentials and raw database/provider exceptions are not printed.

## Doctor and MCP

`doctor` reports config validity, database availability, SQLite integrity,
foreign-key violations, migration status, configured-user existence, and whether
a YouTube key is configured. It opens databases read-only, does not create missing
files or apply migrations, and makes no YouTube requests. Missing credentials are
a warning; errors exit 1, while warnings alone exit 0.

`doctor mcp` adds an isolated protocol self-test: a temporary installation starts
MCP, exposes the expected eight tools, and answers `get_context`. It uses no real
installation data or credentials. Its 15-second protocol deadline and process/file
cleanup also apply on failure. This verifies local MCP startup and protocol wiring,
not a running remote server or the real installation's write operations.

CLI-launched MCP uses this CLI config. Configure an MCP client with:

```json
{
  "mcpServers": {
    "curator": {
      "command": "/absolute/path/to/bun",
      "args": [
        "/absolute/path/to/curator/cli/src/index.ts",
        "--config", "/absolute/path/to/installation/config.json",
        "mcp"
      ]
    }
  }
}
```

Omit `--config` and its path to use the CLI's user-directory installation. MCP
stdout contains protocol messages only; `--json` is rejected for this command.
Standalone `bun run mcp` still uses the independent [MCP host](../mcp/README.md)
config and repository database defaults. Do not pass the versioned CLI config
file directly to the standalone MCP entrypoint.
