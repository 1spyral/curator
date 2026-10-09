import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

// Resolve relative paths against the repository so every host uses the same default.
export function resolveDatabasePath(filename: string): string {
  return filename === ":memory:" ? filename : resolve(repositoryRoot, filename);
}
