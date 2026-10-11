import { describe, expect, it } from "vitest";
import { parseHouseholdMembers } from "./household.config";

const fallback = { ownerId: "default", chatId: 123456789 };

describe("parseHouseholdMembers", () => {
  it("parses two members with ownerId, name and chatId", () => {
    const members = parseHouseholdMembers("rita:Rita:111;edgardo:Edgardo:222", fallback);

    expect(members).toEqual([
      { ownerId: "rita", name: "Rita", chatId: 111 },
      { ownerId: "edgardo", name: "Edgardo", chatId: 222 },
    ]);
  });

  it("fails fast on a non-numeric chatId", () => {
    expect(() => parseHouseholdMembers("rita:Rita:abc", fallback)).toThrow();
  });

  it("fails fast on a non-integer chatId", () => {
    expect(() => parseHouseholdMembers("rita:Rita:12.5", fallback)).toThrow();
  });

  it("fails fast on a non-positive chatId", () => {
    expect(() => parseHouseholdMembers("rita:Rita:0", fallback)).toThrow();
  });

  it("fails fast on an entry with the wrong number of parts", () => {
    expect(() => parseHouseholdMembers("rita:Rita:111:extra", fallback)).toThrow();
  });

  it("fails fast on a duplicate ownerId", () => {
    expect(() => parseHouseholdMembers("rita:Rita:111;rita:Rita2:222", fallback)).toThrow(
      /ownerId/i,
    );
  });

  it("fails fast on a duplicate chatId", () => {
    expect(() => parseHouseholdMembers("rita:Rita:111;edgardo:Edgardo:111", fallback)).toThrow(
      /chatId/i,
    );
  });

  it("fails fast on a third member", () => {
    expect(() => parseHouseholdMembers("a:A:1;b:B:2;c:C:3", fallback)).toThrow();
  });

  it("degrades to the fallback member when unset", () => {
    const members = parseHouseholdMembers(undefined, fallback);

    expect(members).toEqual([{ ownerId: "default", name: "default", chatId: 123456789 }]);
  });

  it("degrades to the fallback member when blank", () => {
    const members = parseHouseholdMembers("   ", fallback);

    expect(members).toEqual([{ ownerId: "default", name: "default", chatId: 123456789 }]);
  });
});