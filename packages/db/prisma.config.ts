import { join } from "node:path";
import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

// Load the repo-root .env resolved from THIS file's location, not process.cwd(),
// so it works whether prisma runs from packages/db or from the repo root via turbo.
config({ path: join(import.meta.dirname, "../../.env") });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
