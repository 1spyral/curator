import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./persistence/src/schema/index.ts",
  out: "./persistence/migrations",
});
