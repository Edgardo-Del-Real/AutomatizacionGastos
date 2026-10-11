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

describe("MovementLifecycleExecutor.pendingWindow (v2)", () => {
  it("lists only the owner's PENDING EXPENSE movements, 10 max", async () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      movement(
        `m${index}`,
        100 + index,
        `nota-${index}`,
        new Date(RECENT.getTime() - index * 60_000),
        "cat",
        index % 2 === 0 ? "PENDING" : "PAID",
      ),
    );
    const { executor, listMovements } = makeExecutor({ movements: rows });

    const window = await executor.pendingWindow(ownerId);

    // 12 rows, 6 PENDING → only PENDING rows appear.
    expect(window).toHaveLength(6);
    expect(window.every((candidate) => Number(candidate.id.slice(1)) % 2 === 0)).toBe(true);
    expect(listMovements).toHaveBeenCalledWith(
      { viewerId: ownerId, partnerId: null, visibility: "mine" },
      {},
    );
  });

  it("caps the pending window at 10 rows", async () => {
    const rows = Array.from({ length: 14 }, (_, index) =>
      movement(`m${index}`, 100 + index, `nota-${index}`, new Date(RECENT.getTime() - index * 60_000), "cat", "PENDING"),
    );
    const { executor } = makeExecutor({ movements: rows });

    const window = await executor.pendingWindow(ownerId);

    expect(window).toHaveLength(10);
    expect(window[0]?.id).toBe("m0");
  });

  it("returns an empty window when nothing is pending", async () => {
    const { executor } = makeExecutor({ movements: [] });

    const window = await executor.pendingWindow(ownerId);

    expect(window).toHaveLength(0);
  });
});

describe("MovementLifecycleExecutor.deleteWindow (D10)", () => {
  it("returns the 10-row all-movements window for the delete picker", async () => {
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