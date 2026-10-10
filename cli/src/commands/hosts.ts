import { startMcpStdio } from "@curator/mcp/stdio";
import { CliError, ensureConfig } from "../config";
import { doctor } from "../doctor";
import { group, leaf, type Services, selectedPath } from "./shared";

export function doctorCommand(services: Services) {
  const diagnose = async (mcp = false) => {
    const report = await doctor(selectedPath(services), mcp);
    if (services.json) services.emit(report);
    else
      for (const check of report.checks)
        services.io.stdout(`${check.status.toUpperCase()} ${check.name}: ${check.message}`);
    services.exitCode = report.status === "error" ? 1 : 0;
  };
  return group(
    services,
    "doctor",
    "Read-only installation diagnostics",
    {
      mcp: leaf("mcp", "Also run an isolated MCP protocol self-test", {}, () => diagnose(true)),
    },
    () => diagnose(),
  );
}
export function mcpCommand(services: Services) {
  return leaf("mcp", "Launch MCP using the CLI installation (protocol-only stdout)", {}, () => {
    if (services.json)
      throw new CliError("--json cannot be used with mcp; stdout is the MCP protocol channel.");
    const config = ensureConfig(selectedPath(services));
    startMcpStdio({ core: config.core, singleUser: config.singleUser });
  });
}
