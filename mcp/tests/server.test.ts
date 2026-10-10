import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  migrateDatabase,
  openDatabase,
  users,
  youtubeChannels,
  youtubeVideos,
} from "@curator/core/persistence";
import type { YouTubeProvider } from "@curator/core/youtube";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { mcpConfigSchema } from "../src/config";
import { createMcpHost } from "../src/server";

const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));

test("host config defaults, rejects unknown settings, and closes unconnected databases", async () => {
  const config = mcpConfigSchema.parse({ core: { persistence: { databasePath: ":memory:" } } });
  expect(config.singleUser).toEqual({ userId: "local", name: "Local user" });
  expect(() => mcpConfigSchema.parse({ unexpected: true })).toThrow();
  expect(() => mcpConfigSchema.parse({ singleUser: { userId: " " } })).toThrow();
  const host = createMcpHost(config);
  expect(host.persistence.db.select().from(users).all()).toHaveLength(1);
  await host.close();
  await host.close();
  expect(() => host.persistence.db.select().from(users).all()).toThrow();
});

test("stdio client discovers and operates the local shelf with explicit host targets", async () => {
  const directory = mkdtempSync(join(tmpdir(), "curator-mcp-"));
  const databasePath = join(directory, "catalog.sqlite");
  const configPath = join(directory, "config.json");
  const config = {
    core: { persistence: { databasePath } },
    singleUser: { userId: "owner", name: "Owner" },
  };
  writeFileSync(configPath, JSON.stringify(config));
  const fixture = openDatabase({ databasePath });
  migrateDatabase(fixture.db);
  fixture.db.insert(users).values({ id: "other", name: "Other" }).run();
  fixture.db.insert(youtubeChannels).values({ youtubeId: "channel-1", title: "Channel" }).run();
  fixture.db
    .insert(youtubeVideos)
    .values(
      ["video-1", "video-2"].map((youtubeId) => ({
        youtubeId,
        title: youtubeId,
        channelId: "channel-1",
        durationSeconds: 60,
        publishedAt: new Date("2026-01-01Z"),
        thumbnailUrl: "https://example.com/image.jpg",
      })),
    )
    .run();
  fixture.close();
  const client = new Client({ name: "curator-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry, "--config", configPath],
    cwd: directory,
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(8);
    expect(tools.map((tool) => tool.name)).not.toContain("load_video");
    expect(tools.map((tool) => tool.name)).not.toContain("load_channel");
    for (const tool of tools) expect(tool.inputSchema.properties).not.toHaveProperty("userId");
    const call = (name: string, args: Record<string, unknown> = {}) =>
      client.callTool({ name, arguments: args });
    expect((await call("get_context")).structuredContent).toMatchObject({
      data: { id: "owner", name: "Owner" },
    });
    for (const youtubeId of ["video-1", "video-2"]) {
      const added = await call("create_recommendation", {
        youtubeId,
        rationale: "Interesting",
        userId: "other",
        actor: { userId: "other" },
      });
      expect(added.isError).not.toBe(true);
      expect(added.structuredContent).toMatchObject({ data: { userId: "owner", youtubeId } });
    }
    expect(
      (await call("create_recommendation", { youtubeId: "video-1", rationale: "Duplicate" }))
        .isError,
    ).toBe(true);
    const page = await call("get_recommendations", {
      limit: 1,
      includeVideoMetadata: true,
      includeChannelMetadata: true,
    });
    expect(page.structuredContent).toMatchObject({
      data: {
        items: [
          { userId: "owner", video: { channelId: "channel-1" }, channel: { title: "Channel" } },
        ],
      },
    });
    const data = (page.structuredContent as { data: unknown }).data as {
      nextCursor: string;
      items: { youtubeId: string }[];
    };
    expect(data.nextCursor).toBeString();
    const next = await call("get_recommendations", { limit: 1, cursor: data.nextCursor });
    const nextData = (next.structuredContent as { data: unknown }).data as {
      nextCursor: string | null;
      items: { youtubeId: string }[];
    };
    expect(nextData.nextCursor).toBeNull();
    expect(nextData.items[0]?.youtubeId).not.toBe(data.items[0]?.youtubeId);
    expect(
      (await call("get_recommendation", { youtubeId: "video-1" })).structuredContent,
    ).toMatchObject({ data: { userId: "owner" } });
    expect((await call("get_recommendation", { youtubeId: "missing" })).structuredContent).toEqual({
      data: null,
    });
    expect(
      (
        await call("create_watched_video", {
          youtubeId: "video-1",
          watchedAt: "2026-02-01T12:00:00+02:00",
          notes: "Good",
          ratingHalfStars: 9,
        })
      ).structuredContent,
    ).toMatchObject({
      data: { userId: "owner", watchedAt: "2026-02-01T10:00:00.000Z", ratingHalfStars: 9 },
    });
    expect(
      (
        await call("update_watched_video", {
          youtubeId: "video-1",
          notes: null,
          ratingHalfStars: 10,
        })
      ).structuredContent,
    ).toMatchObject({ data: { notes: null, ratingHalfStars: 10 } });
    expect(
      (await call("get_watched_video", { youtubeId: "video-1", includeChannelMetadata: true }))
        .structuredContent,
    ).toMatchObject({ data: { channel: { title: "Channel" } } });
    expect(
      (await call("get_watched_videos", { sortBy: "createdAt" })).structuredContent,
    ).toMatchObject({ data: { items: [{ youtubeId: "video-1" }], nextCursor: null } });
    expect(
      (await call("get_recommendations", { watchStatus: "unwatched" })).structuredContent,
    ).toMatchObject({ data: { items: [{ youtubeId: "video-2" }] } });
    expect((await call("update_watched_video", { youtubeId: "video-1" })).isError).toBe(true);
    expect((await call("get_recommendations", { cursor: "invalid" })).isError).toBe(true);
    for (const name of ["create_recommendation", "create_watched_video"]) {
      const result = await call(name, { youtubeId: "missing", rationale: "Watch" });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toContain(databasePath);
      expect(JSON.stringify(result)).not.toContain("apiKey");
    }
  } finally {
    await client.close();
    await transport.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("shelf tools automatically load metadata and report provider failures", async () => {
  const provider: YouTubeProvider = {
    getVideo: async (youtubeId) =>
      youtubeId === "missing"
        ? { success: false, error: { code: "not-found", message: "Video not found." } }
        : {
            success: true,
            data: {
              youtubeId,
              title: "Video",
              channelId: "channel-1",
              channelTitle: "Channel",
              durationSeconds: 90,
              publishedAt: new Date("2026-01-01T00:00:00Z"),
              thumbnailUrl: "https://example.com/image.jpg",
            },
          },
    getChannel: async (youtubeId) =>
      youtubeId === "missing"
        ? { success: false, error: { code: "not-found", message: "Channel not found." } }
        : { success: true, data: { youtubeId, title: "Renamed channel" } },
  };
  const host = createMcpHost(
    mcpConfigSchema.parse({ core: { persistence: { databasePath: ":memory:" } } }),
    { provider },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const handle = serveStdio(() => host.server, { transport: serverTransport });
  const client = new Client({ name: "catalog-test", version: "1.0.0" });
  try {
    await client.connect(clientTransport);
    const video = await client.callTool({
      name: "create_recommendation",
      arguments: {
        youtubeId: "video-1",
        rationale: "Watch",
        includeVideoMetadata: true,
        includeChannelMetadata: true,
      },
    });
    expect(video.isError).not.toBe(true);
    expect(video.structuredContent).toMatchObject({
      data: {
        youtubeId: "video-1",
        rationale: "Watch",
        video: { title: "Video", publishedAt: "2026-01-01T00:00:00.000Z" },
        channel: { title: "Channel" },
      },
    });
    const watched = await client.callTool({
      name: "create_watched_video",
      arguments: {
        youtubeId: "video-2",
        ratingHalfStars: 8,
        includeVideoMetadata: true,
        includeChannelMetadata: true,
      },
    });
    expect(watched.isError).not.toBe(true);
    expect(watched.structuredContent).toMatchObject({
      data: {
        youtubeId: "video-2",
        ratingHalfStars: 8,
        video: { title: "Video" },
        channel: { title: "Channel" },
      },
    });
    expect(
      (
        await client.callTool({
          name: "get_recommendation",
          arguments: { youtubeId: "video-1", includeChannelMetadata: true },
        })
      ).structuredContent,
    ).toMatchObject({ data: { channel: { title: "Channel" } } });
    const missing = await client.callTool({
      name: "create_watched_video",
      arguments: { youtubeId: "missing" },
    });
    expect(missing.isError).toBe(true);
    expect(missing.structuredContent).toMatchObject({
      data: { error: { code: "not-found" } },
    });
  } finally {
    await client.close();
    await handle.close();
    await host.close();
  }
});

test("stdio startup creates a fresh database, exits on EOF, and rejects invalid config without leaking it", async () => {
  const directory = mkdtempSync(join(tmpdir(), "curator-mcp-startup-"));
  const databasePath = join(directory, "fresh.sqlite");
  const path = join(directory, "config.json");
  try {
    writeFileSync(path, JSON.stringify({ core: { persistence: { databasePath } } }));
    const child = Bun.spawn([process.execPath, entry, "--config", path], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      cwd: directory,
    });
    child.stdin.end();
    expect(await child.exited).toBe(0);
    expect(await new Response(child.stdout).text()).toBe("");
    const db = openDatabase({ databasePath });
    try {
      expect(db.db.select().from(users).all()).toMatchObject([{ id: "local" }]);
    } finally {
      db.close();
    }
    writeFileSync(path, JSON.stringify({ secret: "do-not-leak" }));
    const invalid = Bun.spawn([process.execPath, entry, "--config", path], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await invalid.exited).toBe(1);
    expect(await new Response(invalid.stdout).text()).toBe("");
    const error = await new Response(invalid.stderr).text();
    expect(error).toContain("MCP startup failed");
    expect(error).not.toContain("do-not-leak");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
