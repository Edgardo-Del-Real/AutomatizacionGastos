import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError, ValidationFailedError } from "../../infra/errors";
import type { CategoryService } from "../categories/categories.service";
import type { ExpenseRepository } from "./expenses.repository";
import { ExpenseService } from "./expenses.service";
import type { Expense } from "./expenses.types";

const ownerId = "owner-1";

function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: "exp_1",
    ownerId,
    amount: 100,
    currency: "ARS",
    category: null,
    note: null,
    occurredAt: new Date("2026-08-01T12:00:00.000Z"),
    createdAt: new Date("2026-08-01T12:00:01.000Z"),
    ...overrides,
  };
}

describe("ExpenseService", () => {
  let repository: ExpenseRepository;
  let categoryService: CategoryService;
  let service: ExpenseService;
  let mockCreate: ReturnType<typeof vi.fn>;
  let mockFindById: ReturnType<typeof vi.fn>;
  let mockListByOwner: ReturnType<typeof vi.fn>;
  let mockDeleteById: ReturnType<typeof vi.fn>;
  let mockSummarizeByMonth: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    repository = {
      create: vi.fn(),
      findById: vi.fn(),
      listByOwner: vi.fn(),
      deleteById: vi.fn(),
      summarizeByMonth: vi.fn(),
    } as unknown as ExpenseRepository;
    categoryService = {
      ensureAhorro: vi.fn(async () => ({ id: "cat_ahorro" })),
    } as unknown as CategoryService;
    mockCreate = vi.mocked(repository.create);
    mockFindById = vi.mocked(repository.findById);
    mockListByOwner = vi.mocked(repository.listByOwner);
    mockDeleteById = vi.mocked(repository.deleteById);
    mockSummarizeByMonth = vi.mocked(repository.summarizeByMonth);
    service = new ExpenseService(repository, categoryService);
  });

  it("creates an expense via the repository", async () => {
    const input = {
      amount: 250,
      currency: "USD",
      category: "food",
      note: "Lunch",
      occurredAt: new Date("2026-08-01T12:00:00.000Z"),
    };
    const expense = makeExpense({ amount: 250, currency: "USD", category: "food", note: "Lunch" });
    mockCreate.mockResolvedValue(expense);

    const result = await service.createExpense(input, ownerId);

    expect(mockCreate).toHaveBeenCalledWith({ ownerId, ...input, visibility: "INDIVIDUAL" });
    expect(result).toBe(expense);
  });

  it("defaults the currency to ARS when not provided", async () => {
    const input = { amount: 50, occurredAt: new Date("2026-08-01T12:00:00.000Z") };
    mockCreate.mockResolvedValue(makeExpense());

    await service.createExpense(input, ownerId);

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ ownerId, amount: 50, currency: "ARS" }));
  });

  it("persists an out-of-band visibility option as SHARED (AD7)", async () => {
    const input = { amount: 250, occurredAt: new Date("2026-08-01T12:00:00.000Z") };
    mockCreate.mockResolvedValue(makeExpense());

    await service.createExpense(input, ownerId, { visibility: "SHARED" });

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ ownerId, visibility: "SHARED" }));
  });

  it("defaults the visibility to INDIVIDUAL when no option is given", async () => {
    const input = { amount: 250, occurredAt: new Date("2026-08-01T12:00:00.000Z") };
    mockCreate.mockResolvedValue(makeExpense());

    await service.createExpense(input, ownerId);

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ ownerId, visibility: "INDIVIDUAL" }));
  });

  it("rejects an invalid payload with ValidationFailedError and does not call the repository", async () => {
    await expect(
      service.createExpense({ amount: -10, occurredAt: new Date("2026-08-01T12:00:00.000Z") }, ownerId),
    ).rejects.toBeInstanceOf(ValidationFailedError);

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns the expense found by id and owner", async () => {
    const expense = makeExpense({ id: "exp_42" });
    mockFindById.mockResolvedValue(expense);

    const result = await service.getExpense("exp_42", ownerId);

    expect(mockFindById).toHaveBeenCalledWith("exp_42", ownerId);
    expect(result).toBe(expense);
  });

  it("throws NotFoundError when the expense is not found", async () => {
    mockFindById.mockResolvedValue(null);

    await expect(service.getExpense("exp_42", ownerId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws NotFoundError when the expense belongs to another owner", async () => {
    mockFindById.mockResolvedValue(null);

    await expect(service.getExpense("exp_42", "owner-2")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("deletes an expense scoped to the owner via the repository", async () => {
    mockDeleteById.mockResolvedValue(true);

    await service.deleteExpense("exp_42", ownerId);

    expect(mockDeleteById).toHaveBeenCalledWith("exp_42", ownerId);
  });

  it("throws NotFoundError when the expense to delete is not found", async () => {
    mockDeleteById.mockResolvedValue(false);

    await expect(service.deleteExpense("exp_42", ownerId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws NotFoundError when the expense to delete belongs to another owner", async () => {
    mockDeleteById.mockResolvedValue(false);

    await expect(service.deleteExpense("exp_42", "owner-2")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lists all expenses of an owner", async () => {
    const expenses = [makeExpense({ id: "exp_1" }), makeExpense({ id: "exp_2" })];
    mockListByOwner.mockResolvedValue(expenses);

    const result = await service.listExpenses(ownerId);

    expect(mockListByOwner).toHaveBeenCalledWith(ownerId);
    expect(result).toBe(expenses);
  });

  it("returns the monthly summary buckets from the repository", async () => {
    const months = [
      { month: "2026-02", count: 1, totalAmount: 50 },
      { month: "2026-03", count: 3, totalAmount: 7500 },
    ];
    mockSummarizeByMonth.mockResolvedValue(months);

    const result = await service.getSummary(ownerId);

    expect(mockSummarizeByMonth).toHaveBeenCalledWith(ownerId, expect.any(Date));
    expect(result).toEqual({ months });
  });

  it("returns an empty months array when the owner has no expenses in the window", async () => {
    mockSummarizeByMonth.mockResolvedValue([]);

    const result = await service.getSummary(ownerId);

    expect(result).toEqual({ months: [] });
  });

  it("computes the from date six months back before querying the repository", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T00:00:00.000Z"));
    try {
      await service.getSummary(ownerId);

      expect(mockSummarizeByMonth).toHaveBeenCalledWith(ownerId, new Date("2026-02-14T00:00:00.000Z"));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ExpenseService manual-savings create guard (D5/D7)", () => {
  let repository: ExpenseRepository;
  let categoryService: CategoryService;
  let service: ExpenseService;
  let mockCreate: ReturnType<typeof vi.fn>;
  let mockEnsureAhorro: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    repository = { create: vi.fn() } as unknown as ExpenseRepository;
    categoryService = { ensureAhorro: vi.fn(async () => ({ id: "cat_ahorro" })) } as unknown as CategoryService;
    mockCreate = vi.mocked(repository.create);
    mockEnsureAhorro = vi.mocked(categoryService.ensureAhorro);
    service = new ExpenseService(repository, categoryService);
  });

  const savingsInput = {
    type: "SAVINGS",
    amount: 50,
    note: "fondo vacaciones",
    occurredAt: new Date("2026-10-05T12:00:00.000Z"),
  };

  it("ensures the ahorro category before a SAVINGS create", async () => {
    await service.createExpense(savingsInput, ownerId);

    expect(mockEnsureAhorro).toHaveBeenCalledWith(ownerId);
  });

  it("stamps MANUAL·ahorro·PAID·INDIVIDUAL·ARS on a SAVINGS create (input origin ignored)", async () => {
    await service.createExpense({ ...savingsInput, savingsOrigin: "MANUAL" }, ownerId);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId,
        type: "SAVINGS",
        category: "ahorro",
        savingsOrigin: "MANUAL",
        status: "PAID",
        visibility: "INDIVIDUAL",
        currency: "ARS",
        amount: 50,
      }),
    );
  });

  it("defaults an absent category to ahorro on a SAVINGS create", async () => {
    await service.createExpense(
      { type: "SAVINGS", amount: 50, occurredAt: new Date("2026-10-05T12:00:00.000Z") },
      ownerId,
    );

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SAVINGS", category: "ahorro", savingsOrigin: "MANUAL" }),
    );
  });

  it("rejects a SAVINGS create with a non-ahorro category with 422 and does not create", async () => {
    await expect(
      service.createExpense(
        { ...savingsInput, category: "bolsillo" },
        ownerId,
      ),
    ).rejects.toBeInstanceOf(ValidationFailedError);

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects a SAVINGS create with a null category with 422 and does not create", async () => {
    await expect(
      service.createExpense(
        { ...savingsInput, category: null },
        ownerId,
      ),
    ).rejects.toBeInstanceOf(ValidationFailedError);

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("keeps the EXPENSE/INCOME create path untouched (no origin stamp, no ahorro forcing)", async () => {
    const input = { amount: 250, occurredAt: new Date("2026-10-05T12:00:00.000Z") };
    await service.createExpense(input, ownerId);

    expect(mockEnsureAhorro).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId, amount: 250, visibility: "INDIVIDUAL" }),
    );
    // sanity: the EXPENSE path carries no savingsOrigin and no forced category.
    const args = mockCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.savingsOrigin).toBeUndefined();
    expect(args.category).toBeUndefined();
  });

  it("createManualSavings creates the MANUAL·ahorro·PAID·INDIVIDUAL·ARS row with pre-validated args", async () => {
    await service.createManualSavings({
      ownerId,
      amount: 500,
      note: "fondo vacaciones",
      occurredAt: new Date("2026-10-05T12:00:00.000Z"),
    });

    expect(mockEnsureAhorro).toHaveBeenCalledWith(ownerId);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId,
        amount: 500,
        note: "fondo vacaciones",
        type: "SAVINGS",
        category: "ahorro",
        savingsOrigin: "MANUAL",
        status: "PAID",
        visibility: "INDIVIDUAL",
        currency: "ARS",
      }),
    );
  });

  it("createManualSavings keeps a null note as null", async () => {
    await service.createManualSavings({
      ownerId,
      amount: 500,
      note: null,
      occurredAt: new Date("2026-10-05T12:00:00.000Z"),
    });

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ note: null }));
  });
});
