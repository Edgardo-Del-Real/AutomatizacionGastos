import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "../../packages/contracts/src/**/*.test.ts"],
    fileParallelism: false,
    // Integration tests run `prisma migrate deploy` against the shared test DB;
    // sequential files can wait on the migration advisory lock for several
    // seconds, exceeding vitest's 5000ms default. 15000ms makes the full suite
    // deterministic under DB contention (savings-config Phase 7, task 7.3).
    testTimeout: 15000,
    env: {
      TELEGRAM_BOT_TOKEN: "123456:TEST_TOKEN",
      TELEGRAM_OWNER_CHAT_ID: "123456789",
    },
  },
});
