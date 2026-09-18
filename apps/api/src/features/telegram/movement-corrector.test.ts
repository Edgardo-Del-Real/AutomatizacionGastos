import { describe, expect, it, vi } from "vitest";
import { NotFoundError, ValidationFailedError } from "../../infra/errors";
import type { CategoryService } from "../categories/categories.service";
import type { MovementService } from "../movements/movements.service";
import { MovementCorrector } from "./movement-corrector";

const ownerId = "default";
const NOW = new Date("2026-09-20T12:00:00.000Z");

type MovementFixture = {
  id: string;
  amount: number;
  note: string | null;
  occurredAt: Date;
  category?: string | null;
};

function movement(id: string, amount: number, note: string | null, occurredAt: Date): MovementFixture {
  return { id, amount, note, occurredAt, category: null };
}

function toMovement(row: MovementFixture) {
  return {
    id: row.id,
    ownerId,
    amount: row.amount,
    currency: "ARS",
    category: row.category ?? null,
    note: row.note,
    occurredAt: row.occurredAt,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    type: "EXPENSE" as const,
  };
}

function makeCorrector(overrides?: {
  movements?: MovementFixture[];
  categories?: string[];
  updateMovement?: (id: string, patch: unknown) => Promise<unknown>;
  createCategory?: (name: string) => Promise<{ name: string }>;
  listCategories?: () => Promise<unknown>;
}) {
  const rows = overrides?.movements ?? [];
  const categories = overrides?.categories ?? ["gastos hormiga"];
  const updateMovement = vi.fn(overrides?.updateMovement ?? (async () => undefined));
  const listMovements = vi.fn(async () => rows.map(toMovement));
  const listCategories = vi.fn(
    overrides?.listCategories ??
      (async () =>
        categories.map((name) => ({ id: `c-${name}`, ownerId, name, createdAt: new Date(), keywords: [] }))),
  );
  const createCategory = vi.fn(
    overrides?.createCategory ??
      (async (ownerIdArg: string, name: string) => ({ id: `c-${name}`, ownerId: ownerIdArg, name, createdAt: new Date() })),
  );
  const movementService = { listMovements, updateMovement } as unknown as MovementService;
  const categoryService = { listCategories, createCategory } as unknown as CategoryService;
  const corrector = new MovementCorrector(movementService, categoryService);
  return { corrector, listMovements, updateMovement, listCategories, createCategory };
}

const HOT = new Date("2026-09-19T12:00:00.000Z"); // 1 day before NOW
const WARM = new Date("2026-09-17T12:00:00.000Z"); // 3 days before NOW

describe("MovementCorrector.correct", () => {
  it("reassigns a unique recent amount match to the target category", async () => {
    const { corrector, updateMovement } = makeCorrector({
      movements: [movement("m1", 2500, "uber", HOT)],
    });

    const result = await corrector.correct(ownerId, { amount: 2500, note: null }, "gastos hormiga", NOW);

    expect(result).toEqual({
      status: "reassigned",
      movement: { id: "m1", amount: 2500, note: "uber", date: "2026-09-19", type: "EXPENSE" },
      category: "gastos hormiga",
    });
    expect(updateMovement).toHaveBeenCalledWith(ownerId, "m1", { category: "gastos hormiga" });
  });

  it("disambiguates a repeated amount by an exact note match", async () => {
    const { corrector, updateMovement } = makeCorrector({
      movements: [
        movement("m-super", 2500, "super", HOT),
        movement("m-uber", 2500, "uber", HOT),
      ],
    });

    const result = await corrector.correct(ownerId, { amount: 2500, note: "uber" }, "gastos hormiga", NOW);

    expect(result.status).toBe("reassigned");
    if (result.status === "reassigned") {
      expect(result.movement.id).toBe("m-uber");
    }
    expect(updateMovement).toHaveBeenCalledWith(ownerId, "m-uber", { category: "gastos hormiga" });
  });

  it("disambiguates a repeated amount by a partial note match", async () => {
    const { corrector, updateMovement } = makeCorrector({
      movements: [
        movement("m-viaje", 2500, "uber viaje aeropuerto", HOT),
        movement("m-super", 2500, "super", HOT),
      ],
    });

    const result = await corrector.correct(ownerId, { amount: 2500, note: "uber" }, "gastos hormiga", NOW);

    expect(result.status).toBe("reassigned");
    if (result.status === "reassigned") {
      expect(result.movement.id).toBe("m-viaje");
    }
    expect(updateMovement).toHaveBeenCalledWith(ownerId, "m-viaje", { category: "gastos hormiga" });
  });

  it("asks which movement when a repeated amount has no note and both are equally recent", async () => {
    const { corrector, updateMovement } = makeCorrector({
      movements: [
        movement("m1", 2500, "super", HOT),
        movement("m2", 2500, "uber", HOT),
      ],
    });

    const result = await corrector.correct(ownerId, { amount: 2500, note: null }, "gastos hormiga", NOW);

    expect(result.status).toBe("ask");
    if (result.status === "ask") {
      expect(result.reason).toBe("ambiguous");
      expect(result.category).toBe("gastos hormiga");
      expect(result.candidates.map((candidate) => candidate.id)).toEqual(["m1", "m2"]);
    }
    expect(updateMovement).not.toHaveBeenCalled();
  });

  it("asks when a full tie persists across amount, note and recency buckets", async () => {
    const { corrector, updateMovement } = makeCorrector({
      movements: [
        movement("m1", 2500, "uber", HOT),
        movement("m2", 2500, "uber", HOT),
      ],
    });

    const result = await corrector.correct(ownerId, { amount: 2500, note: "uber" }, "gastos hormiga", NOW);

    expect(result.status).toBe("ask");
    if (result.status === "ask") {
      expect(result.reason).toBe("ambiguous");
      expect(result.candidates).toHaveLength(2);
    }
    expect(updateMovement).not.toHaveBeenCalled();
  });

  it("breaks a full-score tie by recency bucket, reassigning the hot movement", async () => {
    const { corrector, updateMovement } = makeCorrector({
      movements: [
        movement("m-hot", 2500, "uber", HOT),
        movement("m-warm", 2500, "uber", WARM),
      ],
    });

    const result = await corrector.correct(ownerId, { amount: 2500, note: "uber" }, "gastos hormiga", NOW);

    expect(result.status).toBe("reassigned");
    if (result.status === "reassigned") {
      expect(result.movement.id).toBe("m-hot");
    }
    expect(updateMovement).toHaveBeenCalledWith(ownerId, "m-hot", { category: "gastos hormiga" });
  });

  it("replies no_match when the window is empty", async () => {
    const { corrector, updateMovement } = makeCorrector({ movements: [] });

    const result = await corrector.correct(ownerId, { amount: 2500, note: null }, "gastos hormiga", NOW);

    expect(result).toEqual({ status: "no_match" });
    expect(updateMovement).not.toHaveBeenCalled();
  });

  it("replies no_match when the reference matches nothing in the window", async () => {
    const { corrector, updateMovement } = makeCorrector({
      movements: [movement("m1", 2500, "uber", HOT)],
    });

    const result = await corrector.correct(ownerId, { amount: 9999, note: null }, "gastos hormiga", NOW);

    expect(result).toEqual({ status: "no_match" });
    expect(updateMovement).not.toHaveBeenCalled();
  });

  it("asks for a reference when neither amount nor note is given, listing the whole window", async () => {
    const { corrector, updateMovement } = makeCorrector({
      movements: [
        movement("m1", 2500, "super", HOT),
        movement("m2", 900, "pan", WARM),
      ],
    });

    const result = await corrector.correct(ownerId, { amount: null, note: null }, "gastos hormiga", NOW);

    expect(result.status).toBe("ask");
    if (result.status === "ask") {
      expect(result.reason).toBe("no_reference");
      expect(result.candidates.map((candidate) => candidate.id)).toEqual(["m1", "m2"]);
    }
    expect(updateMovement).not.toHaveBeenCalled();
  });

  it("replies no_match for an empty reference over an empty window", async () => {
    const { corrector } = makeCorrector({ movements: [] });

    const result = await corrector.correct(ownerId, { amount: null, note: null }, "gastos hormiga", NOW);

    expect(result).toEqual({ status: "no_match" });
  });

  it("scans only the 10 most recent movements, ignoring older ones", async () => {
    const rows = Array.from({ length: 11 }, (_, index) =>
      movement(`m${index}`, 100 + index, `nota ${index}`, new Date(NOW.getTime() - (index + 1) * 24 * 60 * 60 * 1000)),
    );
    // The oldest movement (index 10) has the only match for 110: outside the window.
    rows[10] = movement("m10", 2500, "viejo", new Date(NOW.getTime() - 11 * 24 * 60 * 60 * 1000));
    const { corrector, updateMovement } = makeCorrector({ movements: rows });

    const result = await corrector.correct(ownerId, { amount: 2500, note: null }, "gastos hormiga", NOW);

    expect(result).toEqual({ status: "no_match" });
    expect(updateMovement).not.toHaveBeenCalled();
  });

  it("auto-creates a missing target category before reassigning (D7)", async () => {
    const { corrector, createCategory, updateMovement } = makeCorrector({
      movements: [movement("m1", 2500, "uber", HOT)],
      categories: [],
    });

    const result = await corrector.correct(ownerId, { amount: 2500, note: null }, "gastos hormiga", NOW);

    expect(createCategory).toHaveBeenCalledWith(ownerId, "gastos hormiga");
    expect(result.status).toBe("reassigned");
    if (result.status === "reassigned") {
      expect(result.category).toBe("gastos hormiga");
    }
    expect(updateMovement).toHaveBeenCalledWith(ownerId, "m1", { category: "gastos hormiga" });
  });

  it("reuses the existing category when the auto-create races a duplicate", async () => {
    const { corrector, createCategory, updateMovement } = makeCorrector({
      movements: [movement("m1", 2500, "uber", HOT)],
      listCategories: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { id: "c-gastos hormiga", ownerId, name: "gastos hormiga", createdAt: new Date(), keywords: [] },
        ]),
      createCategory: async () => {
        throw new ValidationFailedError('Category "gastos hormiga" already exists');
      },
    });

    const result = await corrector.correct(ownerId, { amount: 2500, note: null }, "gastos hormiga", NOW);

    expect(result.status).toBe("reassigned");
    if (result.status === "reassigned") {
      expect(result.category).toBe("gastos hormiga");
    }
    expect(updateMovement).toHaveBeenCalledWith(ownerId, "m1", { category: "gastos hormiga" });
    expect(createCategory).toHaveBeenCalledWith(ownerId, "gastos hormiga");
  });

  it("surfaces a missing movement as status missing when updateMovement throws NotFoundError", async () => {
    const { corrector, updateMovement } = makeCorrector({
      movements: [movement("m1", 2500, "uber", HOT)],
      updateMovement: async () => {
        throw new NotFoundError("Movement m1 not found");
      },
    });

    const result = await corrector.correct(ownerId, { amount: 2500, note: null }, "gastos hormiga", NOW);

    expect(result).toEqual({ status: "missing" });
    expect(updateMovement).toHaveBeenCalledWith(ownerId, "m1", { category: "gastos hormiga" });
  });

  it("never touches category creation when the match succeeds against an existing category", async () => {
    const { corrector, createCategory } = makeCorrector({
      movements: [movement("m1", 2500, "uber", HOT)],
      categories: ["gastos hormiga"],
    });

    await corrector.correct(ownerId, { amount: 2500, note: null }, "gastos hormiga", NOW);

    expect(createCategory).not.toHaveBeenCalled();
  });
});