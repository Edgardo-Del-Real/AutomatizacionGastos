import type { PrismaClient } from "@prisma/client";

export type RecurringRule = {
  id: string;
  ownerId: string;
  amount: number;
  note: string | null;
  category: string;
  notifyDay: number;
  active: boolean;
  nextRunAt: Date;
  createdAt: Date;
};

export type RecurringConfirmationRecord = {
  id: string;
  recurringId: string;
  ownerId: string;
  period: string;
  amount: number;
  scheduledAt: Date;
  status: "PENDING" | "CONFIRMED" | "SKIPPED";
  messageId: number | null;
  createdAt: Date;
  decidedAt: Date | null;
  remindedAt: Date | null;
};

function toRule(row: {
  id: string;
  ownerId: string;
  amount: { toNumber(): number };
  note: string | null;
  category: string;
  notifyDay: number;
  active: boolean;
  nextRunAt: Date;
  createdAt: Date;
}): RecurringRule {
  return {
    id: row.id,
    ownerId: row.ownerId,
    amount: row.amount.toNumber(),
    note: row.note,
    category: row.category,
    notifyDay: row.notifyDay,
    active: row.active,
    nextRunAt: row.nextRunAt,
    createdAt: row.createdAt,
  };
}

function toConfirmation(row: {
  id: string;
  recurringId: string;
  ownerId: string;
  period: string;
  amount: { toNumber(): number };
  scheduledAt: Date;
  status: string;
  messageId: number | null;
  createdAt: Date;
  decidedAt: Date | null;
  remindedAt: Date | null;
}): RecurringConfirmationRecord {
  return {
    id: row.id,
    recurringId: row.recurringId,
    ownerId: row.ownerId,
    period: row.period,
    amount: row.amount.toNumber(),
    scheduledAt: row.scheduledAt,
    status: row.status as RecurringConfirmationRecord["status"],
    messageId: row.messageId,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
    remindedAt: row.remindedAt,
  };
}

export class RecurringRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: {
    ownerId: string;
    amount: number;
    note: string | null;
    category: string;
    notifyDay: number;
    nextRunAt: Date;
  }): Promise<RecurringRule> {
    const row = await this.prisma.recurringExpense.create({
      data: {
        ownerId: data.ownerId,
        amount: data.amount,
        note: data.note,
        category: data.category,
        notifyDay: data.notifyDay,
        nextRunAt: data.nextRunAt,
      },
    });
    return toRule(row);
  }

  async listByOwner(ownerId: string): Promise<RecurringRule[]> {
    const rows = await this.prisma.recurringExpense.findMany({
      where: { ownerId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toRule);
  }

  /** Rules whose scheduled moment has arrived: the ONLY query the scheduler makes. */
  async findDue(now: Date): Promise<RecurringRule[]> {
    const rows = await this.prisma.recurringExpense.findMany({
      where: { active: true, nextRunAt: { lte: now } },
      orderBy: { nextRunAt: "asc" },
    });
    return rows.map(toRule);
  }

  /** The earliest moment the scheduler has to wake up, or null when nothing is scheduled. */
  async nextWakeAt(): Promise<Date | null> {
    const row = await this.prisma.recurringExpense.findFirst({
      where: { active: true },
      orderBy: { nextRunAt: "asc" },
      select: { nextRunAt: true },
    });
    return row?.nextRunAt ?? null;
  }

  async advance(ruleId: string, nextRunAt: Date): Promise<void> {
    await this.prisma.recurringExpense.update({ where: { id: ruleId }, data: { nextRunAt } });
  }

  async findConfirmation(id: string): Promise<RecurringConfirmationRecord | null> {
    const row = await this.prisma.recurringConfirmation.findUnique({ where: { id } });
    return row === null ? null : toConfirmation(row);
  }

  /**
   * Creates the month's confirmation unless it already exists. The unique key
   * (recurringId, period) is what makes the scheduler idempotent after a
   * restart or a double tick: the second attempt returns null.
   */
  async createConfirmationIfMissing(data: {
    recurringId: string;
    ownerId: string;
    period: string;
    amount: number;
    scheduledAt: Date;
  }): Promise<RecurringConfirmationRecord | null> {
    try {
      const row = await this.prisma.recurringConfirmation.create({
        data: {
          recurringId: data.recurringId,
          ownerId: data.ownerId,
          period: data.period,
          amount: data.amount,
          scheduledAt: data.scheduledAt,
          status: "PENDING",
        },
      });
      return toConfirmation(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        return null;
      }
      throw error;
    }
  }

  async setMessageId(id: string, messageId: number): Promise<void> {
    await this.prisma.recurringConfirmation.update({ where: { id }, data: { messageId } });
  }

  async markDecided(id: string, status: "CONFIRMED" | "SKIPPED", decidedAt: Date): Promise<void> {
    await this.prisma.recurringConfirmation.update({
      where: { id },
      data: { status, decidedAt },
    });
  }

  async findPendingOlderThan(cutoff: Date): Promise<RecurringConfirmationRecord[]> {
    const rows = await this.prisma.recurringConfirmation.findMany({
      where: { status: "PENDING", remindedAt: null, createdAt: { lte: cutoff } },
    });
    return rows.map(toConfirmation);
  }

  async markReminded(id: string, at: Date): Promise<void> {
    await this.prisma.recurringConfirmation.update({ where: { id }, data: { remindedAt: at } });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}
