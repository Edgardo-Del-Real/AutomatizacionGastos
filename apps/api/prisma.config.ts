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

loadDotEnvFromDisk();

export default defineConfig({});
