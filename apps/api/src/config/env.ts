import { z } from "zod";
import { loadDotEnvFromDisk } from "./load-env";

loadDotEnvFromDisk();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  PORT: z.coerce.number().int().positive().default(3000),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1).default("test-verify-token"),
  WHATSAPP_APP_SECRET: z.string().min(1).default("test-app-secret"),
  WHATSAPP_OWNER_PHONE: z.string().min(1),
  OWNER_ID: z.string().min(1).default("default"),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);
