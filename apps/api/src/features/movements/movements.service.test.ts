import { describe, expect, it, vi } from "vitest";
import { NotFoundError, ValidationFailedError } from "../../infra/errors";
import type { CategoryService } from "../categories/categories.service";
import { MovementService } from "./movements.service";
import type { MovementRepository } from "./movements.repository";

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

  it("validates a string category against the owner's set (D12)", async () => {
    const { service, mockAssertOwnerCategory } = makeHarness();

    await service.updateMovement("default", "m1", { category: "Cafe" });

    expect(mockAssertOwnerCategory).toHaveBeenCalledWith("default", "Cafe");
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

describe("MovementService.getSummary", () => {
  function makeSummaryHarness() {
    const repository = {
      summaryKpis: vi.fn(),
      summaryMonths: vi.fn(async () => []),
      summaryDaily: vi.fn(async () => []),
      summaryCategories: vi.fn(async () => []),
      topByType: vi.fn(async () => []),
    } as unknown as MovementRepository;
    const service = new MovementService(repository, {} as CategoryService);
    return { service, summaryKpis: vi.mocked(repository.summaryKpis) };
  }

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

    const summary = await service.getSummary("default");

    expect(summaryKpis).toHaveBeenCalledTimes(2);
    expect(summaryKpis).toHaveBeenNthCalledWith(1, "default", { from: undefined, to: undefined });
    expect(summary.kpis.count).toBe(3);
    expect(summary.kpis.countThisMonth).toBe(2);

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
});