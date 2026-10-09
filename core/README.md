# Core

`@curator/core` contains Curator's application logic and persistence.

- [Config](config/src/index.ts): composes module config parsers; the host supplies settings at startup.
- [Persistence](persistence/README.md): SQLite setup, schema, and migrations.
- [Shelf](shelf/README.md): recommendation operations.

To use core from another workspace, add `"@curator/core": "workspace:*"` to
that workspace's dependencies and run `bun install` from the repository root.
