import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "../../packages/contracts/src/**/*.test.ts"],
    fileParallelism: false,
    env: {
      TELEGRAM_BOT_TOKEN: "123456:TEST_TOKEN",
      TELEGRAM_OWNER_CHAT_ID: "123456789",
    },
  },
});
