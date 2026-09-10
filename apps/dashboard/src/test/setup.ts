import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// vitest globals are disabled (mirrors apps/api), so RTL's automatic cleanup
// never registers. Without this, rendered DOM accumulates across tests.
afterEach(() => {
  cleanup();
});