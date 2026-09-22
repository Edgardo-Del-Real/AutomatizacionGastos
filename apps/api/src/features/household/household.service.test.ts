import { describe, expect, it } from "vitest";
import { HouseholdService } from "./household.service";

const duo = [
  { ownerId: "rita", name: "Rita", chatId: 111 },
  { ownerId: "edgardo", name: "Edgardo", chatId: 222 },
];

describe("HouseholdService", () => {
  it("resolves a known chatId to its owner", () => {
    const service = new HouseholdService(duo);

    expect(service.resolveOwnerByChatId(111)).toBe("rita");
    expect(service.resolveOwnerByChatId(222)).toBe("edgardo");
  });

  it("resolves an unknown chatId to null", () => {
    const service = new HouseholdService(duo);

    expect(service.resolveOwnerByChatId(999)).toBeNull();
  });

  it("resolves the partner of a member", () => {
    const service = new HouseholdService(duo);

    expect(service.partnerOf("rita")).toBe("edgardo");
    expect(service.partnerOf("edgardo")).toBe("rita");
  });

  it("returns members without chatIds", () => {
    const service = new HouseholdService(duo);

    expect(service.getMembers()).toEqual([
      { ownerId: "rita", name: "Rita" },
      { ownerId: "edgardo", name: "Edgardo" },
    ]);
  });
});

describe("HouseholdService in degraded single-user mode", () => {
  const solo = [{ ownerId: "default", name: "default", chatId: 123456789 }];

  it("has no partner", () => {
    const service = new HouseholdService(solo);

    expect(service.partnerOf("default")).toBeNull();
  });

  it("returns only the default member without chatIds", () => {
    const service = new HouseholdService(solo);

    expect(service.getMembers()).toEqual([{ ownerId: "default", name: "default" }]);
  });

  it("resolves the fallback chat to default and nothing else", () => {
    const service = new HouseholdService(solo);

    expect(service.resolveOwnerByChatId(123456789)).toBe("default");
    expect(service.resolveOwnerByChatId(42)).toBeNull();
  });
});