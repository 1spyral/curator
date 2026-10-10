import { serveStdio } from "@modelcontextprotocol/server/stdio";
import type { McpConfig } from "./config";
import { createMcpHost } from "./server";

export function startMcpStdio(config: McpConfig) {
  const host = createMcpHost(config);
  const handle = serveStdio(() => host.server, {
    onerror: () => console.error("MCP transport error."),
  });
  const close = () =>
    handle
      .close()
      .finally(() => host.close())
      .catch(() => {
        console.error("MCP shutdown failed.");
        process.exitCode = 1;
      });
  const shutdown = () => void close();
  process.stdin.once("end", shutdown);
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return { close };
}
