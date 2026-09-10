import { NotFoundError, ValidationFailedError } from "../../infra/errors";
import { isUniqueConstraintViolation } from "../messages/message.repository";
import type { CategoryRepository } from "./categories.repository";
import type { CategoryEntity, CategoryWithKeywords } from "./categories.types";
import { matchCategory, normalizeForMatch } from "./matcher";

export class CategoryService {
  constructor(private readonly repository: CategoryRepository) {}

  async createCategory(ownerId: string, name: string): Promise<CategoryEntity> {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw new ValidationFailedError("Category name must not be empty");
    }
    await this.assertNameAvailable(ownerId, trimmed);
    try {
      return await this.repository.create(ownerId, trimmed);
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
    if (normalizeForMatch(from) !== normalizeForMatch(to)) {
      await this.assertNameAvailable(ownerId, to);
    }
    return this.repository.rename(ownerId, from, to);
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

  async matchNote(ownerId: string, note: string): Promise<string | null> {
    const rules = await this.repository.listKeywordRules(ownerId);
    return matchCategory(note, rules);
  }

  /** Throws 422 when the name is not one of the owner's categories (D12). */
  async assertOwnerCategory(ownerId: string, name: string): Promise<void> {
    const trimmed = name.trim();
    const categories = await this.repository.listByOwner(ownerId);
    const normalized = normalizeForMatch(trimmed);
    if (!categories.some((candidate) => normalizeForMatch(candidate.name) === normalized)) {
      throw new ValidationFailedError(`Category "${trimmed}" does not belong to the owner`);
    }
  }

  private async assertNameAvailable(ownerId: string, name: string): Promise<void> {
    const normalized = normalizeForMatch(name);
    const categories = await this.repository.listByOwner(ownerId);
    if (categories.some((candidate) => normalizeForMatch(candidate.name) === normalized)) {
      throw new ValidationFailedError(`Category "${name}" already exists`);
    }
  }
}