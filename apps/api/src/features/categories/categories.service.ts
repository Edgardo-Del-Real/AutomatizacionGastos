import { NotFoundError, SavingsForbiddenError, ValidationFailedError } from "../../infra/errors";
import { isUniqueConstraintViolation } from "../messages/message.repository";
import type { CategoryRepository } from "./categories.repository";
import type { CategoryEntity, CategoryType, CategoryWithKeywords } from "./categories.types";
import { matchCategory, normalizeForMatch, normalizeForMatchTolerant, type KeywordRule } from "./matcher";
import { ReservedCategoryError, resolveReservedConcept } from "./reserved";

const AHORRO = "ahorro";

export class CategoryService {
  constructor(private readonly repository: CategoryRepository) {}

  async createCategory(ownerId: string, name: string): Promise<CategoryEntity> {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw new ValidationFailedError("Category name must not be empty");
    }
    // D9: "ahorro" is always the SAVINGS category — an upsert, never NORMAL,
    // never a duplicate error.
    if (normalizeForMatch(trimmed) === AHORRO) {
      return this.ensureAhorro(ownerId);
    }
    // Reserved guard: folded "ahorros" is rejected (never upserted, never
    // NORMAL); every other folded reserved member gets its educational
    // redirect. Runs BEFORE availability so reserved names are never
    // reported as duplicates.
    const reserved = resolveReservedConcept(trimmed);
    if (reserved !== null) {
      throw new ReservedCategoryError(
        `Category "${trimmed}" is the reserved concept "${reserved}"`,
        reserved,
      );
    }
    await this.assertNameAvailable(ownerId, trimmed);
    try {
      return await this.repository.create(ownerId, trimmed, "NORMAL");
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new ValidationFailedError(`Category "${trimmed}" already exists`);
      }
      throw error;
    }
  }

  async listCategories(ownerId: string): Promise<CategoryWithKeywords[]> {
    return this.repository.listByOwner(ownerId);
  }

  /** D4 — the owner's keyword rules for the deterministic quick-capture parser (closed set). */
  async listKeywordRules(ownerId: string): Promise<KeywordRule[]> {
    return this.repository.listKeywordRules(ownerId);
  }

  async renameCategory(
    ownerId: string,
    fromName: string,
    toName: string,
  ): Promise<CategoryEntity | null> {
    const from = fromName.trim();
    const to = toName.trim();
    if (from.length === 0 || to.length === 0) {
      throw new ValidationFailedError("Both category names are required");
    }
    // D9: the SAVINGS category cannot be renamed, and no category can be
    // renamed TO ahorro (that name is reserved for the SAVINGS category).
    const fromType = await this.categoryTypeOf(ownerId, from);
    if (fromType === "SAVINGS") {
      throw new SavingsForbiddenError(`Cannot rename the SAVINGS category "${from}"`);
    }
    if (normalizeForMatch(to) === AHORRO) {
      throw new SavingsForbiddenError(`Cannot rename a category to "${AHORRO}"`);
    }
    // Reserved guard (rename side): folded reserved targets (previsto,
    // gastos fijos, ahorros, compartidos, otros, provisto) are rejected before
    // the availability check so they never read as duplicates.
    const reserved = resolveReservedConcept(to);
    if (reserved !== null) {
      throw new ReservedCategoryError(`Category "${to}" is the reserved concept "${reserved}"`, reserved);
    }
    if (normalizeForMatch(from) !== normalizeForMatch(to)) {
      await this.assertNameAvailable(ownerId, to);
    }
    return this.repository.rename(ownerId, from, to);
  }

  async deleteCategory(ownerId: string, name: string): Promise<CategoryEntity> {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw new ValidationFailedError("Category name must not be empty");
    }
    if (normalizeForMatch(trimmed) === "otro") {
      throw new ValidationFailedError(`Cannot delete the "otro" fallback category`);
    }
    // D9: the SAVINGS category cannot be deleted.
    const type = await this.categoryTypeOf(ownerId, trimmed);
    if (type === "SAVINGS") {
      throw new SavingsForbiddenError(`Cannot delete the SAVINGS category "${trimmed}"`);
    }
    const deleted = await this.repository.delete(ownerId, trimmed);
    if (deleted === null) {
      throw new NotFoundError(`Category "${trimmed}" not found`);
    }
    return deleted;
  }

  async associateKeyword(ownerId: string, keyword: string, categoryName: string): Promise<void> {
    const trimmedCategory = categoryName.trim();
    const category = (await this.repository.listByOwner(ownerId)).find(
      (candidate) => normalizeForMatch(candidate.name) === normalizeForMatch(trimmedCategory),
    );
    if (!category) {
      throw new NotFoundError(`Category "${trimmedCategory}" not found`);
    }
    const normalizedKeyword = normalizeForMatch(keyword.trim());
    if (normalizedKeyword.length === 0) {
      throw new ValidationFailedError("Keyword must not be empty");
    }
    await this.repository.associateKeyword(ownerId, category.id, normalizedKeyword);
  }

  async ensureOtro(ownerId: string): Promise<CategoryEntity> {
    return this.repository.ensureOtro(ownerId);
  }

  /** D9: upserts the SAVINGS-typed "ahorro" category for savings splits. */
  async ensureAhorro(ownerId: string): Promise<CategoryEntity> {
    return this.repository.ensureAhorro(ownerId);
  }

  async matchNote(ownerId: string, note: string): Promise<string | null> {
    const rules = await this.repository.listKeywordRules(ownerId);
    return matchCategory(note, rules);
  }

  /**
   * Throws 422 when the name is not one of the owner's categories (D12).
   * With a movementType, also rejects the SAVINGS category on EXPENSE or
   * INCOME movements (D9) — only SAVINGS movements may use "ahorro".
   */
  async assertOwnerCategory(
    ownerId: string,
    name: string,
    movementType?: "EXPENSE" | "INCOME" | "SAVINGS",
  ): Promise<void> {
    const trimmed = name.trim();
    const categories = await this.repository.listByOwner(ownerId);
    const normalized = normalizeForMatch(trimmed);
    const category = categories.find((candidate) => normalizeForMatch(candidate.name) === normalized);
    if (category === undefined) {
      throw new ValidationFailedError(`Category "${trimmed}" does not belong to the owner`);
    }
    if (category.type === "SAVINGS" && (movementType === "EXPENSE" || movementType === "INCOME")) {
      throw new SavingsForbiddenError(`The SAVINGS category "${trimmed}" is only valid for SAVINGS movements`);
    }
  }

  private async categoryTypeOf(ownerId: string, name: string): Promise<CategoryType | null> {
    const categories = await this.repository.listByOwner(ownerId);
    const normalized = normalizeForMatch(name);
    const found = categories.find((candidate) => normalizeForMatch(candidate.name) === normalized);
    return found === undefined ? null : found.type;
  }

  private async assertNameAvailable(ownerId: string, name: string): Promise<void> {
    // Duplicate-variant guard (design decision 5): comparison runs through the
    // tolerant fold, so a plural variant of an existing category is rejected;
    // the error names the EXISTING category, not the attempted variant.
    const normalized = normalizeForMatchTolerant(name);
    const categories = await this.repository.listByOwner(ownerId);
    const existing = categories.find(
      (candidate) => normalizeForMatchTolerant(candidate.name) === normalized,
    );
    if (existing !== undefined) {
      throw new ValidationFailedError(`Category "${existing.name}" already exists`);
    }
  }
}