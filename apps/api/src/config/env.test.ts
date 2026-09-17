import { describe, expect, it } from "vitest";
import { envSchema } from "./env";

const base = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://rita:rita@localhost:5433/automatizacionrita_test",
  TELEGRAM_BOT_TOKEN: "123456:TEST_TOKEN",
  TELEGRAM_OWNER_CHAT_ID: "123456789",
  OWNER_ID: "default",
};

describe("env schema", () => {
  it("requires TELEGRAM_BOT_TOKEN with no default", () => {
    const result = envSchema.safeParse({ ...base, TELEGRAM_BOT_TOKEN: undefined });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join(".") === "TELEGRAM_BOT_TOKEN");
      expect(issue).toBeDefined();
      expect(issue?.message).toMatch(/required/i);
    }
  });

  it("rejects an empty TELEGRAM_BOT_TOKEN", () => {
    const result = envSchema.safeParse({ ...base, TELEGRAM_BOT_TOKEN: "" });

    expect(result.success).toBe(false);
  });

  it("coerces TELEGRAM_OWNER_CHAT_ID from a numeric string to a positive integer", () => {
    const result = envSchema.safeParse(base);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.TELEGRAM_OWNER_CHAT_ID).toBe(123456789);
    }
  });

  it("rejects a non-positive TELEGRAM_OWNER_CHAT_ID", () => {
    const result = envSchema.safeParse({ ...base, TELEGRAM_OWNER_CHAT_ID: "0" });

    expect(result.success).toBe(false);
  });

  it("rejects a non-integer TELEGRAM_OWNER_CHAT_ID", () => {
    const result = envSchema.safeParse({ ...base, TELEGRAM_OWNER_CHAT_ID: "12.5" });

    expect(result.success).toBe(false);
  });

  it("requires TELEGRAM_OWNER_CHAT_ID with no default", () => {
    const result = envSchema.safeParse({ ...base, TELEGRAM_OWNER_CHAT_ID: undefined });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join(".") === "TELEGRAM_OWNER_CHAT_ID");
      expect(issue).toBeDefined();
    }
  });

  it("exposes no WHATSAPP_* keys after telegram cutover", () => {
    const result = envSchema.safeParse(base);

    expect(result.success).toBe(true);
    if (result.success) {
      const keys = Object.keys(result.data);
      expect(keys.some((key) => key.startsWith("WHATSAPP_"))).toBe(false);
    }
  });

  it("defaults LLM_MODEL, LLM_BASE_URL and LLM_TIMEOUT_MS, and leaves GROQ_API_KEY unset", () => {
    const result = envSchema.safeParse(base);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.GROQ_API_KEY).toBeUndefined();
      expect(result.data.LLM_MODEL).toBe("openai/gpt-oss-20b");
      expect(result.data.LLM_BASE_URL).toBe("https://api.groq.com/openai/v1/chat/completions");
      expect(result.data.LLM_TIMEOUT_MS).toBe(5000);
    }
  });

  it("accepts an optional GROQ_API_KEY and a custom LLM_MODEL", () => {
    const result = envSchema.safeParse({ ...base, GROQ_API_KEY: "gsk_abc", LLM_MODEL: "llama-3.3-70b" });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.GROQ_API_KEY).toBe("gsk_abc");
      expect(result.data.LLM_MODEL).toBe("llama-3.3-70b");
    }
  });

  it("rejects an empty GROQ_API_KEY", () => {
    const result = envSchema.safeParse({ ...base, GROQ_API_KEY: "" });

    expect(result.success).toBe(false);
  });

  it("rejects an invalid LLM_BASE_URL with a config error", () => {
    const result = envSchema.safeParse({ ...base, LLM_BASE_URL: "not-a-url" });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join(".") === "LLM_BASE_URL");
      expect(issue).toBeDefined();
      expect(issue?.message).toMatch(/invalid url/i);
    }
  });

  it("coerces LLM_TIMEOUT_MS from a numeric string", () => {
    const result = envSchema.safeParse({ ...base, LLM_TIMEOUT_MS: "3000" });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.LLM_TIMEOUT_MS).toBe(3000);
    }
  });

  it("rejects a non-positive LLM_TIMEOUT_MS", () => {
    const result = envSchema.safeParse({ ...base, LLM_TIMEOUT_MS: "0" });

    expect(result.success).toBe(false);
  });
});