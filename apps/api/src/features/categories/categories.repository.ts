import type { PrismaClient } from "@prisma/client";
import type { KeywordRule } from "./matcher";
import { normalizeForMatch } from "./matcher";
import type { CategoryEntity, CategoryType, CategoryWithKeywords } from "./categories.types";

export interface CategoryRepository {
  create(ownerId: string, name: string, type?: CategoryType): Promise<CategoryEntity>;
  listByOwner(ownerId: string): Promise<CategoryWithKeywords[]>;
  rename(ownerId: string, fromName: string, toName: string): Promise<CategoryEntity | null>;
  delete(ownerId: string, name: string): Promise<CategoryEntity | null>;
  ensureOtro(ownerId: string): Promise<CategoryEntity>;
  /** Upserts the SAVINGS-typed "ahorro" category (D9). */
  ensureAhorro(ownerId: string): Promise<CategoryEntity>;
  associateKeyword(ownerId: string, categoryId: string, keyword: string): Promise<void>;
  listKeywordRules(ownerId: string): Promise<KeywordRule[]>;
}

export class PrismaCategoryRepository implements CategoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(ownerId: string, name: string, type: CategoryType = "MIXED"): Promise<CategoryEntity> {
    return this.prisma.category.create({ data: { ownerId, name, type } });
  }

  async listByOwner(ownerId: string): Promise<CategoryWithKeywords[]> {
    const rows = await this.prisma.category.findMany({
      where: { ownerId },
      include: { keywords: true },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      ownerId: row.ownerId,
      name: row.name,
      type: row.type,
      createdAt: row.createdAt,
      keywords: row.keywords.map((keyword) => keyword.keyword),
    }));
  }

  async rename(ownerId: string, fromName: string, toName: string): Promise<CategoryEntity | null> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.category.updateMany({
        where: { ownerId, name: fromName },
        data: { name: toName },
      });
      if (updated.count === 0) {
        return null;
      }
      // Rename cascade (D1): every movement referencing the name follows in one UPDATE.
      await tx.expense.updateMany({
        where: { ownerId, category: fromName },
        data: { category: toName },
      });
      return tx.category.findUnique({
        where: { ownerId_name: { ownerId, name: toName } },
      });
    });
  }

  async delete(ownerId: string, name: string): Promise<CategoryEntity | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.category.findMany({ where: { ownerId } });
      const target = rows.find((row) => normalizeForMatch(row.name) === normalizeForMatch(name));
      if (target === undefined) {
        return null;
      }
      // The CategoryKeyword FK cascades: deleting the category removes its
      // keyword rules. Movements keep the plain-string name (no FK).
      await tx.category.delete({ where: { id: target.id } });
      return { id: target.id, ownerId, name: target.name, type: target.type, createdAt: target.createdAt };
    });
  }

  async ensureOtro(ownerId: string): Promise<CategoryEntity> {
    return this.prisma.category.upsert({
      where: { ownerId_name: { ownerId, name: "otro" } },
      update: {},
      create: { ownerId, name: "otro", type: "MIXED" },
    });
  }

  async ensureAhorro(ownerId: string): Promise<CategoryEntity> {
    return this.prisma.category.upsert({
      where: { ownerId_name: { ownerId, name: "ahorro" } },
      update: {},
      create: { ownerId, name: "ahorro", type: "SAVINGS" },
    });
  }

  async associateKeyword(ownerId: string, categoryId: string, keyword: string): Promise<void> {
    // Idempotent: the (ownerId, keyword) unique constraint turns repeats into no-ops.
    await this.prisma.categoryKeyword.upsert({
      where: { ownerId_keyword: { ownerId, keyword } },
      update: {},
      create: { ownerId, categoryId, keyword },
    });
  }

  async listKeywordRules(ownerId: string): Promise<KeywordRule[]> {
    const rows = await this.prisma.categoryKeyword.findMany({
      where: { ownerId },
      include: { category: true },
      orderBy: [{ createdAt: "asc" }, { keyword: "asc" }],
    });
    return rows.map((row) => ({
      keyword: row.keyword,
      category: row.category.name,
      createdAt: row.createdAt,
    }));
  }
}