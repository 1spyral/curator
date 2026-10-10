import { actorSchema } from "@curator/core/identity";
import { migrateDatabase, openDatabase, users } from "@curator/core/persistence";
import {
  createRecommendation,
  createRecommendationInputSchema,
  createWatchedVideo,
  createWatchedVideoInputSchema,
  getRecommendation,
  getRecommendationInputSchema,
  getRecommendations,
  getRecommendationsInputSchema,
  getWatchedVideo,
  getWatchedVideoInputSchema,
  getWatchedVideos,
  getWatchedVideosInputSchema,
  updateWatchedVideo,
  updateWatchedVideoInputSchema,
  VideoLoadError,
} from "@curator/core/shelf";
import { createYouTubeProvider, type YouTubeProvider } from "@curator/core/youtube";
import { type CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { type McpConfig, mcpConfigSchema } from "./config";

// Dates cross the MCP boundary as ISO strings; core still accepts Date objects.
const watchedAt = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value))
  .optional();

function withoutUserId<T extends z.ZodRawShape>(shape: T) {
  const { userId: _, ...fields } = shape;
  return z.object(fields);
}

function response(value: unknown, isError = false): CallToolResult {
  const text = JSON.stringify({ data: value });
  return {
    content: [{ type: "text", text }],
    structuredContent: JSON.parse(text) as Record<string, unknown>,
    ...(isError ? { isError: true } : {}),
  };
}

async function run(operation: () => unknown | Promise<unknown>): Promise<CallToolResult> {
  try {
    const value = await operation();
    const isError =
      typeof value === "object" && value !== null && "success" in value && value.success === false;
    return response(value, isError);
  } catch (error) {
    if (error instanceof VideoLoadError) return response({ error: error.error }, true);
    // Raw database/provider exceptions can include sensitive configuration.
    return response(
      {
        error: {
          code: error instanceof z.ZodError ? "invalid-input" : "operation-failed",
          message:
            error instanceof z.ZodError
              ? "Invalid operation input."
              : "The operation could not be completed.",
        },
      },
      true,
    );
  }
}

export function createMcpHost(input: McpConfig, options: { provider?: YouTubeProvider } = {}) {
  const config = mcpConfigSchema.parse(input);
  const persistence = openDatabase(config.core.persistence);
  const { db } = persistence;
  try {
    migrateDatabase(db);
    const localUser =
      db
        .insert(users)
        .values({ id: config.singleUser.userId, name: config.singleUser.name })
        .onConflictDoNothing()
        .returning()
        .get() ??
      db.query.users
        .findFirst({ where: (users, { eq }) => eq(users.id, config.singleUser.userId) })
        .sync();
    const actor = actorSchema.parse({ userId: config.singleUser.userId });
    // Explicit target comes from host config, independently of actor identity.
    const userId = config.singleUser.userId;
    let provider = options.provider;
    const getProvider = () => (provider ??= createYouTubeProvider(config.core.youtube));
    const server = new McpServer({ name: "curator", version: "0.0.0" });
    const read = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
    const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
    const creation = { ...write, openWorldHint: true };
    const dependencies = { getYouTubeProvider: getProvider };

    server.registerTool(
      "get_context",
      {
        description: "Get the local user served by this single-user host.",
        inputSchema: z.object({}),
        annotations: read,
      },
      () => run(() => localUser),
    );
    server.registerTool(
      "create_recommendation",
      {
        description:
          "Recommend a video by YouTube ID to the local user with a rationale. Missing video and channel metadata loads automatically; duplicates fail. Metadata flags optionally return the associated video and channel.",
        inputSchema: withoutUserId(createRecommendationInputSchema.shape),
        annotations: creation,
      },
      (input) => run(() => createRecommendation(db, actor, { ...input, userId }, dependencies)),
    );
    server.registerTool(
      "get_recommendation",
      {
        description:
          "Get a local recommendation, optionally including video and channel metadata. Returns null if missing.",
        inputSchema: withoutUserId(getRecommendationInputSchema.shape),
        annotations: read,
      },
      (input) => run(() => getRecommendation(db, actor, { ...input, userId })),
    );
    server.registerTool(
      "get_recommendations",
      {
        description:
          "List local recommendations with watched filtering, metadata options, recommendation-date sorting, and cursor pagination.",
        inputSchema: withoutUserId(getRecommendationsInputSchema.shape),
        annotations: read,
      },
      (input) => run(() => getRecommendations(db, actor, { ...input, userId })),
    );
    server.registerTool(
      "create_watched_video",
      {
        description:
          "Mark a video watched by YouTube ID for the local user. Missing metadata loads automatically. Optional ISO watchedAt, notes, and ratingHalfStars (1–10, representing 0.5–5 stars). Duplicate records fail. Metadata flags optionally return the associated video and channel.",
        inputSchema: withoutUserId({ ...createWatchedVideoInputSchema.shape, watchedAt }),
        annotations: creation,
      },
      (input) => run(() => createWatchedVideo(db, actor, { ...input, userId }, dependencies)),
    );
    server.registerTool(
      "update_watched_video",
      {
        description:
          "Update watchedAt, notes, or ratingHalfStars for a local watched record. Supply at least one field; null clears notes or rating. Returns null if missing.",
        inputSchema: withoutUserId({ ...updateWatchedVideoInputSchema.shape, watchedAt }),
        annotations: write,
      },
      (input) => run(() => updateWatchedVideo(db, actor, { ...input, userId })),
    );
    server.registerTool(
      "get_watched_video",
      {
        description:
          "Get a local watched record, optionally including video and channel metadata. Returns null if missing.",
        inputSchema: withoutUserId(getWatchedVideoInputSchema.shape),
        annotations: read,
      },
      (input) => run(() => getWatchedVideo(db, actor, { ...input, userId })),
    );
    server.registerTool(
      "get_watched_videos",
      {
        description:
          "List local watched videos with metadata options, watchedAt or createdAt sorting, and cursor pagination.",
        inputSchema: withoutUserId(getWatchedVideosInputSchema.shape),
        annotations: read,
      },
      (input) => run(() => getWatchedVideos(db, actor, { ...input, userId })),
    );

    let closed = false;
    const closePersistence = () => {
      if (closed) return;
      closed = true;
      persistence.close();
    };
    server.server.onclose = closePersistence;
    return {
      server,
      persistence,
      close: async () => {
        try {
          await server.close();
        } finally {
          closePersistence();
        }
      },
    };
  } catch (error) {
    persistence.close();
    throw error;
  }
}
