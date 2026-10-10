import { VideoLoadError } from "@curator/core/shelf";
import type { YouTubeProvider } from "@curator/core/youtube";
import { type ArgsDef, parseArgs, renderUsage, runCommand } from "citty";
import { z } from "zod";
import { version } from "../package.json";
import { doctorCommand, mcpCommand } from "./commands/hosts";
import { databaseCommands, setupCommands } from "./commands/setup";
import {
  type Command,
  camel,
  globalArgs,
  group,
  type IO,
  type Services,
  validateRawArgs,
} from "./commands/shared";
import { shelfCommands } from "./commands/shelf";
import { CliError } from "./config";

const controlArgs = {
  ...globalArgs,
  help: { type: "boolean", alias: "h", description: "Show command help" },
  version: { type: "boolean", alias: "v", description: "Show CLI version" },
} satisfies ArgsDef;
const defaultIO: IO = {
  stdout: (value) => console.log(value),
  stderr: (value) => console.error(value),
};

function commandTree(services: Services) {
  const command = group(services, "curator", "Curator installation and shelf tools", {
    ...setupCommands(services),
    db: databaseCommands(services),
    doctor: doctorCommand(services),
    mcp: mcpCommand(services),
    ...shelfCommands(services),
  });
  command.args = controlArgs;
  command.meta.version = version;
  return command;
}

// Citty drops parent options when descending into a subcommand. Extract only
// host-wide flags here; citty still parses and dispatches each command's args.
function extractControls(argv: string[], root: Command) {
  const definitions: ArgsDef = {};
  const collect = (command: Command) => {
    for (const [name, definition] of Object.entries(command.args)) {
      definitions[name] = definition;
      definitions[camel(name)] = definition;
    }
    for (const child of Object.values(command.subCommands ?? {})) collect(child);
  };
  collect(root);
  const controls: string[] = [];
  const commandArgs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] ?? "";
    if (token === "--") {
      commandArgs.push(...argv.slice(i));
      break;
    }
    const name = token.replace(/^-{1,2}/, "").split("=")[0] ?? "";
    const controlName = name === "h" ? "help" : name === "v" ? "version" : name.replace(/^no-/, "");
    const control = token.startsWith("-") && Object.hasOwn(controlArgs, controlName);
    const destination = control ? controls : commandArgs;
    destination.push(token);
    const definition =
      definitions[name] ??
      definitions[name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())];
    if (
      token.startsWith("-") &&
      !token.includes("=") &&
      (definition?.type === "string" || definition?.type === "enum")
    ) {
      const value = argv[++i];
      if (value !== undefined) destination.push(value);
    }
  }
  return { controls, commandArgs };
}

function helpTarget(root: Command, args: string[]) {
  let command = root;
  const names = [root.meta.name];
  for (const name of args) {
    if (!command.subCommands) break;
    const child = command.subCommands[name];
    if (!child) throw new CliError("Unknown command. Run curator --help.");
    command = child;
    names.push(name);
  }
  return { ...command, meta: { ...command.meta, name: names.join(" ") } };
}

export async function runCli(
  argv: string[],
  io: IO = defaultIO,
  dependencies: { provider?: YouTubeProvider } = {},
): Promise<number> {
  const services: Services = {
    io,
    ...dependencies,
    json: false,
    exitCode: 0,
    emit: (data) => io.stdout(JSON.stringify({ data }, null, services.json ? undefined : 2)),
  };
  try {
    const root = commandTree(services);
    const { controls, commandArgs } = extractControls(argv, root);
    const parsed = parseArgs(controls, controlArgs);
    services.json = parsed.json === true;
    validateRawArgs(controls, controlArgs);
    services.config = typeof parsed.config === "string" ? parsed.config : undefined;
    if (parsed.version === true) {
      if (commandArgs.length) throw new CliError("Use --version without a command.");
      io.stdout(version);
    } else if (parsed.help === true || commandArgs[0] === "help") {
      const target = helpTarget(
        root,
        commandArgs[0] === "help" ? commandArgs.slice(1) : commandArgs,
      );
      io.stdout(await renderUsage(target));
    } else {
      await runCommand(root, { rawArgs: commandArgs });
    }
    return services.exitCode;
  } catch (error) {
    const argumentError =
      error instanceof z.ZodError || (error instanceof Error && error.name === "CLIError");
    const detail =
      error instanceof VideoLoadError
        ? error.error
        : {
            code: argumentError ? "invalid-input" : "operation-failed",
            message:
              error instanceof CliError
                ? error.message
                : argumentError
                  ? "Invalid input. Check the command fields and values or run its --help."
                  : "Operation failed. Check config, database, and whether the record already exists.",
          };
    if (services.json) services.emit({ error: detail });
    else io.stderr(`${detail.code}: ${detail.message}`);
    return 1;
  }
}
