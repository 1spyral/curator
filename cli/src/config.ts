import { randomUUID } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { mcpConfigSchema } from "@curator/mcp/config";
import { z } from "zod";

export class CliError extends Error {}

export const cliConfigSchema = z
  .strictObject({
    version: z.literal(1).default(1),
    mode: z.literal("single-user").default("single-user"),
    ...mcpConfigSchema.unwrap().unwrap().shape,
  })
  .readonly()
  .prefault({});
export type CliConfig = z.infer<typeof cliConfigSchema>;

export function configPath(path?: string) {
  if (path !== undefined && !path.trim()) throw new CliError("Config path must not be blank.");
  return resolve(path ?? join(homedir(), ".curator", "config.json"));
}

export function readConfig(path: string): CliConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new CliError(`Cannot read JSON config at ${path}.`);
  }
  const result = cliConfigSchema.safeParse(raw);
  if (!result.success)
    throw new CliError(
      `Invalid config at ${path}. Check version, mode, identity, and core settings.`,
    );
  const supplied = raw as z.input<typeof cliConfigSchema>;
  const databasePath = supplied?.core?.persistence?.databasePath ?? "curator.sqlite";
  return cliConfigSchema.parse({
    ...result.data,
    core: {
      ...result.data.core,
      persistence: {
        databasePath:
          databasePath === ":memory:" ? databasePath : resolve(dirname(path), databasePath),
      },
    },
  });
}

export function ensureConfig(
  path: string,
  initial: { database?: string; userId?: string; name?: string } = {},
) {
  if (existsSync(path)) {
    if (Object.values(initial).some((value) => value !== undefined))
      throw new CliError("Installation already exists; init will not overwrite its settings.");
    return readConfig(path);
  }
  if (initial.database !== undefined && !initial.database.trim())
    throw new CliError("Database path must not be blank.");
  const config = cliConfigSchema.parse({
    singleUser: { userId: initial.userId, name: initial.name },
    core: {
      persistence: {
        databasePath: initial.database
          ? resolve(initial.database)
          : join(dirname(path), "curator.sqlite"),
      },
    },
  });
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.config-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    try {
      linkSync(temporary, path);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
  } finally {
    rmSync(temporary, { force: true });
  }
  return readConfig(path);
}
