import { describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError, ValidationFailedError } from "../../infra/errors";
import type { CategoryService } from "../categories/categories.service";
import { MovementService } from "./movements.service";
import type { MovementRepository } from "./movements.repository";
import type { ViewerScope } from "./movements.types";

const ritaScope: ViewerScope = { viewerId: "rita", partnerId: "edgardo", visibility: "all" };
const edgardoScope: ViewerScope = { viewerId: "edgardo", partnerId: "rita", visibility: "mine" };

function makeHarness() {
  const repository = {
    updateById: vi.fn(async () => ({
      id: "m1",
      ownerId: "default",
      amount: 100,
      currency: "ARS",
      category: null,
      note: null,
      occurredAt: new Date("2026-09-01T12:00:00.000Z"),
      createdAt: new Date("2026-09-01T12:00:00.000Z"),
      type: "EXPENSE" as const,
    })),
    findById: vi.fn(async () => ({
      id: "m1",
      ownerId: "default",
      amount: 100,
      currency: "ARS",
      category: null,
      note: null,
      occurredAt: new Date("2026-09-01T12:00:00.000Z"),
      createdAt: new Date("2026-09-01T12:00:00.000Z"),
      type: "EXPENSE" as const,
    })),
  } as unknown as MovementRepository;
  const categoryService = {
    assertOwnerCategory: vi.fn(async () => undefined),
  } as unknown as CategoryService;
  const service = new MovementService(repository, categoryService);
  return {
    service,
    repository,
    categoryService,
    mockUpdateById: vi.mocked(repository.updateById),
    mockAssertOwnerCategory: vi.mocked(categoryService.assertOwnerCategory),
  };
}

describe("MovementService.updateMovement", () => {
  it("applies a valid patch and returns the updated movement", async () => {
    const { service, repository, mockUpdateById } = makeHarness();

    const result = await service.updateMovement("default", "m1", { note: "cena" });

    expect(mockUpdateById).toHaveBeenCalledWith("m1", "default", { note: "cena" });
    expect(result.id).toBe("m1");
    expect(repository).toBeDefined();
  });

  it("passes category: null through to clear the category without owner validation", async () => {
    const { service, mockUpdateById, mockAssertOwnerCategory } = makeHarness();

    await service.updateMovement("default", "m1", { category: null });

    expect(mockUpdateById).toHaveBeenCalledWith("m1", "default", { category: null });
    expect(mockAssertOwnerCategory).not.toHaveBeenCalled();
  });

  it("validates a string category against the owner's set (D12) with the movement type (D9)", async () => {
    const { service, mockAssertOwnerCategory } = makeHarness();

    await service.updateMovement("default", "m1", { category: "Cafe" });

    expect(mockAssertOwnerCategory).toHaveBeenCalledWith("default", "Cafe", "EXPENSE");
  });

  it("rejects assigning the SAVINGS category to an EXPENSE movement with 422", async () => {
    const { service, mockAssertOwnerCategory } = makeHarness();
    mockAssertOwnerCategory.mockRejectedValue(new ValidationFailedError("savings forbidden"));

    await expect(service.updateMovement("default", "m1", { category: "ahorro" })).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
    expect(mockAssertOwnerCategory).toHaveBeenCalledWith("default", "ahorro", "EXPENSE");
  });

  it("throws NotFound when the movement does not exist before category validation", async () => {
    const { service, mockUpdateById, mockAssertOwnerCategory } = makeHarness();
    const repository = (service as unknown as { repository: { findById: ReturnType<typeof vi.fn> } }).repository;
    repository.findById.mockResolvedValue(null);

    await expect(service.updateMovement("default", "m1", { category: "Cafe" })).rejects.toBeInstanceOf(NotFoundError);
    expect(mockAssertOwnerCategory).not.toHaveBeenCalled();
    expect(mockUpdateById).not.toHaveBeenCalled();
  });

  it("rejects a category that is not the owner's with 422", async () => {
    const { service, mockAssertOwnerCategory } = makeHarness();
    mockAssertOwnerCategory.mockRejectedValue(new ValidationFailedError("not owner"));

    await expect(service.updateMovement("default", "m1", { category: "Cafe" })).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
  });

  it("rejects an empty patch with 422", async () => {
    const { service } = makeHarness();

    await expect(service.updateMovement("default", "m1", {})).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
  });

  it("rejects a non-positive amount with 422", async () => {
    const { service } = makeHarness();

    await expect(service.updateMovement("default", "m1", { amount: 0 })).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
  });

  it("rejects a patch containing only excluded fields (type/occurredAt)", async () => {
    const { service } = makeHarness();

    await expect(service.updateMovement("default", "m1", { type: "INCOME" })).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
  });

  it("throws NotFound when the movement does not exist", async () => {
    const { service, mockUpdateById } = makeHarness();
    mockUpdateById.mockResolvedValue(null);

    await expect(service.updateMovement("default", "m1", { note: "x" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("MovementService.listMovements", () => {
  function makeListHarness() {
    const repository = {
      listByOwner: vi.fn(async () => []),
    } as unknown as MovementRepository;
    const service = new MovementService(repository, {} as CategoryService);
    return { service, listByOwner: vi.mocked(repository.listByOwner) };
  }

  it("forwards the viewer scope and the filters to the repository (mine vs all)", async () => {
    const { service, listByOwner } = makeListHarness();

    await service.listMovements(edgardoScope, { type: "EXPENSE" });

    expect(listByOwner).toHaveBeenCalledWith(edgardoScope, { type: "EXPENSE" });
  });

  it("forwards an all-scope with the partner for the default visibility", async () => {
    const { service, listByOwner } = makeListHarness();

    await service.listMovements(ritaScope, {});

    expect(listByOwner).toHaveBeenCalledWith(ritaScope, {});
  });
});

describe("MovementService.getSummary", () => {
  function makeSummaryHarness() {
    const repository = {
      summaryKpis: vi.fn(),
      summaryMonths: vi.fn(async () => []),
      summaryDaily: vi.fn(async () => []),
      summaryCategories: vi.fn(async () => []),
      topByType: vi.fn(async () => []),
      summarySavings: vi.fn(async () => 0),
      summaryPlanned: vi.fn(async () => ({ month: "2099-01", total: 0 })),
    } as unknown as MovementRepository;
    const service = new MovementService(repository, {} as CategoryService);
    return {
      service,
      summaryKpis: vi.mocked(repository.summaryKpis),
      summaryMonths: vi.mocked(repository.summaryMonths),
      summaryDaily: vi.mocked(repository.summaryDaily),
      summaryCategories: vi.mocked(repository.summaryCategories),
      topByType: vi.mocked(repository.topByType),
      summarySavings: vi.mocked(repository.summarySavings),
      summaryPlanned: vi.mocked(repository.summaryPlanned),
    };
  }

  it("threads the viewer scope into every repository feed", async () => {
    const { service, summaryKpis, summaryMonths, summaryDaily, summaryCategories, topByType, summarySavings } =
      makeSummaryHarness();
    summaryKpis.mockResolvedValue({
      income: 3000,
      expenses: 1000,
      count: 3,
      maxAmount: 1200,
      monthsWithData: 2,
    });
    summaryKpis.mockResolvedValueOnce({
      income: 1000,
      expenses: 400,
      count: 2,
      maxAmount: 500,
      monthsWithData: 1,
    });

    await service.getSummary(ritaScope);

    expect(summaryKpis).toHaveBeenNthCalledWith(1, ritaScope, { from: undefined, to: undefined });
    expect(summaryKpis).toHaveBeenNthCalledWith(2, ritaScope, expect.any(Object));
    expect(summarySavings).toHaveBeenCalledWith(ritaScope, expect.any(Object));
    expect(summaryMonths).toHaveBeenCalledWith(ritaScope);
    expect(summaryDaily).toHaveBeenCalledWith(ritaScope);
    expect(summaryCategories).toHaveBeenCalledWith(ritaScope, { from: undefined, to: undefined });
    expect(topByType).toHaveBeenCalledWith(ritaScope, "EXPENSE", 5, { from: undefined, to: undefined });
    expect(topByType).toHaveBeenCalledWith(ritaScope, "INCOME", 5, { from: undefined, to: undefined });
  });

  it("exposes countThisMonth from a current-month summaryKpis call alongside the all-time kpis", async () => {
    const { service, summaryKpis } = makeSummaryHarness();
    summaryKpis.mockResolvedValueOnce({
      income: 3000,
      expenses: 1000,
      count: 3,
      maxAmount: 1200,
      monthsWithData: 2,
    });
    summaryKpis.mockResolvedValueOnce({
      income: 1000,
      expenses: 400,
      count: 2,
      maxAmount: 500,
      monthsWithData: 1,
    });

    const summary = await service.getSummary(ritaScope);

    expect(summaryKpis).toHaveBeenCalledTimes(2);
    expect(summary.kpis.count).toBe(3);
    expect(summary.kpis.countThisMonth).toBe(2);
    expect(summary.kpis.savings).toBe(0);

    // The second call is scoped to the current Buenos Aires month: from the 1st
    // to the last day of that month, derived from the month key in `from`.
    const thisMonthPeriod = summaryKpis.mock.calls[1]?.[1] as { from: string; to: string };
    const match = /^(\d{4})-(\d{2})-01$/.exec(thisMonthPeriod.from);
    expect(match).not.toBeNull();
    const lastDay = new Date(Date.UTC(Number(match![1]), Number(match![2]), 0)).getUTCDate();
    expect(thisMonthPeriod.to).toBe(
      `${thisMonthPeriod.from.slice(0, 7)}-${String(lastDay).padStart(2, "0")}`,
    );
  });

  it("threads the planned block from the next Buenos Aires month into the summary", async () => {
    const { service, summaryKpis, summaryPlanned } = makeSummaryHarness();
    summaryKpis.mockResolvedValue({
      income: 0,
      expenses: 0,
      count: 0,
      maxAmount: 0,
      monthsWithData: 0,
    });
    summaryPlanned.mockResolvedValue({ month: "2099-01", total: 4000 });

    const summary = await service.getSummary(ritaScope);

    // The planned target is the month after the current Buenos Aires month,
    // derived with the same BA wall clock as the service's month keys.
    const baNow = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const next = new Date(Date.UTC(baNow.getUTCFullYear(), baNow.getUTCMonth() + 1, 1));
    const expectedKey = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
    expect(summaryPlanned).toHaveBeenCalledWith(ritaScope, expectedKey);
    expect(summary.planned).toEqual({ month: "2099-01", total: 4000 });
  });
});

describe("MovementService.markMovementPaid", () => {
  function makeMarkPaidHarness() {
    const movement = {
      id: "m1",
      ownerId: "default",
      amount: 2500,
      currency: "ARS",
      category: "rent",
      note: "alquiler",
      occurredAt: new Date(),
      createdAt: new Date(),
      type: "EXPENSE" as const,
      status: "PAID" as const,
    };
    const repository = {
      markPaidById: vi.fn(),
      findById: vi.fn(),
    } as unknown as MovementRepository;
    const service = new MovementService(repository, {} as CategoryService);
    return {
      service,
      movement,
      markPaidById: vi.mocked(repository.markPaidById),
      findById: vi.mocked(repository.findById),
    };
  }

  it("returns the paid movement when the guarded update succeeds", async () => {
    const { service, movement, markPaidById, findById } = makeMarkPaidHarness();
    markPaidById.mockResolvedValue(movement);

    const result = await service.markMovementPaid("default", "m1");

    expect(markPaidById).toHaveBeenCalledWith("m1", "default");
    expect(findById).not.toHaveBeenCalled();
    expect(result.status).toBe("PAID");
  });

  it("throws NotFound when the movement does not exist for the owner", async () => {
    const { service, markPaidById, findById } = makeMarkPaidHarness();
    markPaidById.mockResolvedValue(null);
    findById.mockResolvedValue(null);

    await expect(service.markMovementPaid("default", "m1")).rejects.toBeInstanceOf(NotFoundError);
    expect(findById).toHaveBeenCalledWith("m1", "default");
  });

  it("throws Conflict when the movement exists but is not a PENDING EXPENSE", async () => {
    const { service, movement, markPaidById, findById } = makeMarkPaidHarness();
    markPaidById.mockResolvedValue(null);
    findById.mockResolvedValue(movement);

    await expect(service.markMovementPaid("default", "m1")).rejects.toBeInstanceOf(ConflictError);
  });
});