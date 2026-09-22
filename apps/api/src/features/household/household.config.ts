import { z } from "zod";

export type HouseholdMember = { ownerId: string; name: string; chatId: number };

const householdEntrySchema = z.object({
  ownerId: z.string().min(1, "ownerId is required"),
  name: z.string().min(1, "name is required"),
  chatId: z.coerce
    .number()
    .int("chatId must be an integer")
    .positive("chatId must be a positive integer"),
});

/**
 * Parses and validates the `HOUSEHOLD_MEMBERS` env var, whose format is
 * `ownerId:Name:chatId;ownerId:Name:chatId` (1–2 entries, AD1). Fail-fast
 * rules: non-`ownerId:Name:chatId` entries, duplicate ownerIds, duplicate
 * chatIds and more than two entries all throw.
 */
export const householdMembersEnvSchema = z
  .string()
  .superRefine((raw, ctx) => {
    const entries = raw
      .split(";")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    for (const [index, entry] of entries.entries()) {
      if (entry.split(":").length !== 3) {
        ctx.addIssue({
          code: "custom",
          path: [index],
          message: `HOUSEHOLD_MEMBERS entry ${index + 1} must be ownerId:Name:chatId`,
        });
      }
    }
  })
  .transform((raw) =>
    raw
      .split(";")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .map((entry) => {
        const [ownerId, name, chatId] = entry.split(":");
        return { ownerId, name, chatId };
      }),
  )
  .pipe(
    z
      .array(householdEntrySchema)
      .min(1, "HOUSEHOLD_MEMBERS must contain at least one entry")
      .max(2, "HOUSEHOLD_MEMBERS supports at most 2 members")
      .refine(
        (members) => new Set(members.map((member) => member.ownerId)).size === members.length,
        { message: "duplicate ownerId in HOUSEHOLD_MEMBERS" },
      )
      .refine(
        (members) => new Set(members.map((member) => member.chatId)).size === members.length,
        { message: "duplicate chatId in HOUSEHOLD_MEMBERS" },
      ),
  );

/**
 * Parses `HOUSEHOLD_MEMBERS`. When unset or blank, returns the single
 * degraded-mode member: ownerId/name from the fallback (repo default
 * `default`) and the fallback chatId, which keeps the bot answering only the
 * owner's chat exactly as before (spec "Unset degrades to single-user").
 */
export function parseHouseholdMembers(
  raw: string | undefined,
  fallback: { ownerId: string; chatId: number },
): HouseholdMember[] {
  if (raw === undefined || raw.trim() === "") {
    return [{ ownerId: fallback.ownerId, name: fallback.ownerId, chatId: fallback.chatId }];
  }
  return householdMembersEnvSchema.parse(raw);
}