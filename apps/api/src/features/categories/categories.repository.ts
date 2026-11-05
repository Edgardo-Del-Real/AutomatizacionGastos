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
      // Resolve by NORMALIZED name: the caller may type "Cafe" while the row is
      // stored as "CAFE", and the movement cascade must use the STORED spelling
      // (updating by the typed one silently skipped every movement).
      const rows = await tx.category.findMany({ where: { ownerId } });
      const target = rows.find(
        (row) => normalizeForMatch(row.name) === normalizeForMatch(fromName),
      );
      if (target === undefined) {
        return null;
      }
      await tx.category.update({ where: { id: target.id }, data: { name: toName } });
      // Rename cascade (D1): every movement referencing the name follows in one
      // pass. Matched by NORMALIZED name, because a row written before the
      // canonical form existed may still carry "Cafe" while the category is
      // stored as "CAFE".
      const movements = await tx.expense.findMany({
        where: { ownerId },
        select: { id: true, category: true },
      });
      const stale = movements.filter(
        (movement) =>
          movement.category !== null &&
          normalizeForMatch(movement.category) === normalizeForMatch(target.name),
      );
      if (stale.length > 0) {
        await tx.expense.updateMany({
          where: { id: { in: stale.map((movement) => movement.id) } },
          data: { category: toName },
        });
      }
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
      where: { ownerId_name: { ownerId, name: "OTRO" } },
      update: {},
      create: { ownerId, name: "OTRO", type: "MIXED" },
    });
  }

  async ensureAhorro(ownerId: string): Promise<CategoryEntity> {
    return this.prisma.category.upsert({
      where: { ownerId_name: { ownerId, name: "AHORRO" } },
      update: {},
      create: { ownerId, name: "AHORRO", type: "SAVINGS" },
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