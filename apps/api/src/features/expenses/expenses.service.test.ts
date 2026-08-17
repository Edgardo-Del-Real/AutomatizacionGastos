import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError, ValidationFailedError } from "../../infra/errors";
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
    mockCreate = vi.mocked(repository.create);
    mockFindById = vi.mocked(repository.findById);
    mockListByOwner = vi.mocked(repository.listByOwner);
    mockDeleteById = vi.mocked(repository.deleteById);
    mockSummarizeByMonth = vi.mocked(repository.summarizeByMonth);
    service = new ExpenseService(repository);
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

    expect(mockCreate).toHaveBeenCalledWith({ ownerId, ...input });
    expect(result).toBe(expense);
  });

  it("defaults the currency to ARS when not provided", async () => {
    const input = { amount: 50, occurredAt: new Date("2026-08-01T12:00:00.000Z") };
    mockCreate.mockResolvedValue(makeExpense());

    await service.createExpense(input, ownerId);

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ ownerId, amount: 50, currency: "ARS" }));
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
