import { afterEach, describe, expect, it, vi } from "vitest";

async function loadOwnerId(): Promise<string> {
  const mod = await import("./env");
  return mod.OWNER_ID;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("OWNER_ID", () => {
  it("falls back to default when VITE_OWNER_ID is not configured", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_OWNER_ID", undefined);

    await expect(loadOwnerId()).resolves.toBe("default");
  });

  it("reads the configured VITE_OWNER_ID when present", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_OWNER_ID", "acme");

    await expect(loadOwnerId()).resolves.toBe("acme");
  });
});