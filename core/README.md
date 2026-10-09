# Core

`@curator/core` contains Curator's application logic and persistence.

- [Config](config/src/index.ts): loads and validates runtime settings once at startup.
- [Persistence](persistence/README.md): SQLite setup, schema, and migrations.

To use core from another workspace, add `"@curator/core": "workspace:*"` to
that workspace's dependencies and run `bun install` from the repository root.
