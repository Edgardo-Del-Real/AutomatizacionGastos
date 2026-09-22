import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom does not implement window.scrollTo; the section navigation calls it on
// every section change. Stub it so tests stay quiet and deterministic.
window.scrollTo = () => {};

// This jsdom build ships an inert localStorage stub (a plain object with no
// Storage methods). The viewer selection persists through localStorage, so
// tests need a working in-memory Storage to observe the rita.viewer key.
class MemoryStorage implements Storage {
  private readonly store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

Object.defineProperty(window, "localStorage", {
  value: new MemoryStorage(),
  configurable: true,
});

// vitest globals are disabled (mirrors apps/api), so RTL's automatic cleanup
// never registers. Without this, rendered DOM accumulates across tests.
afterEach(() => {
  cleanup();
});