import { householdMembersSchema } from "@rita/contracts";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { householdRoute } from "./household.route";
import { HouseholdService } from "./household.service";

async function buildApp(
  members: { ownerId: string; name: string; chatId: number }[],
): Promise<ReturnType<typeof Fastify>> {
  const app = Fastify();
  void app.register(householdRoute, { householdService: new HouseholdService(members) });
  await app.ready();
  return app;
}

describe("household route", () => {
  it("returns household members without chatIds", async () => {
    const app = await buildApp([
      { ownerId: "rita", name: "Rita", chatId: 111 },
      { ownerId: "edgardo", name: "Edgardo", chatId: 222 },
    ]);

    const response = await app.inject({ method: "GET", url: "/household/members" });

    expect(response.statusCode).toBe(200);
    const members = response.json();
    expect(members).toEqual([
      { ownerId: "rita", name: "Rita" },
      { ownerId: "edgardo", name: "Edgardo" },
    ]);
    // The wire contract (householdMembersSchema) is strict: a member carrying
    // a chatId would fail validation, pinning the no-chatId guarantee.
    expect(householdMembersSchema.safeParse(members).success).toBe(true);
    await app.close();
  });

  it("returns the single default member in single-user mode", async () => {
    const app = await buildApp([{ ownerId: "default", name: "default", chatId: 123456789 }]);

    const response = await app.inject({ method: "GET", url: "/household/members" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([{ ownerId: "default", name: "default" }]);
    await app.close();
  });
});