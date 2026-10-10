import { coreConfigSchema } from "@curator/core/config";
import { z } from "zod";

export const mcpConfigSchema = z
  .strictObject({
    core: coreConfigSchema,
    singleUser: z
      .strictObject({
        userId: z.string().trim().min(1).default("local"),
        name: z.string().trim().min(1).default("Local user"),
      })
      .readonly()
      .prefault({}),
  })
  .readonly()
  .prefault({});

export type McpConfig = z.infer<typeof mcpConfigSchema>;
