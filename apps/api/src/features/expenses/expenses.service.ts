import { createMovementSchema, type ExpenseSummary, type MovementVisibility } from "@rita/contracts";
import { NotFoundError, ValidationFailedError } from "../../infra/errors";
import type { ExpenseRepository } from "./expenses.repository";
import type { Expense } from "./expenses.types";

const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;

export class ExpenseService {
  constructor(private readonly repository: ExpenseRepository) {}

  /**
   * AD7 — create-visibility is OUT-OF-BAND: it never travels in the shared
   * `createMovementSchema` (which `POST /expenses` also validates), so the
   * frozen endpoint cannot persist visibility. Defaults to INDIVIDUAL.
   */
  async createExpense(
    input: unknown,
    ownerId: string,
    options?: { visibility?: MovementVisibility },
  ): Promise<Expense> {
    const parsed = createMovementSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationFailedError("Invalid expense payload", parsed.error.issues);
    }
    return this.repository.create({
      ownerId,
      ...parsed.data,
      visibility: options?.visibility ?? "INDIVIDUAL",
    });
  }

  async getExpense(id: string, ownerId: string): Promise<Expense> {
    const expense = await this.repository.findById(id, ownerId);
    if (!expense) {
      throw new NotFoundError(`Expense ${id} not found`);
    }
    return expense;
  }

  async listExpenses(ownerId: string): Promise<Expense[]> {
    return this.repository.listByOwner(ownerId);
  }

  async deleteExpense(id: string, ownerId: string): Promise<void> {
    const deleted = await this.repository.deleteById(id, ownerId);
    if (!deleted) {
      throw new NotFoundError(`Expense ${id} not found`);
    }
  }

  async getSummary(ownerId: string): Promise<ExpenseSummary> {
    const from = new Date(Date.now() - SIX_MONTHS_MS);
    const months = await this.repository.summarizeByMonth(ownerId, from);
    return { months };
  }

  /** D7: delegates the atomic net-INCOME + SAVINGS split to the repository. */
  async createIncomeWithSavings(data: {
    ownerId: string;
    gross: number;
    percent: number;
    note: string | null;
    occurredAt: Date;
    category: string;
    visibility: "INDIVIDUAL" | "SHARED";
  }): Promise<{ net: Expense | null; savings: Expense | null }> {
    return this.repository.createIncomeWithSavings(data);
  }
}
