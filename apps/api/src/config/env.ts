import { z } from "zod";
import { loadDotEnvFromDisk } from "./load-env";
import { householdMembersEnvSchema } from "../features/household/household.config";

loadDotEnvFromDisk();

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    PORT: z.coerce.number().int().positive().default(3000),
    TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
    TELEGRAM_OWNER_CHAT_ID: z.coerce.number().int().positive().optional(),
    OWNER_ID: z.string().min(1).default("default"),
    HOUSEHOLD_MEMBERS: z.string().optional(),
    GROQ_API_KEY: z.string().min(1).optional(),
    LLM_MODEL: z.string().min(1).default("openai/gpt-oss-20b"),
    LLM_BASE_URL: z.string().url().default("https://api.groq.com/openai/v1/chat/completions"),
    LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  })
  .superRefine((data, ctx) => {
    const hasHousehold =
      data.HOUSEHOLD_MEMBERS !== undefined && data.HOUSEHOLD_MEMBERS.trim() !== "";
    // Single-user mode still needs the owner chat; household mode gets it from
    // HOUSEHOLD_MEMBERS entries instead (AD1).
    if (!hasHousehold && data.TELEGRAM_OWNER_CHAT_ID === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["TELEGRAM_OWNER_CHAT_ID"],
        message: "TELEGRAM_OWNER_CHAT_ID is required when HOUSEHOLD_MEMBERS is unset",
      });
    }
    // Malformed member entries must fail startup with a clear config error.
    if (hasHousehold) {
      const parsed = householdMembersEnvSchema.safeParse(data.HOUSEHOLD_MEMBERS);
      if (!parsed.success) {
        ctx.addIssue({
          code: "custom",
          path: ["HOUSEHOLD_MEMBERS"],
          message: `Invalid HOUSEHOLD_MEMBERS: ${parsed.error.issues
            .map((issue) => issue.message)
            .join("; ")}`,
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export { envSchema };

export const env: Env = envSchema.parse(process.env);
