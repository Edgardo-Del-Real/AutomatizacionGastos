import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom does not implement window.scrollTo; the section navigation calls it on
// every section change. Stub it so tests stay quiet and deterministic.
window.scrollTo = () => {};

// vitest globals are disabled (mirrors apps/api), so RTL's automatic cleanup
// never registers. Without this, rendered DOM accumulates across tests.
afterEach(() => {
  cleanup();
});