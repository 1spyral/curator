import { redactConfig } from "@curator/core/config";
import { cliConfigSchema, ensureConfig, readConfig } from "../config";
import { openRuntime } from "../runtime";
import { group, leaf, type Services, selectedPath, text } from "./shared";

function initialize(services: Services, initial = {}) {
  const path = selectedPath(services);
  const config = ensureConfig(path, initial);
  const runtime = openRuntime(config);
  try {
    services.emit({
      configPath: path,
      databasePath: config.core.persistence.databasePath,
      user: runtime.user,
    });
  } finally {
    runtime.close();
  }
}
export function setupCommands(services: Services) {
  return {
    init: leaf(
      "init",
      "Initialize setup or adopt an existing database",
      {
        database: { type: "string", description: "Existing SQLite path to adopt" },
        "user-id": { type: "string", description: "Stable local user ID (default local)" },
        name: { type: "string", description: "Name for a new user (default Local user)" },
      },
      (args) =>
        initialize(services, {
          database: text(args, "database"),
          userId: text(args, "user-id"),
          name: text(args, "name"),
        }),
    ),
    config: group(services, "config", "Inspect persistent installation settings", {
      path: leaf("path", "Show the selected config path", {}, () =>
        services.emit(selectedPath(services)),
      ),
      show: leaf("show", "Show config with credentials redacted", {}, () =>
        services.emit(redactConfig(cliConfigSchema, readConfig(selectedPath(services)))),
      ),
    }),
  };
}
export function databaseCommands(services: Services) {
  return group(services, "db", "Manage database migrations", {
    migrate: leaf("migrate", "Apply pending database migrations", {}, () => initialize(services)),
  });
}
