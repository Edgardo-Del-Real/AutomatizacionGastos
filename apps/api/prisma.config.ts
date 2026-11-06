import { existsSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "prisma/config";

function loadDotEnvFromDisk(): void {
  let dir = process.cwd();
  for (let depth = 0; depth < 4; depth += 1) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
    dir = join(dir, "..");
  }
}

// The .env on disk is a LOCAL convenience. It must never override a
// DATABASE_URL that the caller already set: the integration tests pass the
// throwaway test database through the environment, and loading .env here used
// to redirect their `prisma migrate deploy` at production.
if (process.env.DATABASE_URL === undefined || process.env.DATABASE_URL === "") {
  loadDotEnvFromDisk();
}

// A local DATABASE_URL means the caller is pointing at a throwaway database
// (the integration suite). Migrations follow `directUrl`, so it has to point
// there too — otherwise `migrate deploy` escapes to production.
const databaseUrl = process.env.DATABASE_URL ?? "";
if (/localhost|127\.0\.0\.1/.test(databaseUrl)) {
  process.env.DIRECT_URL = databaseUrl;
}

export default defineConfig({});
