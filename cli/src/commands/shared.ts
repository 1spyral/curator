import type { YouTubeProvider } from "@curator/core/youtube";
import { type ArgsDef, type CommandDef, defineCommand, renderUsage } from "citty";
import { CliError, configPath } from "../config";

export type IO = { stdout: (value: string) => void; stderr: (value: string) => void };
export type Services = {
  io: IO;
  provider?: YouTubeProvider;
  json: boolean;
  config?: string;
  exitCode: number;
  emit: (data: unknown) => void;
};
export type Command = CommandDef & {
  args: ArgsDef;
  meta: { name: string; description: string; version?: string };
  subCommands?: Record<string, Command>;
};
export const globalArgs = {
  config: { type: "string", description: "Installation config path", valueHint: "path" },
  json: { type: "boolean", description: "Emit compact structured JSON" },
} satisfies ArgsDef;
export const metadataArgs = {
  "include-video-metadata": { type: "boolean", description: "Return the associated video" },
  "include-channel-metadata": { type: "boolean", description: "Return the associated channel" },
} satisfies ArgsDef;
export const listArgs = {
  ...metadataArgs,
  limit: { type: "string", description: "Page size (default 50)", valueHint: "number" },
  cursor: { type: "string", description: "Opaque cursor from the previous page" },
  "sort-order": {
    type: "enum",
    options: ["asc", "desc"],
    description: "Sort direction (default desc)",
  },
} satisfies ArgsDef;
export const feedbackArgs = {
  "watched-at": { type: "string", description: "ISO watch timestamp with time zone" },
  notes: { type: "string", description: "Watch notes" },
  rating: { type: "string", description: "0.5–5 stars in half-star increments" },
} satisfies ArgsDef;
export const videoArg = {
  "video-id": { type: "positional", required: true, description: "YouTube video ID" },
} satisfies ArgsDef;

export function text(args: Record<string, unknown>, key: string) {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}
export const flag = (args: Record<string, unknown>, key: string) => args[key] === true;
export const selectedPath = (services: Services) => configPath(services.config);
export const camel = (name: string) =>
  name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

// Citty intentionally accepts unknown flags and coerces some malformed values.
// Validate the raw option shape against the same definitions before any effects.
export function validateRawArgs(rawArgs: string[], definitions: ArgsDef) {
  const options = new Map(
    Object.entries(definitions).flatMap(([name, definition]) => {
      if (definition.type === "positional") return [];
      const aliases =
        "alias" in definition
          ? typeof definition.alias === "string"
            ? [definition.alias]
            : (definition.alias ?? [])
          : [];
      return [name, camel(name), ...aliases].map((key) => [key, definition] as const);
    }),
  );
  for (let i = 0; i < rawArgs.length; i++) {
    const token = rawArgs[i] ?? "";
    if (token === "--") break;
    if (!token.startsWith("-")) continue;
    const [name = "", value] = token.replace(/^-{1,2}/, "").split(/=(.*)/s);
    const negated = name.startsWith("no-");
    const definition = options.get(negated ? name.slice(3) : name);
    if (!definition || definition.type === "positional")
      throw new CliError("Unknown option for this command. Run its --help.");
    if (negated && definition.type !== "boolean")
      throw new CliError("Only boolean options can be negated.");
    if (definition.type === "boolean") {
      if (value !== undefined && value !== "true" && value !== "false")
        throw new CliError("Boolean options accept true or false.");
    } else if (value === undefined) {
      const next = rawArgs[++i];
      if (next === undefined || next.startsWith("-"))
        throw new CliError(
          "Missing option value. Use --option=value for a value beginning with a dash.",
        );
    }
  }
}

function validateArgs(args: Record<string, unknown>, definitions: ArgsDef) {
  const known = new Set(["_", ...Object.keys(definitions).flatMap((key) => [key, camel(key)])]);
  for (const key of Object.keys(args))
    if (!known.has(key)) throw new CliError("Unknown option for this command. Run its --help.");
  const count = Object.values(definitions).filter((arg) => arg.type === "positional").length;
  if (!Array.isArray(args._) || args._.length !== count)
    throw new CliError("Unexpected positional arguments. Run this command's --help.");
  for (const [name, definition] of Object.entries(definitions)) {
    const value = args[name];
    if (
      value !== undefined &&
      (definition.type === "boolean" ? typeof value !== "boolean" : typeof value !== "string")
    )
      throw new CliError("Invalid option value. Run this command's --help.");
  }
}

export function leaf(
  name: string,
  description: string,
  args: ArgsDef,
  run: (args: Record<string, unknown>) => unknown | Promise<unknown>,
): Command {
  const definitions = { ...globalArgs, ...args };
  return defineCommand({
    meta: { name, description },
    args: definitions,
    run: async ({ args, rawArgs }) => {
      validateRawArgs(rawArgs, definitions);
      validateArgs(args, definitions);
      await run(args);
    },
  }) as Command;
}
export function group(
  services: Services,
  name: string,
  description: string,
  subCommands: Record<string, Command>,
  run?: () => unknown | Promise<unknown>,
): Command {
  const command = defineCommand({
    meta: { name, description },
    args: globalArgs,
    subCommands,
    setup: ({ rawArgs }) => {
      if (rawArgs[0]?.startsWith("-"))
        throw new CliError(
          "Options must follow their command; global options may appear anywhere.",
        );
    },
    run: async ({ args }) => {
      if (args._.length) return; // citty also runs parents after executing a child.
      if (run) await run();
      else
        services.io.stdout(
          await renderUsage(
            command,
            name === "curator" ? undefined : { meta: { name: "curator" } },
          ),
        );
    },
  }) as Command;
  return command;
}
