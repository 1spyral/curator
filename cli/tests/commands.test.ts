import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { version } from "../package.json";
import { runCli } from "../src/commands";

let directory: string;
let config: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "curator-commands-"));
  config = join(directory, "config.json");
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
async function invoke(args: string[]) {
  const output: string[] = [];
  const errors: string[] = [];
  const exit = await runCli(args, { stdout: (s) => output.push(s), stderr: (s) => errors.push(s) });
  return { exit, output, errors };
}

test("root, nested, alias and bare-group help is generated without touching setup", async () => {
  for (const [args, expected] of [
    [[], "curator"],
    [["--help"], "curator"],
    [["-h"], "curator"],
    [["help"], "curator"],
    [["recommendations"], "curator recommendations"],
    [["watched"], "curator watched"],
    [["db"], "curator db"],
    [["config"], "curator config"],
    [["recommendations", "create", "--help"], "curator recommendations create"],
    [["help", "watched", "update"], "curator watched update"],
    [["doctor", "mcp", "-h"], "curator doctor mcp"],
  ] as const) {
    const result = await invoke(["--config", config, ...args]);
    expect(result.exit).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.output.join()).toContain(`USAGE ${expected}`);
    expect(readdirSync(directory)).toEqual([]);
  }
  const create = await invoke(["recommendations", "create", "--help"]);
  expect(create.output.join()).toContain("--rationale");
  expect(create.output.join()).toContain("--include-video-metadata");
  const root = await invoke(["--help"]);
  expect(root.output.join()).toContain("--version");
});

test("version returns the package version without exiting the embedding process", async () => {
  for (const flag of ["--version", "-v"]) {
    const result = await invoke(["--config", config, flag]);
    expect(result).toEqual({ exit: 0, output: [version], errors: [] });
  }
  expect(readdirSync(directory)).toEqual([]);
});

test("global flags work before, between and after nested command names", async () => {
  for (const args of [
    ["--config", config, "--json", "config", "path"],
    ["config", "--config", config, "--json", "path"],
    ["config", "path", "--config", config, "--json"],
    ["--json", "config", `--config=${config}`, "path"],
  ]) {
    const result = await invoke(args);
    expect(result.exit).toBe(0);
    expect(result.output).toEqual([JSON.stringify({ data: config })]);
  }
  expect(existsSync(config)).toBe(false);
  const doctor = await invoke(["doctor", "--config", config, "--json"]);
  expect(doctor.exit).toBe(1);
  expect(JSON.parse(doctor.output[0] ?? "{}").data.status).toBe("error");
});

test("command-specific flags, required inputs and extra positionals are rejected before initialization", async () => {
  for (const args of [
    ["unknown"],
    ["recommendations", "unknown"],
    ["help", "unknown"],
    ["init", "--unknown"],
    ["init", "extra"],
    ["init", "--name"],
    ["config", "path", "extra"],
    ["watched", "get"],
    ["watched", "get", "video", "extra"],
    ["watched", "get", "video", "--include-video-metadat"],
    ["watched", "get", "video", "--include-video-metadata=oops"],
    ["recommendations", "list", "--sort-by", "createdAt"],
    ["recommendations", "list", "--sort-order=secret-value"],
    ["recommendations", "list", "--no-limit"],
    ["recommendations", "create", "video", "--rationale"],
    ["recommendations", "create", "video", "--rationale", ""],
    ["doctor", "--rating", "5"],
    ["mcp", "--unknown"],
  ]) {
    const result = await invoke(["--config", config, "--json", ...args]);
    expect(result.exit).toBe(1);
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.output[0] ?? "{}").data.error).toBeDefined();
    expect(result.output.join()).not.toContain("secret-value");
    expect(readdirSync(directory)).toEqual([]);
  }
});

test("flag-like string values remain command data rather than triggering help or globals", async () => {
  for (const value of ["--help", "--json", "--config", "--version"]) {
    const result = await invoke([
      "--config",
      config,
      "--json",
      "watched",
      "update",
      "video",
      `--notes=${value}`,
    ]);
    expect(result.exit).toBe(0);
    expect(result.output).toEqual(['{"data":null}']);
  }
});

test("malformed globals report failures without setup, and text failures stay on stderr", async () => {
  const missing = await invoke(["--json", "--config"]);
  expect(missing.exit).toBe(1);
  expect(JSON.parse(missing.output[0] ?? "{}").data.error).toBeDefined();
  const invalid = await invoke(["--config", config, "watched", "get"]);
  expect(invalid.exit).toBe(1);
  expect(invalid.output).toEqual([]);
  expect(invalid.errors).toHaveLength(1);
  expect(readdirSync(directory)).toEqual([]);
});
