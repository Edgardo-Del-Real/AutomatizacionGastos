import { describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError } from "../../infra/errors";
import type { ExpenseService } from "../expenses/expenses.service";
import type { MovementService } from "../movements/movements.service";
import { MovementLifecycleExecutor } from "./movement-lifecycle-executor";

const ownerId = "default";

type MovementFixture = {
  id: string;
  amount: number;
  note: string | null;
  occurredAt: Date;
  category: string;
  status?: "PENDING" | "PAID";
  type?: "EXPENSE" | "INCOME" | "SAVINGS";
};

function movement(
  id: string,
  amount: number,
  note: string | null,
  occurredAt: Date,
  category: string,
  status: "PENDING" | "PAID" = "PAID",
  type: "EXPENSE" | "INCOME" | "SAVINGS" = "EXPENSE",
): MovementFixture {
  return { id, amount, note, occurredAt, category, status, type };
}

function toMovement(row: MovementFixture) {
  return {
    id: row.id,
    ownerId,
    amount: row.amount,
    currency: "ARS",
    category: row.category,
    note: row.note,
    occurredAt: row.occurredAt,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    type: row.type ?? "EXPENSE",
    status: row.status ?? "PAID",
  };
}

function makeExecutor(overrides?: {
  movements?: MovementFixture[];
  markMovementPaid?: (id: string) => Promise<unknown>;
  deleteExpense?: (id: string) => Promise<unknown>;
}) {
  const rows = overrides?.movements ?? [];
  const listMovements = vi.fn(async () => rows.map(toMovement));
  const markMovementPaid = vi.fn(
    overrides?.markMovementPaid ??
      (async (id: string) => ({
        id,
        ownerId,
        amount: 100,
        currency: "ARS",
        category: null,
        note: null,
        occurredAt: new Date(),
        createdAt: new Date(),
        type: "EXPENSE" as const,
        status: "PAID" as const,
      })),
  );
  const deleteExpense = vi.fn(overrides?.deleteExpense ?? (async () => undefined));
  const movementService = { listMovements, markMovementPaid } as unknown as MovementService;
  const expenseService = { deleteExpense } as unknown as ExpenseService;
  const executor = new MovementLifecycleExecutor({ movementService, expenseService });
  return { executor, listMovements, markMovementPaid, deleteExpense };
}

const RECENT = new Date("2026-09-19T12:00:00.000Z");
const OLDER = new Date("2026-09-10T12:00:00.000Z");

describe("MovementLifecycleExecutor.markPaid", () => {
  it("marks the unique PENDING expense that matches a category cue, replying once with the executed facts", async () => {
    const { executor, markMovementPaid } = makeExecutor({
      movements: [movement("m1", 2500, "alquiler", RECENT, "alquiler", "PENDING")],
    });

    const result = await executor.markPaid(ownerId, { category: "alquiler", amount: null });

    expect(markMovementPaid).toHaveBeenCalledWith(ownerId, "m1");
    expect(result).toMatchObject({ status: "executed", action: "marked_paid" });
    if (result.status === "executed") {
      expect(result.movement.id).toBe("m1");
      expect(result.movement.amount).toBe(2500);
      expect(result.movement.category).toBe("alquiler");
    }
  });

  it("marks the unique PENDING expense that matches an amount cue", async () => {
    const { executor, markMovementPaid } = makeExecutor({
      movements: [movement("m1", 2500, "alquiler", RECENT, "alquiler", "PENDING")],
    });

    const result = await executor.markPaid(ownerId, { category: null, amount: 2500 });

    expect(markMovementPaid).toHaveBeenCalledWith(ownerId, "m1");
    expect(result).toMatchObject({ status: "executed", action: "marked_paid" });
  });

  it("resolves a folded category cue: 'alquileres' matches the PENDING 'alquiler' expense", async () => {
    const { executor, markMovementPaid } = makeExecutor({
      movements: [movement("m1", 2500, "alquiler", RECENT, "Alquiler", "PENDING")],
    });

    const result = await executor.markPaid(ownerId, { category: "alquileres", amount: null });

    expect(markMovementPaid).toHaveBeenCalledWith(ownerId, "m1");
    expect(result).toMatchObject({ status: "executed", action: "marked_paid" });
  });

  it("uses the unique most-recent PENDING expense when no cues are given ('ya lo pagué')", async () => {
    const { executor, markMovementPaid } = makeExecutor({
      movements: [
        movement("m1", 2500, "alquiler", RECENT, "alquiler", "PENDING"),
        movement("m2", 3000, "gym", OLDER, "gym", "PENDING"),
      ],
    });

    const result = await executor.markPaid(ownerId, { category: null, amount: null });

    expect(markMovementPaid).toHaveBeenCalledWith(ownerId, "m1");
    expect(result).toMatchObject({ status: "executed", action: "marked_paid" });
  });

  it("asks which PENDING expense was paid when two share the same category cue (recency never breaks a cue tie)", async () => {
    const { executor, markMovementPaid } = makeExecutor({
      movements: [
        movement("m1", 2500, "alquiler", RECENT, "alquiler", "PENDING"),
        movement("m2", 2500, "expensas", OLDER, "alquiler", "PENDING"),
      ],
    });

    const result = await executor.markPaid(ownerId, { category: "alquiler", amount: null });

    expect(markMovementPaid).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "ask" });
    if (result.status === "ask") {
      expect(result.candidates.map((candidate) => candidate.id)).toEqual(["m1", "m2"]);
    }
  });

  it("asks which PENDING expense was paid when two share the same amount cue", async () => {
    const { executor, markMovementPaid } = makeExecutor({
      movements: [
        movement("m1", 2500, "alquiler", RECENT, "alquiler", "PENDING"),
        movement("m2", 2500, "expensas", OLDER, "expensas", "PENDING"),
      ],
    });

    const result = await executor.markPaid(ownerId, { category: null, amount: 2500 });

    expect(markMovementPaid).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "ask" });
  });

  it("asks when the two most-recent PENDING expenses tie on occurredAt with no cues", async () => {
    const { executor, markMovementPaid } = makeExecutor({
      movements: [
        movement("m1", 2500, "alquiler", RECENT, "alquiler", "PENDING"),
        movement("m2", 3000, "gym", RECENT, "gym", "PENDING"),
      ],
    });

    const result = await executor.markPaid(ownerId, { category: null, amount: null });

    expect(markMovementPaid).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "ask" });
  });

  it("replies nothing_pending when no PENDING expense exists and no paid fallback matches", async () => {
    const { executor, markMovementPaid } = makeExecutor({ movements: [] });

    const result = await executor.markPaid(ownerId, { category: "alquiler", amount: null });

    expect(markMovementPaid).not.toHaveBeenCalled();
    expect(result.status).toBe("nothing_pending");
  });

  it("reports already_paid when the unique PENDING match is raced by a 409 (already marked)", async () => {
    const { executor } = makeExecutor({
      movements: [movement("m1", 2500, "alquiler", RECENT, "alquiler", "PENDING")],
      markMovementPaid: async () => {
        throw new ConflictError("Movement m1 is not a PENDING EXPENSE");
      },
    });

    const result = await executor.markPaid(ownerId, { category: "alquiler", amount: null });

    expect(result).toMatchObject({ status: "already_paid" });
    if (result.status === "already_paid") {
      expect(result.movement.id).toBe("m1");
    }
  });

  it("reports already_paid via the PAID-window fallback: no PENDING matches, a unique PAID expense does (D4)", async () => {
    const { executor, markMovementPaid } = makeExecutor({
      movements: [movement("m1", 2500, "alquiler", RECENT, "alquiler", "PAID")],
      markMovementPaid: async () => {
        throw new ConflictError("Movement m1 is not a PENDING EXPENSE");
      },
    });

    const result = await executor.markPaid(ownerId, { category: "alquiler", amount: null });

    expect(markMovementPaid).toHaveBeenCalledWith(ownerId, "m1");
    expect(result).toMatchObject({ status: "already_paid" });
  });

  it("reports missing when the referenced movement disappeared (404)", async () => {
    const { executor } = makeExecutor({
      movements: [movement("m1", 2500, "alquiler", RECENT, "alquiler", "PENDING")],
      markMovementPaid: async () => {
        throw new NotFoundError("Movement m1 not found");
      },
    });

    const result = await executor.markPaid(ownerId, { category: "alquiler", amount: null });

    expect(result.status).toBe("missing");
  });

  it("considers only the 10 most recent PENDING expenses, ignoring older matches", async () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      movement(`m${index}`, 2500, `nota-${index}`, new Date(RECENT.getTime() - index * 60_000), "alquiler", "PENDING"),
    );
    const { executor, markMovementPaid } = makeExecutor({ movements: rows });

    // The 12th (oldest) PENDING expense falls outside the 10-row window.
    const result = await executor.markPaid(ownerId, { category: "alquiler", amount: null });

    expect(result.status).toBe("ask");
    if (result.status === "ask") {
      expect(result.candidates).toHaveLength(10);
      expect(result.candidates[0]?.id).toBe("m0");
      expect(result.candidates.some((candidate) => candidate.id === "m11")).toBe(false);
      expect(markMovementPaid).not.toHaveBeenCalled();
    }
  });

  it("scopes the movement list to the owner's own rows (mine-scope, no partner)", async () => {
    const { executor, listMovements } = makeExecutor({
      movements: [movement("m1", 2500, "alquiler", RECENT, "alquiler", "PENDING")],
    });

    await executor.markPaid(ownerId, { category: "alquiler", amount: null });

    expect(listMovements).toHaveBeenCalledWith(
      { viewerId: ownerId, partnerId: null, visibility: "mine" },
      {},
    );
  });

  it("excludes PAID and INCOME rows from the PENDING window even when they match the cues", async () => {
    const { executor, markMovementPaid } = makeExecutor({
      movements: [
        movement("m1", 2500, "alquiler", RECENT, "alquiler", "PAID"),
        movement("m2", 2500, "alquiler", RECENT, "alquiler", "PENDING", "INCOME"),
      ],
      markMovementPaid: async () => {
        throw new ConflictError("Movement m1 is not a PENDING EXPENSE");
      },
    });

    const result = await executor.markPaid(ownerId, { category: "alquiler", amount: null });

    // Neither row is a PENDING EXPENSE: the PAID-window fallback finds the PAID
    // row and surfaces the 409 conflict instead of guessing.
    expect(markMovementPaid).toHaveBeenCalledWith(ownerId, "m1");
    expect(result).toMatchObject({ status: "already_paid" });
  });
});

describe("MovementLifecycleExecutor.delete (D6 resolve-only)", () => {
  it("resolves the unique most-recent movement to a gated candidate without deleting (spec: Single candidate becomes the gated target)", async () => {
    const { executor, deleteExpense } = makeExecutor({
      movements: [movement("m1", 8000, "super", RECENT, "super")],
    });

    const result = await executor.delete(ownerId, { category: null, amount: null });

    expect(deleteExpense).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "gated" });
    if (result.status === "gated") {
      expect(result.candidate.id).toBe("m1");
      expect(result.candidate.amount).toBe(8000);
    }
  });

  it("resolves the movement matching a category cue to a gated candidate ('borra el de cafe')", async () => {
    const { executor, deleteExpense } = makeExecutor({
      movements: [
        movement("m1", 1500, "cafe", RECENT, "Cafe"),
        movement("m2", 8000, "super", OLDER, "Supermercado"),
      ],
    });

    const result = await executor.delete(ownerId, { category: "cafe", amount: null });

    expect(deleteExpense).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "gated" });
    if (result.status === "gated") {
      expect(result.candidate.id).toBe("m1");
    }
  });

  it("still asks which movement when two match the amount cue", async () => {
    const { executor, deleteExpense } = makeExecutor({
      movements: [
        movement("m1", 8000, "super", RECENT, "super"),
        movement("m2", 8000, "feria", OLDER, "feria"),
      ],
    });

    const result = await executor.delete(ownerId, { category: null, amount: 8000 });

    expect(deleteExpense).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "ask" });
    if (result.status === "ask") {
      expect(result.candidates.map((candidate) => candidate.id)).toEqual(["m1", "m2"]);
    }
  });

  it("replies no_match when nothing matches the cues and nothing is deleted", async () => {
    const { executor, deleteExpense } = makeExecutor({
      movements: [movement("m1", 8000, "super", RECENT, "super")],
    });

    const result = await executor.delete(ownerId, { category: "no-existe", amount: null });

    expect(deleteExpense).not.toHaveBeenCalled();
    expect(result.status).toBe("no_match");
  });
});

describe("MovementLifecycleExecutor.deleteWindow (D10)", () => {
  it("returns the 10-row all-movements window for the menu delete picker", async () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      movement(`m${index}`, 100 + index, `nota-${index}`, new Date(RECENT.getTime() - index * 60_000), "cat"),
    );
    const { executor, listMovements } = makeExecutor({ movements: rows });

    const window = await executor.deleteWindow(ownerId);

    expect(window).toHaveLength(10);
    expect(window[0]?.id).toBe("m0");
    expect(window.some((candidate) => candidate.id === "m11")).toBe(false);
    expect(listMovements).toHaveBeenCalledWith(
      { viewerId: ownerId, partnerId: null, visibility: "mine" },
      {},
    );
  });

  it("returns an empty window when the owner has no movements", async () => {
    const { executor } = makeExecutor({ movements: [] });

    const window = await executor.deleteWindow(ownerId);

    expect(window).toHaveLength(0);
  });
});

describe("MovementLifecycleExecutor.markPaidById / deleteById", () => {
  it("marks the picked candidate paid and returns the executed facts", async () => {
    const { executor, markMovementPaid } = makeExecutor();
    const candidate = {
      id: "m1",
      amount: 2500,
      note: "alquiler",
      date: "2026-09-19",
      category: "alquiler",
      occurredAtMs: RECENT.getTime(),
    };

    const result = await executor.markPaidById(ownerId, candidate);

    expect(markMovementPaid).toHaveBeenCalledWith(ownerId, "m1");
    expect(result).toMatchObject({ status: "executed", action: "marked_paid" });
  });

  it("maps a 409 from the selection pick to already_paid", async () => {
    const { executor } = makeExecutor({
      markMovementPaid: async () => {
        throw new ConflictError("Movement m1 is not a PENDING EXPENSE");
      },
    });
    const candidate = {
      id: "m1",
      amount: 2500,
      note: "alquiler",
      date: "2026-09-19",
      category: "alquiler",
      occurredAtMs: RECENT.getTime(),
    };

    const result = await executor.markPaidById(ownerId, candidate);

    expect(result).toMatchObject({ status: "already_paid" });
  });

  it("maps a 404 from the selection pick to missing", async () => {
    const { executor } = makeExecutor({
      markMovementPaid: async () => {
        throw new NotFoundError("Movement m1 not found");
      },
    });
    const candidate = {
      id: "m1",
      amount: 2500,
      note: "alquiler",
      date: "2026-09-19",
      category: "alquiler",
      occurredAtMs: RECENT.getTime(),
    };

    const result = await executor.markPaidById(ownerId, candidate);

    expect(result.status).toBe("missing");
  });

  it("deletes the picked candidate and returns the executed facts", async () => {
    const { executor, deleteExpense } = makeExecutor();
    const candidate = {
      id: "m1",
      amount: 8000,
      note: "super",
      date: "2026-09-18",
      category: "super",
      occurredAtMs: RECENT.getTime(),
    };

    const result = await executor.deleteById(ownerId, candidate);

    expect(deleteExpense).toHaveBeenCalledWith("m1", ownerId);
    expect(result).toMatchObject({ status: "executed", action: "deleted_movement" });
  });

  it("maps a 404 from the selection pick delete to missing", async () => {
    const { executor } = makeExecutor({
      deleteExpense: async () => {
        throw new NotFoundError("Expense m1 not found");
      },
    });
    const candidate = {
      id: "m1",
      amount: 8000,
      note: "super",
      date: "2026-09-18",
      category: "super",
      occurredAtMs: RECENT.getTime(),
    };

    const result = await executor.deleteById(ownerId, candidate);

    expect(result.status).toBe("missing");
  });
});