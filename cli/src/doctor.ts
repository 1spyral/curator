import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getMigrationStatus, openDatabase, users } from "@curator/core/persistence";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { eq } from "drizzle-orm";
import { ensureConfig, readConfig } from "./config";

type Check = { name: string; status: "ok" | "warning" | "error"; message: string };
export type DoctorReport = { status: Check["status"]; checks: Check[] };

export async function doctor(
  path: string,
  probeMcp = false,
  options: { mcpEntry?: string; timeoutMs?: number; temporaryRoot?: string } = {},
): Promise<DoctorReport> {
  const checks: Check[] = [];
  const check = (name: string, status: Check["status"], message: string) =>
    checks.push({ name, status, message });
  try {
    if (!existsSync(path)) throw new Error("missing");
    const config = readConfig(path);
    check("config", "ok", `Valid single-user config: ${path}`);
    check(
      "youtube",
      config.core.youtube.youtubeDataApi.apiKey ? "ok" : "warning",
      config.core.youtube.youtubeDataApi.apiKey
        ? "API key configured; not tested against YouTube."
        : "No API key; cached videos remain usable.",
    );
    const databasePath = config.core.persistence.databasePath;
    if (databasePath === ":memory:" || !existsSync(databasePath)) {
      check(
        "database",
        "error",
        "Persistent database is missing; run init or an ordinary command to initialize it.",
      );
    } else {
      try {
        const persistence = openDatabase(config.core.persistence, { readOnly: true });
        try {
          const { db } = persistence;
          check("database", "ok", `Opened read-only: ${databasePath}`);
          const integrity = db.$client.query("PRAGMA quick_check").all();
          check(
            "integrity",
            integrity.length === 1 && Object.values(integrity[0] ?? {})[0] === "ok"
              ? "ok"
              : "error",
            "SQLite integrity check completed.",
          );
          const violations = db.$client.query("PRAGMA foreign_key_check").all();
          check(
            "foreign-keys",
            violations.length ? "error" : "ok",
            `${violations.length} foreign-key violations.`,
          );
          const migrations = getMigrationStatus(db);
          check(
            "migrations",
            migrations.drifted || migrations.pending ? "error" : "ok",
            migrations.drifted
              ? "Migration history differs from this version; inspect before making changes."
              : `${migrations.applied}/${migrations.total} applied; ${migrations.pending} pending. Use db migrate to apply pending migrations.`,
          );
          const user = db.select().from(users).where(eq(users.id, config.singleUser.userId)).get();
          check(
            "user",
            user ? "ok" : "error",
            user
              ? `Configured user exists: ${user.id}`
              : "Configured user is missing; run init to create it.",
          );
        } finally {
          persistence.close();
        }
      } catch {
        check(
          "database-checks",
          "error",
          "Cannot inspect database or required tables. Check its schema and migrations.",
        );
      }
    }
  } catch {
    check(
      "config",
      "error",
      `Config missing or invalid: ${path}. An ordinary command initializes missing setup; edit invalid JSON manually.`,
    );
  }
  if (probeMcp) {
    const directory = mkdtempSync(join(options.temporaryRoot ?? tmpdir(), "curator-mcp-doctor-"));
    const client = new Client({ name: "curator-doctor", version: "0.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        options.mcpEntry ?? fileURLToPath(new URL("./index.ts", import.meta.url)),
        "--config",
        join(directory, "config.json"),
        "mcp",
      ],
      cwd: directory,
      stderr: "pipe",
    });
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      // Separate config/database and no credentials: never boot the real installation.
      ensureConfig(join(directory, "config.json"));
      await Promise.race([
        (async () => {
          await client.connect(transport);
          const result = await client.listTools();
          const names = result.tools.map((tool) => tool.name).sort();
          const expected = [
            "get_context",
            "create_recommendation",
            "get_recommendation",
            "get_recommendations",
            "create_watched_video",
            "update_watched_video",
            "get_watched_video",
            "get_watched_videos",
          ].sort();
          if (JSON.stringify(names) !== JSON.stringify(expected))
            throw new Error("Unexpected tools");
          const context = await client.callTool({ name: "get_context", arguments: {} });
          if (
            context.isError ||
            (context.structuredContent as { data?: { id?: string } } | undefined)?.data?.id !==
              "local"
          )
            throw new Error("Invalid context");
        })(),
        new Promise<never>((_, reject) => {
          deadline = setTimeout(
            () => reject(new Error("MCP self-test timed out")),
            options.timeoutMs ?? 15000,
          );
        }),
      ]);
      check(
        "mcp-self-test",
        "ok",
        "Isolated stdio startup, eight-tool discovery, and get_context passed. Real installation was not started.",
      );
    } catch {
      check(
        "mcp-self-test",
        "error",
        "Isolated MCP protocol self-test failed or exceeded its 15-second deadline.",
      );
    } finally {
      clearTimeout(deadline);
      try {
        await client.close();
      } finally {
        try {
          await transport.close();
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      }
    }
  }
  return {
    status: checks.some((entry) => entry.status === "error")
      ? "error"
      : checks.some((entry) => entry.status === "warning")
        ? "warning"
        : "ok",
    checks,
  };
}
