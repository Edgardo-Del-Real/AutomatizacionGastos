import { householdMembersSchema } from "@rita/contracts";
import type { FastifyPluginAsync } from "fastify";
import type { HouseholdService } from "./household.service";

export type HouseholdRouteOptions = {
  householdService: HouseholdService;
};

export const householdRoute: FastifyPluginAsync<HouseholdRouteOptions> = async (app, options) => {
  const { householdService } = options;

  app.get("/household/members", async (_request, reply) => {
    // Strict schema: members carrying chatIds fail validation (no-chatId spec).
    return reply.send(householdMembersSchema.parse(householdService.getMembers()));
  });
};