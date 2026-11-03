import { describe, expect, it } from "vitest";

import { UnauthorizedError } from "../../infra/errors";
import { readOptionalOwnerHeader, readOptionalOwnerId, resolveOwnerId } from "./auth.identity";

function requestWith(viewer: { ownerId: string } | null) {
  return { viewer } as never;
}

describe("resolveOwnerId", () => {
  it("prefers the session over any legacy input", () => {
    expect(resolveOwnerId(requestWith({ ownerId: "rita" }), "default")).toBe("rita");
  });

  it("ignores ?ownerId when there is a session (no impersonation)", () => {
    const request = requestWith({ ownerId: "default" });
    expect(resolveOwnerId(request, "rita")).toBe("default");
  });

  it("falls back to the legacy value when auth is not configured (tests)", () => {
    expect(resolveOwnerId(requestWith(null), "rita")).toBe("rita");
  });

  it("throws when there is neither a session nor a legacy value", () => {
    expect(() => resolveOwnerId(requestWith(null), undefined)).toThrow(UnauthorizedError);
  });

  it("reads the legacy query param softly", () => {
    expect(readOptionalOwnerId({ ownerId: "rita" })).toBe("rita");
    expect(readOptionalOwnerId({})).toBeUndefined();
    expect(readOptionalOwnerId({ ownerId: 42 })).toBeUndefined();
    expect(readOptionalOwnerId({ ownerId: "" })).toBeUndefined();
  });

  it("reads the legacy header softly", () => {
    expect(readOptionalOwnerHeader({ "x-owner-id": "rita" })).toBe("rita");
    expect(readOptionalOwnerHeader({})).toBeUndefined();
    expect(readOptionalOwnerHeader({ "x-owner-id": "" })).toBeUndefined();
  });
});
