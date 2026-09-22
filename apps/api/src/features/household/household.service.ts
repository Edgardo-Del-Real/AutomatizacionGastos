import type { HouseholdMember } from "./household.config";

/** Public member shape: chatIds never leave the service (spec). */
export type PublicMember = { ownerId: string; name: string };

/**
 * Household identity: resolves Telegram chatIds to owners, exposes the member
 * list (without chatIds) and answers partner lookups for viewer-scoped reads.
 * In degraded single-user mode the member list holds only the `default`
 * member, so there is no partner and unknown chats resolve to nothing.
 */
export class HouseholdService {
  private readonly members: HouseholdMember[];

  constructor(members: HouseholdMember[]) {
    this.members = members;
  }

  resolveOwnerByChatId(chatId: number): string | null {
    return this.members.find((member) => member.chatId === chatId)?.ownerId ?? null;
  }

  partnerOf(ownerId: string): string | null {
    if (this.members.length < 2) return null;
    const partner = this.members.find((member) => member.ownerId !== ownerId);
    return partner?.ownerId ?? null;
  }

  getMembers(): PublicMember[] {
    return this.members.map(({ ownerId, name }) => ({ ownerId, name }));
  }
}