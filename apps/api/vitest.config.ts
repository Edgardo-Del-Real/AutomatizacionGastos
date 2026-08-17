import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    fileParallelism: false,
    env: {
      WHATSAPP_OWNER_PHONE: "+5491100000000",
    },
  },
});
