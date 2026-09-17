import { z } from "zod";
import { loadDotEnvFromDisk } from "./load-env";

loadDotEnvFromDisk();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  PORT: z.coerce.number().int().positive().default(3000),
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  TELEGRAM_OWNER_CHAT_ID: z.coerce.number().int().positive(),
  OWNER_ID: z.string().min(1).default("default"),
  GROQ_API_KEY: z.string().min(1).optional(),
  LLM_MODEL: z.string().min(1).default("openai/gpt-oss-20b"),
  LLM_BASE_URL: z.string().url().default("https://api.groq.com/openai/v1/chat/completions"),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
});

export type Env = z.infer<typeof envSchema>;

export { envSchema };

export const env: Env = envSchema.parse(process.env);
