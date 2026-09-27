import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { SavingsRuleEntity } from "./savings.types";

export interface SavingsRuleRepository {
  /** Upsert on [ownerId, keyword]: redefining replaces the percent, never duplicates. */
  upsert(ownerId: string, keyword: string, percent: number): Promise<SavingsRuleEntity>;
  /** Oldest-learned first (createdAt ASC, keyword ASC) so matchers are deterministic. */
  listByOwner(ownerId: string): Promise<SavingsRuleEntity[]>;
}

type SavingsRuleRow = {
  id: string;
  ownerId: string;
  keyword: string;
  percent: Prisma.Decimal;
  createdAt: Date;
};

function mapRuleRow(row: SavingsRuleRow): SavingsRuleEntity {
  return {
    id: row.id,
    ownerId: row.ownerId,
    keyword: row.keyword,
    percent: row.percent.toNumber(),
    createdAt: row.createdAt,
  };
}

export class PrismaSavingsRuleRepository implements SavingsRuleRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsert(ownerId: string, keyword: string, percent: number): Promise<SavingsRuleEntity> {
    const row = await this.prisma.savingsRule.upsert({
      where: { ownerId_keyword: { ownerId, keyword } },
      update: { percent: new Prisma.Decimal(percent) },
      create: { ownerId, keyword, percent: new Prisma.Decimal(percent) },
    });
    return mapRuleRow(row);
  }

  async listByOwner(ownerId: string): Promise<SavingsRuleEntity[]> {
    const rows = await this.prisma.savingsRule.findMany({
      where: { ownerId },
      orderBy: [{ createdAt: "asc" }, { keyword: "asc" }],
    });
    return rows.map(mapRuleRow);
  }
}