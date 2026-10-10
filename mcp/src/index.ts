import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { mcpConfigSchema } from "./config";
import { createMcpHost } from "./server";

async function main() {
  const args = Bun.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== "--config")) {
    throw new Error("Usage: bun mcp/src/index.ts [--config path/to/config.json]");
  }
  const input: unknown = args[1] ? await Bun.file(args[1]).json() : {};
  const config = mcpConfigSchema.parse(input);
  const host = createMcpHost(config);
  const handle = serveStdio(() => host.server, {
    onerror: () => console.error("MCP transport error."),
  });
  const shutdown = () =>
    void handle
      .close()
      .finally(() => host.close())
      .catch(() => {
        console.error("MCP shutdown failed.");
        process.exitCode = 1;
      });
  process.stdin.once("end", shutdown);
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (import.meta.main) {
  main().catch(() => {
    console.error("MCP startup failed. Check the JSON configuration and database path.");
    process.exitCode = 1;
  });
}
