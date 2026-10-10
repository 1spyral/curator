#!/usr/bin/env bun
import { runCli } from "./commands";

if (import.meta.main) process.exitCode = await runCli(Bun.argv.slice(2));
