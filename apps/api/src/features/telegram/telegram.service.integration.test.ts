import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadDotEnvFromDisk } from "../../config/load-env";
import { PrismaExpenseRepository } from "../expenses/expenses.repository";
import { ExpenseService } from "../expenses/expenses.service";
import { PrismaProcessedMessageRepository } from "../messages/message.repository";
import { TelegramService } from "./telegram.service";

loadDotEnvFromDisk();

const OWNER_CHAT_ID = 123456789;
const ownerId = "default";

function resolveTestDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  if (explicit) return explicit;
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL or TEST_DATABASE_URL must be set");
  const url = new URL(base);
  const database = url.pathname.replace(/\/$/, "");
  url.pathname = `${database}_test`;
  return url.toString();
}

function textUpdate(overrides?: { fromId?: number; chatId?: number; messageId?: number; text?: string }): unknown {
  const fromId = overrides?.fromId ?? OWNER_CHAT_ID;
  return {
    update_id: 8000,
    message: {
      message_id: overrides?.messageId ?? 42,
      from: { id: fromId, is_bot: false, first_name: "Rita" },
      chat: { id: overrides?.chatId ?? fromId, type: "private", first_name: "Rita" },
      date: 1712803046,
      text: overrides?.text ?? "café 2500",
    },
  };
}

describe("TelegramService (integration)", () => {
  const testDatabaseUrl = resolveTestDatabaseUrl();
  let prisma: PrismaClient;
  let service: TelegramService;

  beforeAll(async () => {
    execSync("npx --no-install prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
      stdio: "pipe",
    });
    prisma = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    const messageRepository = new PrismaProcessedMessageRepository(prisma);
    const expenseService = new ExpenseService(new PrismaExpenseRepository(prisma));
    service = new TelegramService({ messageRepository, expenseService, ownerChatId: OWNER_CHAT_ID, ownerId });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.processedMessage.deleteMany();
    await prisma.expense.deleteMany();
  });

  it("persists a ProcessedMessage and an Expense for a valid owner text message", async () => {
    await service.handleUpdate(textUpdate({ messageId: 9001, text: "café 2500" }));

    const processed = await prisma.processedMessage.findUnique({
      where: { chatId_messageId: { chatId: String(OWNER_CHAT_ID), messageId: "9001" } },
    });
    expect(processed?.ownerId).toBe(ownerId);

    const expenses = await prisma.expense.findMany({ where: { ownerId } });
    expect(expenses).toHaveLength(1);
    expect(expenses[0]?.amount.toNumber()).toBe(2500);
    expect(expenses[0]?.currency).toBe("ARS");
    expect(expenses[0]?.note).toBe("café");
    expect(expenses[0]?.type).toBe("EXPENSE");
  });

  it("skips a duplicate update without creating a second expense", async () => {
    const update = textUpdate({ messageId: 9002, text: "sueldo 50000" });

    await service.handleUpdate(update);
    await service.handleUpdate(update);

    expect(await prisma.processedMessage.count()).toBe(1);
    expect(await prisma.expense.count()).toBe(1);
  });

  it("records two ProcessedMessage rows when the same message id arrives from different chats", async () => {
    await service.handleUpdate(textUpdate({ messageId: 9003, chatId: 111111111, text: "pan 100" }));
    await service.handleUpdate(textUpdate({ messageId: 9003, chatId: 222222222, text: "leche 200" }));

    expect(await prisma.processedMessage.count()).toBe(2);
    const expenses = await prisma.expense.findMany({ where: { ownerId } });
    expect(expenses).toHaveLength(2);
  });

  it("records the message but creates no expense for a non-owner sender", async () => {
    await service.handleUpdate(textUpdate({ messageId: 9004, fromId: 987654321, text: "café 2500" }));

    expect(await prisma.processedMessage.count()).toBe(1);
    expect(await prisma.expense.count()).toBe(0);
  });

  it("creates an INCOME movement for a plus-prefixed amount", async () => {
    await service.handleUpdate(textUpdate({ messageId: 9005, text: "+5000" }));

    const expenses = await prisma.expense.findMany({ where: { ownerId } });
    expect(expenses).toHaveLength(1);
    expect(expenses[0]?.amount.toNumber()).toBe(5000);
    expect(expenses[0]?.type).toBe("INCOME");
  });
});