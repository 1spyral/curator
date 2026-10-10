import { mcpConfigSchema } from "./config";
import { startMcpStdio } from "./stdio";

async function main() {
  const args = Bun.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== "--config")) {
    throw new Error("Usage: bun mcp/src/index.ts [--config path/to/config.json]");
  }
  const input: unknown = args[1] ? await Bun.file(args[1]).json() : {};
  const config = mcpConfigSchema.parse(input);
  startMcpStdio(config);
}

if (import.meta.main) {
  main().catch(() => {
    console.error("MCP startup failed. Check the JSON configuration and database path.");
    process.exitCode = 1;
  });
}
