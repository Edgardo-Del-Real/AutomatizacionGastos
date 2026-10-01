import { describe, expect, it, vi } from "vitest";
import type { MovementService } from "../movements/movements.service";
import { MovementCorrector } from "./movement-corrector";

type MockedMovementService = {
  listMovements: ReturnType<typeof vi.fn>;
};

function makeService(): MockedMovementService {
  return { listMovements: vi.fn(async () => []) };
}

function movement(overrides: {
  id: string;
  amount: number;
  note: string | null;
  occurredAt: Date;
  type?: "EXPENSE" | "INCOME" | "SAVINGS";
  status?: "PENDING" | "PAID";
}): {
  id: string;
  amount: number;
  note: string | null;
  occurredAt: Date;
  type: string;
  status: string;
  category: string | null;
} {
  return {
    id: overrides.id,
    amount: overrides.amount,
    note: overrides.note,
    occurredAt: overrides.occurredAt,
    type: overrides.type ?? "EXPENSE",
    status: overrides.status ?? "PAID",
    category: "Cafe",
  };
}

describe("MovementCorrector.correctionWindow (v2)", () => {
  it("lists the 10 most recent non-PENDING movements as candidates", async () => {
    const service = makeService();
    const rows = Array.from({ length: 12 }, (_, index) =>
      movement({
        id: `m${index}`,
        amount: 100 + index,
        note: `nota ${index}`,
        occurredAt: new Date(Date.UTC(2026, 8, 12 - index, 12)),
      }),
    );
    service.listMovements.mockResolvedValue(rows);
    const corrector = new MovementCorrector(service as unknown as MovementService);

    const window = await corrector.correctionWindow("owner-1");

    expect(window).toHaveLength(10);
    expect(window[0]?.id).toBe("m0");
    expect(window[9]?.id).toBe("m9");
    expect(window[0]).toEqual({
      id: "m0",
      amount: 100,
      note: "nota 0",
      date: "2026-09-12",
      type: "EXPENSE",
    });
  });

  it("excludes PENDING rows from the window (planned expenses are not correctable)", async () => {
    const service = makeService();
    service.listMovements.mockResolvedValue([
      movement({ id: "paid-1", amount: 500, note: "alquiler", occurredAt: new Date("2026-09-10T12:00:00Z"), status: "PAID" }),
      movement({ id: "pending-1", amount: 2500, note: "gym", occurredAt: new Date("2026-09-09T12:00:00Z"), status: "PENDING" }),
      movement({ id: "paid-2", amount: 300, note: "cafe", occurredAt: new Date("2026-09-08T12:00:00Z"), status: "PAID" }),
    ]);
    const corrector = new MovementCorrector(service as unknown as MovementService);

    const window = await corrector.correctionWindow("owner-1");

    expect(window.map((candidate) => candidate.id)).toEqual(["paid-1", "paid-2"]);
  });

  it("returns an empty window when the owner has no movements", async () => {
    const service = makeService();
    service.listMovements.mockResolvedValue([]);
    const corrector = new MovementCorrector(service as unknown as MovementService);

    const window = await corrector.correctionWindow("owner-1");

    expect(window).toEqual([]);
  });
});