import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadDotEnvFromDisk } from "../../config/load-env";
import { PrismaCategoryRepository } from "../categories/categories.repository";
import { CategoryService } from "../categories/categories.service";
import { PrismaExpenseRepository } from "../expenses/expenses.repository";
import { ExpenseService } from "../expenses/expenses.service";
import { PrismaProcessedMessageRepository } from "../messages/message.repository";
import { PrismaMovementRepository } from "../movements/movements.repository";
import { MovementService } from "../movements/movements.service";
import { PrismaBotStateRepository } from "./bot-state.repository";
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
  let categoryService: CategoryService;
  let service: TelegramService;

  beforeAll(async () => {
    execSync("npx --no-install prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
      stdio: "pipe",
    });
    prisma = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    categoryService = new CategoryService(new PrismaCategoryRepository(prisma));
    service = buildService();
  });

  function buildService(logger: (message: string) => void = () => undefined): TelegramService {
    const messageRepository = new PrismaProcessedMessageRepository(prisma);
    const expenseService = new ExpenseService(new PrismaExpenseRepository(prisma));
    const movementService = new MovementService(new PrismaMovementRepository(prisma), categoryService);
    const botStateRepository = new PrismaBotStateRepository(prisma);
    return new TelegramService({
      messageRepository,
      expenseService,
      movementService,
      categoryService,
      botStateRepository,
      ownerChatId: OWNER_CHAT_ID,
      ownerId,
      logger,
    });
  }

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.processedMessage.deleteMany();
    await prisma.expense.deleteMany();
    await prisma.categoryKeyword.deleteMany();
    await prisma.category.deleteMany();
    await prisma.botState.deleteMany();
  });

  async function seedCategories(names: string[]): Promise<void> {
    for (const name of names) {
      await categoryService.createCategory(ownerId, name);
    }
    await categoryService.ensureOtro(ownerId);
  }

  it("setup: a first registration enters awaiting_setup without persisting, and the reply creates the categories plus 'otro'", async () => {
    const replies: string[] = [];
    const reply = async (text: string): Promise<void> => {
      replies.push(text);
    };

    await service.handleUpdate(textUpdate({ messageId: 1, text: "$2500 cafe" }), reply);

    expect(await prisma.expense.count()).toBe(0);
    const state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("awaiting_setup");
    expect(replies.at(-1)).toContain("categorías");

    await service.handleUpdate(textUpdate({ messageId: 2, text: "Cafe\nTransporte" }), reply);

    const categories = await categoryService.listCategories(ownerId);
    const names = categories.map((category) => category.name).sort();
    expect(names).toEqual(["Cafe", "Transporte", "otro"]);
    const after = await prisma.botState.findUnique({ where: { ownerId } });
    expect(after?.state).toBe("idle");
    expect(replies.at(-1)).toContain("Cafe");
  });

  it("correction: an unmatched registration gets 'otro', the answer reassigns it and learns the keyword", async () => {
    await seedCategories(["Transporte"]);
    const replies: string[] = [];
    const reply = async (text: string): Promise<void> => {
      replies.push(text);
    };

    await service.handleUpdate(textUpdate({ messageId: 1, text: "$1200 uber viaje" }), reply);

    let movements = await prisma.expense.findMany({ where: { ownerId } });
    expect(movements).toHaveLength(1);
    expect(movements[0]?.category).toBe("otro");
    expect(replies.at(-1)).toContain("uber viaje");

    await service.handleUpdate(textUpdate({ messageId: 2, text: "Transporte" }), reply);

    movements = await prisma.expense.findMany({ where: { ownerId } });
    expect(movements[0]?.category).toBe("Transporte");
    const learned = await prisma.categoryKeyword.findMany({ where: { ownerId } });
    expect(learned).toHaveLength(1);
    expect(learned[0]?.keyword).toBe("uber");
    const state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("idle");
    expect(replies.at(-1)).toContain("Transporte");
  });

  it("correction: an unknown single-word answer auto-creates the category and applies it", async () => {
    await seedCategories([]);
    const reply = async (): Promise<void> => undefined;

    await service.handleUpdate(textUpdate({ messageId: 1, text: "$8000 veterinaria" }), reply);
    await service.handleUpdate(textUpdate({ messageId: 2, text: "Mascotas" }), reply);

    const movements = await prisma.expense.findMany({ where: { ownerId } });
    expect(movements[0]?.category).toBe("Mascotas");
    const categories = await categoryService.listCategories(ownerId);
    expect(categories.some((category) => category.name === "Mascotas")).toBe(true);
    const learned = await prisma.categoryKeyword.findMany({ where: { ownerId } });
    expect(learned.some((rule) => rule.keyword === "veterinaria")).toBe(true);
  });

  it("correction: an amount reply is a new registration that replaces the pending correction", async () => {
    await seedCategories([]);
    const reply = async (): Promise<void> => undefined;

    await service.handleUpdate(textUpdate({ messageId: 1, text: "$1000 uber viaje" }), reply);
    await service.handleUpdate(textUpdate({ messageId: 2, text: "$8000 super" }), reply);

    const movements = await prisma.expense.findMany({ where: { ownerId }, orderBy: { createdAt: "asc" } });
    expect(movements).toHaveLength(2);
    expect(movements[0]?.category).toBe("otro");
    expect(movements[1]?.amount.toNumber()).toBe(8000);
    const state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("awaiting_category");
    expect(state?.pendingMovementId).toBe(movements[1]?.id);
  });

  it("learning: a later note containing the learned keyword auto-matches", async () => {
    await seedCategories(["Transporte"]);
    const reply = async (): Promise<void> => undefined;

    await service.handleUpdate(textUpdate({ messageId: 1, text: "$1200 uber viaje" }), reply);
    await service.handleUpdate(textUpdate({ messageId: 2, text: "Transporte" }), reply);

    await service.handleUpdate(textUpdate({ messageId: 3, text: "$500 uber al aeropuerto" }), reply);

    const movements = await prisma.expense.findMany({ where: { ownerId }, orderBy: { createdAt: "asc" } });
    expect(movements).toHaveLength(2);
    expect(movements[1]?.category).toBe("Transporte");
  });

  it("restart survival: a pending correction persists and resolves after the service is rebuilt", async () => {
    await seedCategories(["Transporte"]);
    const reply = async (): Promise<void> => undefined;

    await service.handleUpdate(textUpdate({ messageId: 1, text: "$1200 uber viaje" }), reply);
    const stateBefore = await prisma.botState.findUnique({ where: { ownerId } });
    expect(stateBefore?.state).toBe("awaiting_category");

    // The process restarts: a fresh service reads the persisted state.
    const restarted = buildService();
    await restarted.handleUpdate(textUpdate({ messageId: 2, text: "Transporte" }), reply);

    const movements = await prisma.expense.findMany({ where: { ownerId } });
    expect(movements[0]?.category).toBe("Transporte");
    const stateAfter = await prisma.botState.findUnique({ where: { ownerId } });
    expect(stateAfter?.state).toBe("idle");
  });

  it("tolerates a movement-creation failure and a reply failure without stopping", async () => {
    await seedCategories([]);
    const logger = vi.fn();
    const fragile = buildService(logger);
    const failingReply = async (): Promise<void> => {
      throw new Error("telegram api down");
    };

    // Reply failure: the message still processes and the movement persists.
    await expect(
      fragile.handleUpdate(textUpdate({ messageId: 1, text: "$1000 panaderia" }), failingReply),
    ).resolves.toBeUndefined();
    expect(await prisma.expense.count()).toBe(1);
    expect(logger).toHaveBeenCalled();

    // A working reply on the next message keeps replying normally.
    const replies: string[] = [];
    await fragile.handleUpdate(textUpdate({ messageId: 2, text: "$2000 almacen" }), async (text) => {
      replies.push(text);
    });
    expect(replies.at(-1)).toContain("almacen");
  });

  it("a non-owner sender is recorded but never creates a movement or receives a reply", async () => {
    const replies: string[] = [];
    await service.handleUpdate(
      textUpdate({ messageId: 1, fromId: 987654321, text: "café 2500" }),
      async (text) => {
        replies.push(text);
      },
    );

    expect(await prisma.processedMessage.count()).toBe(1);
    expect(await prisma.expense.count()).toBe(0);
    expect(replies).toHaveLength(0);
  });
});