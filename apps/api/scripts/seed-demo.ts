import { PrismaClient } from "@prisma/client";

import { loadDotEnvFromDisk } from "../src/config/load-env";

loadDotEnvFromDisk();

const prisma = new PrismaClient();

const OWNER_ID = "default";

type DemoExpense = {
  amount: number;
  currency: string;
  category: string;
  note: string;
  occurredAt: string;
};

const DEMO_EXPENSES: DemoExpense[] = [
  {
    amount: 12500,
    currency: "ARS",
    category: "food",
    note: "Supermarket run",
    occurredAt: "2026-08-18T12:00:00Z",
  },
  {
    amount: 4800,
    currency: "ARS",
    category: "transport",
    note: "Subway card",
    occurredAt: "2026-08-15T09:30:00Z",
  },
  {
    amount: 22500,
    currency: "ARS",
    category: "services",
    note: "Electricity bill",
    occurredAt: "2026-08-12T15:00:00Z",
  },
  {
    amount: 7500,
    currency: "ARS",
    category: "entertainment",
    note: "Cinema night",
    occurredAt: "2026-08-09T21:00:00Z",
  },
  {
    amount: 3200,
    currency: "ARS",
    category: "food",
    note: "Coffee and snacks",
    occurredAt: "2026-08-06T08:15:00Z",
  },
  {
    amount: 18900,
    currency: "ARS",
    category: "shopping",
    note: "New sneakers",
    occurredAt: "2026-08-03T17:45:00Z",
  },
  {
    amount: 9600,
    currency: "ARS",
    category: "services",
    note: "Internet",
    occurredAt: "2026-08-01T10:00:00Z",
  },
  {
    amount: 6200,
    currency: "ARS",
    category: "transport",
    note: "Fuel",
    occurredAt: "2026-07-28T13:20:00Z",
  },
  {
    amount: 5400,
    currency: "ARS",
    category: "health",
    note: "Pharmacy",
    occurredAt: "2026-07-20T11:10:00Z",
  },
  {
    amount: 14800,
    currency: "ARS",
    category: "food",
    note: "Dinner out",
    occurredAt: "2026-07-12T20:30:00Z",
  },
];

async function main(): Promise<void> {
  const existing = await prisma.expense.count({ where: { ownerId: OWNER_ID } });
  if (existing > 0) {
    console.log(
      `Skipping seed: already ${existing} expenses for owner "${OWNER_ID}".`,
    );
    return;
  }

  const result = await prisma.expense.createMany({
    data: DEMO_EXPENSES.map((expense) => ({
      ownerId: OWNER_ID,
      amount: expense.amount,
      currency: expense.currency,
      category: expense.category,
      note: expense.note,
      occurredAt: new Date(expense.occurredAt),
    })),
  });
  console.log(`Seeded ${result.count} demo expenses for owner "${OWNER_ID}".`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((error: unknown) => {
    console.error(error);
    void prisma.$disconnect();
    process.exit(1);
  });
