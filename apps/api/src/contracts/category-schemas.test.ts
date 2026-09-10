import { describe, expect, it } from "vitest";
import { categoryListSchema, ownerCategorySchema } from "@rita/contracts";

describe("ownerCategorySchema", () => {
  it("parses a category with name and keyword rules", () => {
    const result = ownerCategorySchema.safeParse({
      name: "Cafe",
      keywords: ["cafe"],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ name: "Cafe", keywords: ["cafe"] });
    }
  });

  it("parses a category with an empty keyword list", () => {
    const result = ownerCategorySchema.safeParse({
      name: "otro",
      keywords: [],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ name: "otro", keywords: [] });
    }
  });

  it("rejects a payload missing the keywords field", () => {
    const result = ownerCategorySchema.safeParse({ name: "Cafe" });

    expect(result.success).toBe(false);
  });

  it("rejects a payload whose name is not a string", () => {
    const result = ownerCategorySchema.safeParse({
      name: 42,
      keywords: ["cafe"],
    });

    expect(result.success).toBe(false);
  });
});

describe("categoryListSchema", () => {
  it("parses a list of owner categories", () => {
    const result = categoryListSchema.safeParse([
      { name: "Cafe", keywords: ["cafe"] },
      { name: "otro", keywords: [] },
    ]);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toEqual({ name: "Cafe", keywords: ["cafe"] });
      expect(result.data[1]).toEqual({ name: "otro", keywords: [] });
    }
  });

  it("parses an empty list", () => {
    const result = categoryListSchema.safeParse([]);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
    }
  });

  it("rejects a list containing an invalid entry", () => {
    const result = categoryListSchema.safeParse([{ name: "Cafe" }]);

    expect(result.success).toBe(false);
  });
});