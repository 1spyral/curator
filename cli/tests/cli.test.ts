import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase, users } from "@curator/core/persistence";
import type { YouTubeProvider } from "@curator/core/youtube";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { runCli } from "../src/commands";
import { configPath, readConfig } from "../src/config";
import { doctor } from "../src/doctor";

let directory: string;
let path: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "curator-cli-"));
  path = join(directory, "config.json");
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function provider() {
  return {
    getVideo: mock<YouTubeProvider["getVideo"]>(async (youtubeId) =>
      youtubeId === "missing"
        ? { success: false, error: { code: "not-found", message: "No video" } }
        : {
            success: true,
            data: {
              youtubeId,
              title: "Video",
              channelId: "channel",
              channelTitle: "Channel",
              durationSeconds: 61,
              publishedAt: new Date("2026-01-01T00:00:00Z"),
              thumbnailUrl: "https://example.com/image.jpg",
            },
          },
    ),
    getChannel: mock<YouTubeProvider["getChannel"]>(async () => {
      throw new Error("Unused");
    }),
  };
}

async function command(args: string[], youtube?: YouTubeProvider) {
  const output: string[] = [];
  const errors: string[] = [];
  const exit = await runCli(
    ["--config", path, "--json", ...args],
    { stdout: (s) => output.push(s), stderr: (s) => errors.push(s) },
    { provider: youtube },
  );
  return {
    exit,
    output,
    errors,
    data: output.length ? (JSON.parse(output[0] ?? "{}") as { data: unknown }).data : undefined,
  };
}

test("ordinary commands persist default identity, private config, and a database beside the file", async () => {
  expect((await command(["recommendations", "list"])).exit).toBe(0);
  expect(readConfig(path)).toMatchObject({
    version: 1,
    mode: "single-user",
    singleUser: { userId: "local", name: "Local user" },
    core: { persistence: { databasePath: join(directory, "curator.sqlite") } },
  });
  if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
  const original = readFileSync(path, "utf8");
  expect((await command(["init"])).exit).toBe(0);
  expect(readFileSync(path, "utf8")).toBe(original);
  expect((await command(["init", "--user-id", "different"])).exit).toBe(1);
  expect(readFileSync(path, "utf8")).toBe(original);
});

test("init adopts an existing database and user without renaming or replacing records", async () => {
  const databasePath = join(directory, "existing.sqlite");
  const first = join(directory, "first.json");
  const originalPath = path;
  path = first;
  expect(
    (
      await command([
        "init",
        "--database",
        databasePath,
        "--user-id",
        "existing",
        "--name",
        "Original",
      ])
    ).exit,
  ).toBe(0);
  const youtube = provider();
  expect(
    (await command(["recommendations", "create", "video-1", "--rationale", "Keep"], youtube)).exit,
  ).toBe(0);
  path = originalPath;
  expect(
    (
      await command([
        "init",
        "--database",
        databasePath,
        "--user-id",
        "existing",
        "--name",
        "New name",
      ])
    ).data,
  ).toMatchObject({ user: { id: "existing", name: "Original" } });
  expect((await command(["recommendations", "list"])).data).toMatchObject({
    items: [{ rationale: "Keep", userId: "existing" }],
  });
});

test("shelf commands load metadata, paginate, translate dates and ratings, and clear feedback", async () => {
  const youtube = provider();
  for (const id of ["video-1", "video-2"]) {
    expect(
      (
        await command(
          [
            "recommendations",
            "create",
            id,
            "--rationale",
            "Useful",
            "--include-video-metadata",
            "--include-channel-metadata",
          ],
          youtube,
        )
      ).data,
    ).toMatchObject({ userId: "local", video: { title: "Video" }, channel: { title: "Channel" } });
  }
  const first = (await command(["recommendations", "list", "--limit", "1"])).data as {
    nextCursor: string;
    items: { youtubeId: string }[];
  };
  const next = (
    await command(["recommendations", "list", "--limit", "1", "--cursor", first.nextCursor])
  ).data as typeof first;
  expect(next.nextCursor).toBeNull();
  expect(next.items[0]?.youtubeId).not.toBe(first.items[0]?.youtubeId);
  expect(
    (await command(["recommendations", "get", "video-1", "--include-channel-metadata"])).data,
  ).toMatchObject({ channel: { title: "Channel" } });
  expect(
    (
      await command([
        "watched",
        "create",
        "video-1",
        "--watched-at",
        "2026-03-01T12:00:00+02:00",
        "--notes",
        "Good",
        "--rating",
        "4.5",
        "--include-video-metadata",
      ])
    ).data,
  ).toMatchObject({
    watchedAt: "2026-03-01T10:00:00.000Z",
    notes: "Good",
    ratingHalfStars: 9,
    video: { title: "Video" },
  });
  expect(
    (await command(["watched", "update", "video-1", "--clear-notes", "--clear-rating"])).data,
  ).toMatchObject({ notes: null, ratingHalfStars: null });
  expect((await command(["watched", "get", "video-1"])).data).toMatchObject({ userId: "local" });
  expect(
    (await command(["watched", "list", "--sort-by", "createdAt", "--sort-order", "asc"])).data,
  ).toMatchObject({ items: [{ youtubeId: "video-1" }] });
  expect(
    (await command(["recommendations", "list", "--watch-status", "unwatched"])).data,
  ).toMatchObject({ items: [{ youtubeId: "video-2" }] });
  expect(youtube.getVideo).toHaveBeenCalledTimes(2);
});

test("invalid flags and inputs do not initialize and loading failures are actionable", async () => {
  for (const args of [
    ["watched", "create", "video", "--rating", "4.2"],
    ["watched", "update", "video"],
    ["watched", "update", "video", "--notes", "x", "--clear-notes"],
    ["recommendations", "list", "--limit", "0"],
    ["recommendations", "create", "video"],
    ["recommendations", "list", "--user-id", "other"],
  ]) {
    expect((await command(args)).exit).toBe(1);
    expect(existsSync(path)).toBe(false);
  }
  expect(
    (await command(["recommendations", "create", "video", "--rationale", "Watch"])).data,
  ).toMatchObject({ error: { message: expect.stringContaining("Missing YouTube API key") } });
  expect((await command(["watched", "create", "missing"], provider())).data).toMatchObject({
    error: { code: "not-found" },
  });
});

test("config show redacts credentials and invalid existing config is never overwritten", async () => {
  await command(["init"]);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  raw.core.youtube.youtubeDataApi = { apiKey: "secret-key" };
  writeFileSync(path, JSON.stringify(raw));
  const shown = await command(["config", "show"]);
  expect(shown.output.join()).not.toContain("secret-key");
  expect(shown.data).toMatchObject({
    core: { youtube: { youtubeDataApi: { apiKey: "[redacted]" } } },
  });
  writeFileSync(path, '{"secret":"do-not-print","mode":"multi-user"}');
  const before = readFileSync(path, "utf8");
  const result = await command(["recommendations", "list"]);
  expect(result.exit).toBe(1);
  expect(result.output.join()).not.toContain("do-not-print");
  expect(readFileSync(path, "utf8")).toBe(before);
});

test("doctor is read-only, reports missing setup, healthy data and missing users", async () => {
  expect((await command(["doctor"])).exit).toBe(1);
  expect(existsSync(path)).toBe(false);
  await command(["init"]);
  const dbPath = readConfig(path).core.persistence.databasePath;
  const configBefore = readFileSync(path);
  const dbBefore = readFileSync(dbPath);
  const report = await doctor(path);
  expect(report.status).toBe("warning");
  expect(report.checks.find((c) => c.name === "migrations")?.status).toBe("ok");
  expect(readFileSync(path)).toEqual(configBefore);
  expect(readFileSync(dbPath)).toEqual(dbBefore);
  const db = openDatabase({ databasePath: dbPath });
  db.db.delete(users).run();
  db.close();
  expect((await doctor(path)).checks.find((c) => c.name === "user")?.status).toBe("error");
});

test("doctor detects pending and drifted migrations without repairing them", async () => {
  await command(["init"]);
  const dbPath = readConfig(path).core.persistence.databasePath;
  const db = openDatabase({ databasePath: dbPath });
  db.db.$client.exec(
    "DELETE FROM __drizzle_migrations WHERE created_at = (SELECT MAX(created_at) FROM __drizzle_migrations)",
  );
  db.close();
  expect((await doctor(path)).checks.find((c) => c.name === "migrations")).toMatchObject({
    status: "error",
    message: expect.stringContaining("1 pending"),
  });
  const altered = openDatabase({ databasePath: dbPath });
  altered.db.$client.exec("UPDATE __drizzle_migrations SET hash = 'changed'");
  altered.close();
  expect((await doctor(path)).checks.find((c) => c.name === "migrations")).toMatchObject({
    status: "error",
    message: expect.stringContaining("differs"),
  });
});

test("MCP doctor tests an isolated installation and cleans up a timed-out process", async () => {
  await command(["init"]);
  const before = readFileSync(path);
  expect(
    (await doctor(path, true, { temporaryRoot: directory })).checks.find(
      (c) => c.name === "mcp-self-test",
    )?.status,
  ).toBe("ok");
  expect(readFileSync(path)).toEqual(before);
  const hanging = join(directory, "hang.ts");
  writeFileSync(hanging, "setInterval(() => {}, 1000); process.stdin.resume();");
  const started = Date.now();
  expect(
    (
      await doctor(path, true, { mcpEntry: hanging, timeoutMs: 50, temporaryRoot: directory })
    ).checks.find((c) => c.name === "mcp-self-test")?.status,
  ).toBe("error");
  expect(Date.now() - started).toBeLessThan(5000);
  const { readdirSync } = await import("node:fs");
  expect(readdirSync(directory).some((name) => name.startsWith("curator-mcp-doctor-"))).toBe(false);
});

test("read-only opening never creates databases or permits writes", async () => {
  const missing = join(directory, "missing", "db.sqlite");
  expect(() => openDatabase({ databasePath: missing }, { readOnly: true })).toThrow();
  expect(existsSync(join(directory, "missing"))).toBe(false);
  await command(["init"]);
  const db = openDatabase(readConfig(path).core.persistence, { readOnly: true });
  try {
    expect(() => db.db.insert(users).values({ id: "blocked", name: "Blocked" }).run()).toThrow();
  } finally {
    db.close();
  }
});

test("default config location is in the user directory and relative databases follow config files", async () => {
  expect(configPath()).toBe(join(homedir(), ".curator", "config.json"));
  writeFileSync(
    path,
    JSON.stringify({
      singleUser: { userId: "owner" },
      core: { persistence: { databasePath: "nested/db.sqlite" } },
    }),
  );
  expect((await command(["recommendations", "list"])).exit).toBe(0);
  expect(readConfig(path).core.persistence.databasePath).toBe(join(directory, "nested/db.sqlite"));
  expect(existsSync(join(directory, "nested/db.sqlite"))).toBe(true);
});

test("explicit migration initializes an empty database and doctor reports missing files without creating them", async () => {
  writeFileSync(path, JSON.stringify({ core: { persistence: { databasePath: "new/db.sqlite" } } }));
  expect((await doctor(path)).checks.find((c) => c.name === "database")?.status).toBe("error");
  expect(existsSync(join(directory, "new"))).toBe(false);
  expect((await command(["db", "migrate"])).exit).toBe(0);
  expect((await doctor(path)).checks.find((c) => c.name === "migrations")?.status).toBe("ok");
});

test("CLI-launched MCP uses persisted settings, while standalone MCP uses its independent config", async () => {
  await command(["init", "--user-id", "cli-owner", "--name", "CLI owner"]);
  const cliEntry = fileURLToPath(new URL("../src/index.ts", import.meta.url));
  const mcpEntry = fileURLToPath(new URL("../../mcp/src/index.ts", import.meta.url));
  const standalone = join(directory, "mcp.json");
  writeFileSync(
    standalone,
    JSON.stringify({
      singleUser: { userId: "standalone-owner", name: "Standalone" },
      core: { persistence: { databasePath: join(directory, "standalone.sqlite") } },
    }),
  );
  for (const [entry, args, id] of [
    [cliEntry, ["--config", path, "mcp"], "cli-owner"],
    [mcpEntry, ["--config", standalone], "standalone-owner"],
  ] as const) {
    const client = new Client({ name: "cli-test", version: "0.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entry, ...args],
      cwd: directory,
      stderr: "pipe",
    });
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools).toHaveLength(8);
      expect(
        (await client.callTool({ name: "get_context", arguments: {} })).structuredContent,
      ).toMatchObject({ data: { id } });
    } finally {
      await client.close();
      await transport.close();
    }
  }
  expect(readConfig(path).singleUser.userId).toBe("cli-owner");
  const forbidden = await command(["mcp"]);
  expect(forbidden.exit).toBe(1);
  expect(forbidden.data).toMatchObject({ error: { message: expect.stringContaining("--json") } });
});

test("MCP launched through CLI alone initializes missing setup without any non-protocol stdout", async () => {
  const client = new Client({ name: "bootstrap-test", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../src/index.ts", import.meta.url)), "--config", path, "mcp"],
    cwd: directory,
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    expect(
      (await client.callTool({ name: "get_context", arguments: {} })).structuredContent,
    ).toMatchObject({ data: { id: "local" } });
    expect(readConfig(path).singleUser.userId).toBe("local");
  } finally {
    await client.close();
    await transport.close();
  }
});
