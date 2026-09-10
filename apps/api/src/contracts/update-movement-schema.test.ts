import { describe, expect, it } from "vitest";
import { expenseSchema, updateMovementSchema } from "@rita/contracts";

describe("updateMovementSchema", () => {
  it("passes a payload with only note, leaving other fields untouched", () => {
    const result = updateMovementSchema.safeParse({ note: "cena" });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ note: "cena" });
    }
  });

  it("passes amount only", () => {
    const result = updateMovementSchema.safeParse({ amount: 1500 });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ amount: 1500 });
    }
  });

  it("accepts category null to represent clearing the category", () => {
    const result = updateMovementSchema.safeParse({ category: null });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ category: null });
    }
  });

  it("rejects a non-positive amount", () => {
    const result = updateMovementSchema.safeParse({ amount: 0 });

    expect(result.success).toBe(false);
  });

  it("rejects a category that is neither a string nor null", () => {
    const result = updateMovementSchema.safeParse({ category: 123 });

    expect(result.success).toBe(false);
  });

  it("rejects an empty patch with no recognized fields", () => {
    const result = updateMovementSchema.safeParse({});

    expect(result.success).toBe(false);
  });

  it("rejects an unknown-only payload", () => {
    const result = updateMovementSchema.safeParse({ type: "INCOME" });

    expect(result.success).toBe(false);
  });
});

describe("expenseSchema (unchanged)", () => {
  it("still parses the full expense shape with the original keys", () => {
    const expense = {
      id: "e1",
      ownerId: "default",
      amount: 2500,
      currency: "ARS",
      category: "food",
      note: "mercado",
      occurredAt: "2026-08-10T12:00:00.000Z",
      createdAt: "2026-08-10T12:00:00.000Z",
    };

    const result = expenseSchema.safeParse(expense);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data).sort()).toEqual(
        ["amount", "category", "createdAt", "currency", "id", "note", "occurredAt", "ownerId"].sort(),
      );
    }
  });

  it("still rejects a payload missing required fields", () => {
    const result = expenseSchema.safeParse({ id: "e1", ownerId: "default" });

    expect(result.success).toBe(false);
  });
});