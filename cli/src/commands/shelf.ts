import {
  createRecommendation,
  createWatchedVideo,
  getRecommendation,
  getRecommendations,
  getWatchedVideo,
  getWatchedVideos,
  updateWatchedVideo,
} from "@curator/core/shelf";
import { z } from "zod";
import { CliError, ensureConfig } from "../config";
import { openRuntime } from "../runtime";
import {
  feedbackArgs,
  group,
  leaf,
  listArgs,
  metadataArgs,
  flag as readFlag,
  text as readText,
  type Services,
  selectedPath,
  videoArg,
} from "./shared";

export function shelfCommands(services: Services) {
  const run = async (recommendation: boolean, action: string, values: Record<string, unknown>) => {
    const text = (key: string) => readText(values, key);
    const flag = (key: string) => readFlag(values, key);
    const id = text("video-id");
    // Convert wire inputs before initializing so malformed flags have no setup side effects.
    const includes = {
      includeVideoMetadata: flag("include-video-metadata"),
      includeChannelMetadata: flag("include-channel-metadata"),
    };
    const limit =
      text("limit") === undefined
        ? undefined
        : z
            .number()
            .int()
            .positive()
            .parse(Number(text("limit")));
    const sortOrder =
      text("sort-order") === undefined
        ? undefined
        : z.enum(["asc", "desc"]).parse(text("sort-order"));
    const sortBy =
      text("sort-by") === undefined
        ? undefined
        : (recommendation ? z.literal("recommendedAt") : z.enum(["watchedAt", "createdAt"])).parse(
            text("sort-by"),
          );
    const watchStatus =
      text("watch-status") === undefined
        ? undefined
        : z.enum(["watched", "unwatched", "both"]).parse(text("watch-status"));
    const watchedAt =
      text("watched-at") === undefined
        ? undefined
        : new Date(z.iso.datetime({ offset: true }).parse(text("watched-at")));
    const rating =
      text("rating") === undefined
        ? undefined
        : z
            .number()
            .min(0.5)
            .max(5)
            .refine((value) => Number.isInteger(value * 2))
            .parse(Number(text("rating")));
    if (flag("clear-notes") && text("notes") !== undefined)
      throw new CliError("Use either --notes or --clear-notes.");
    if (flag("clear-rating") && rating !== undefined)
      throw new CliError("Use either --rating or --clear-rating.");
    if (action === "create" && recommendation) z.string().trim().min(1).parse(text("rationale"));
    if (
      action === "update" &&
      watchedAt === undefined &&
      text("notes") === undefined &&
      rating === undefined &&
      !flag("clear-notes") &&
      !flag("clear-rating")
    )
      throw new CliError("Supply at least one watched field to update.");
    if (action !== "list") z.string().trim().min(1).parse(id);
    const runtime = openRuntime(ensureConfig(selectedPath(services)), {
      provider: services.provider,
    });
    try {
      const { db, actor, userId } = runtime;
      const target = { userId, youtubeId: id ?? "" };
      const feedback = {
        watchedAt,
        notes: flag("clear-notes") ? null : text("notes"),
        ratingHalfStars: flag("clear-rating")
          ? null
          : rating === undefined
            ? undefined
            : rating * 2,
      };
      if (action === "create")
        services.emit(
          await (recommendation
            ? createRecommendation(
                db,
                actor,
                { ...target, ...includes, rationale: text("rationale") ?? "" },
                runtime.dependencies,
              )
            : createWatchedVideo(
                db,
                actor,
                { ...target, ...includes, ...feedback },
                runtime.dependencies,
              )),
        );
      else if (action === "update")
        services.emit(updateWatchedVideo(db, actor, { ...target, ...feedback }));
      else if (action === "get")
        services.emit(
          recommendation
            ? getRecommendation(db, actor, { ...target, ...includes })
            : getWatchedVideo(db, actor, { ...target, ...includes }),
        );
      else {
        const shared = { userId, ...includes, limit, cursor: text("cursor"), sortOrder };
        services.emit(
          recommendation
            ? getRecommendations(db, actor, {
                ...shared,
                sortBy: sortBy as "recommendedAt" | undefined,
                watchStatus,
              })
            : getWatchedVideos(db, actor, {
                ...shared,
                sortBy: sortBy as "watchedAt" | "createdAt" | undefined,
              }),
        );
      }
    } finally {
      runtime.close();
    }
  };
  return {
    recommendations: group(
      services,
      "recommendations",
      "Manage recommendations for the local user",
      {
        create: leaf(
          "create",
          "Create a recommendation, loading missing video metadata",
          {
            ...videoArg,
            ...metadataArgs,
            rationale: {
              type: "string",
              required: true,
              description: "Why this video is recommended",
            },
          },
          (args) => run(true, "create", args),
        ),
        get: leaf("get", "Get one recommendation", { ...videoArg, ...metadataArgs }, (args) =>
          run(true, "get", args),
        ),
        list: leaf(
          "list",
          "List recommendations with cursor pagination",
          {
            ...listArgs,
            "sort-by": {
              type: "enum",
              options: ["recommendedAt"],
              description: "Recommendation sort field",
            },
            "watch-status": {
              type: "enum",
              options: ["watched", "unwatched", "both"],
              description: "Watch filter (default both)",
            },
          },
          (args) => run(true, "list", args),
        ),
      },
    ),
    watched: group(services, "watched", "Manage watched videos for the local user", {
      create: leaf(
        "create",
        "Record a watch, loading missing video metadata",
        { ...videoArg, ...metadataArgs, ...feedbackArgs },
        (args) => run(false, "create", args),
      ),
      get: leaf("get", "Get one watched video", { ...videoArg, ...metadataArgs }, (args) =>
        run(false, "get", args),
      ),
      update: leaf(
        "update",
        "Update watch feedback",
        {
          ...videoArg,
          ...feedbackArgs,
          "clear-notes": { type: "boolean", description: "Remove notes" },
          "clear-rating": { type: "boolean", description: "Remove rating" },
        },
        (args) => run(false, "update", args),
      ),
      list: leaf(
        "list",
        "List watched videos with cursor pagination",
        {
          ...listArgs,
          "sort-by": {
            type: "enum",
            options: ["watchedAt", "createdAt"],
            description: "Watch sort field (default watchedAt)",
          },
        },
        (args) => run(false, "list", args),
      ),
    }),
  };
}
