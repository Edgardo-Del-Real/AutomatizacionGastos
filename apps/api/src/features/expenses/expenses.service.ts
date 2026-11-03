import { createMovementSchema, type ExpenseSummary, type MovementVisibility } from "@rita/contracts";
import { NotFoundError, ValidationFailedError } from "../../infra/errors";
import type { CategoryService } from "../categories/categories.service";
import type { ExpenseRepository } from "./expenses.repository";
import type { Expense } from "./expenses.types";

const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;

export class ExpenseService {
  constructor(
    private readonly repository: ExpenseRepository,
    // manual-savings (D6): required — the SAVINGS-create guard needs
    // ensureAhorro; mirrors the MovementService two-dep precedent and keeps
    // wiring bugs loud (optional deps would hide them).
    private readonly categoryService: CategoryService,
  ) {}

  /**
   * AD7 — create-visibility is OUT-OF-BAND: it never travels in the shared
   * `createMovementSchema` (which `POST /expenses` also validates), so the
   * frozen endpoint cannot persist visibility. Defaults to INDIVIDUAL.
   * The service still accepts `options?.visibility` for the bot's internal
   * SHARED path (normal shared expenses via the bot keep working); planned
   * expenses are INDIVIDUAL by design and never pass SHARED here.
   *
   * manual-savings (D5): a SAVINGS create is always MANUAL·"ahorro"·PAID·
   * INDIVIDUAL·ARS — ensureAhorro, category enforced (absent → defaulted,
   * anything else including null → 422), origin server-stamped (the shared
   * refine already rejected AUTO_SPLIT and origins on non-SAVINGS creates),
   * never planned, never SHARED.
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
    if (parsed.data.type === "SAVINGS") {
      await this.categoryService.ensureAhorro(ownerId);
      if (parsed.data.category !== undefined && parsed.data.category !== "ahorro") {
        throw new ValidationFailedError("SAVINGS movements require the ahorro category", [
          { message: "SAVINGS movements require the ahorro category", path: ["category"] },
        ]);
      }
      return this.repository.create({
        ownerId,
        ...parsed.data,
        // absent → defaulted to the reserved category (explicit ✓); an
        // explicit "ahorro" is preserved; anything else was rejected above.
        category: "ahorro",
        // server stamp (input value ignored; the contract only allows MANUAL).
        savingsOrigin: "MANUAL",
        status: "PAID",
        // manual savings are never planned and never shared (AD7 out-of-band).
        visibility: "INDIVIDUAL",
        currency: "ARS",
      });
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

  /** D7/D8: delegates the atomic net-INCOME + SAVINGS split to the repository. */
  async createIncomeWithSavings(data: {
    ownerId: string;
    gross: number;
    percent: number;
    note: string | null;
    occurredAt: Date;
    netCategory: string;
    savingsCategory: string;
    visibility: "INDIVIDUAL" | "SHARED";
  }): Promise<{ net: Expense | null; savings: Expense | null }> {
    return this.repository.createIncomeWithSavings(data);
  }

  /**
   * manual-savings (D7): bot-internal path with the exact row semantics of a
   * SAVINGS create through createExpense — ensureAhorro, then a
   * MANUAL·"ahorro"·PAID·INDIVIDUAL·ARS SAVINGS row. Takes pre-validated
   * domain args (the bot parser already rejected non-positive amounts), so no
   * wire contract is involved; PR3's registerManualSavings calls this.
   */
  async createManualSavings(data: {
    ownerId: string;
    amount: number;
    note?: string | null;
    occurredAt: Date;
  }): Promise<Expense> {
    await this.categoryService.ensureAhorro(data.ownerId);
    return this.repository.create({
      ownerId: data.ownerId,
      amount: data.amount,
      note: data.note ?? null,
      occurredAt: data.occurredAt,
      type: "SAVINGS",
      category: "ahorro",
      savingsOrigin: "MANUAL",
      status: "PAID",
      visibility: "INDIVIDUAL",
      currency: "ARS",
    });
  }

  /** shared-expense-split (D2): delegates the two-row SHARED split. */
  async createSharedExpenseSplit(data: {
    ownerId: string;
    partnerId: string;
    total: number;
    percent: number;
    note: string | null;
    occurredAt: Date;
    category: string;
  }): Promise<{ sender: number; partner: number } | null> {
    return this.repository.createSharedSplit(data);
  }
}
