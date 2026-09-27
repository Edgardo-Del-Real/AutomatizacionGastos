import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadDotEnvFromDisk } from "../../config/load-env";
import { PrismaCategoryRepository } from "../categories/categories.repository";
import { CategoryService } from "../categories/categories.service";
import { PrismaExpenseRepository } from "../expenses/expenses.repository";
import { ExpenseService } from "../expenses/expenses.service";
import { HouseholdService } from "../household/household.service";
import { PrismaProcessedMessageRepository } from "../messages/message.repository";
import { PrismaMovementRepository } from "../movements/movements.repository";
import { MovementService } from "../movements/movements.service";
import { PrismaBotStateRepository } from "./bot-state.repository";
import { PrismaSavingsRuleRepository } from "../savings/savings.repository";
import { SavingsRuleService } from "../savings/savings.service";
import type { BotBrain, ConversationEnvelope } from "./bot-brain";
import { TelegramService } from "./telegram.service";

loadDotEnvFromDisk();

const RITA_CHAT = 111;
const EDGARDO_CHAT = 222;
const UNKNOWN_CHAT = 333;

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

function textUpdate(overrides?: { fromId?: number; messageId?: number; text?: string }): unknown {
  const fromId = overrides?.fromId ?? RITA_CHAT;
  return {
    update_id: 9000,
    message: {
      message_id: overrides?.messageId ?? 42,
      from: { id: fromId, is_bot: false, first_name: "Member" },
      chat: { id: fromId, type: "private", first_name: "Member" },
      date: 1712803046,
      text: overrides?.text ?? "café 2500",
    },
  };
}

/** Canned brain with a null interpret by default: deterministic-only unless overridden. */
function stubBrain(overrides?: {
  interpret?: (message: string) => Promise<ConversationEnvelope | null>;
}): BotBrain {
  return {
    interpret: overrides?.interpret ?? (async () => null),
    reply: async () => null,
  };
}

describe("TelegramService household multi-chat (spec: Owner Filtering / Dedup / Shared Prefix)", () => {
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

  function buildService(logger: (message: string) => void = () => undefined, brain?: BotBrain): TelegramService {
    const household = new HouseholdService([
      { ownerId: "rita", name: "Rita", chatId: RITA_CHAT },
      { ownerId: "edgardo", name: "Edgardo", chatId: EDGARDO_CHAT },
    ]);
    const messageRepository = new PrismaProcessedMessageRepository(prisma);
    const expenseService = new ExpenseService(new PrismaExpenseRepository(prisma));
    const movementService = new MovementService(new PrismaMovementRepository(prisma), categoryService);
    const savingsService = new SavingsRuleService(new PrismaSavingsRuleRepository(prisma));
    const botStateRepository = new PrismaBotStateRepository(prisma);
    return new TelegramService({
      messageRepository,
      expenseService,
      movementService,
      categoryService,
      savingsService,
      botStateRepository,
      household,
      logger,
      ...(brain === undefined ? {} : { brain }),
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

  async function seedCategories(ownerId: string, names: string[]): Promise<void> {
    for (const name of names) {
      await categoryService.createCategory(ownerId, name);
    }
    await categoryService.ensureOtro(ownerId);
  }

  it("attributes a message from Rita's chat under her ownerId and Edgardo's under his (both directions)", async () => {
    await seedCategories("rita", []);
    await seedCategories("edgardo", []);

    await service.handleUpdate(textUpdate({ fromId: RITA_CHAT, messageId: 1, text: "$1000 cafe rita" }), async () => undefined);
    await service.handleUpdate(textUpdate({ fromId: EDGARDO_CHAT, messageId: 2, text: "$2000 super edgardo" }), async () => undefined);

    const ritaMovements = await prisma.expense.findMany({ where: { ownerId: "rita" } });
    const edgardoMovements = await prisma.expense.findMany({ where: { ownerId: "edgardo" } });
    expect(ritaMovements).toHaveLength(1);
    expect(ritaMovements[0]?.amount.toNumber()).toBe(1000);
    expect(ritaMovements[0]?.visibility).toBe("INDIVIDUAL");
    expect(edgardoMovements).toHaveLength(1);
    expect(edgardoMovements[0]?.amount.toNumber()).toBe(2000);
  });

  it("ignores an unknown chat silently: no movement, no reply, NOT recorded, and the log line contains no chatId", async () => {
    await seedCategories("rita", []);
    const logs: string[] = [];
    const logged = buildService((message) => logs.push(message));
    const replies: string[] = [];

    await logged.handleUpdate(
      textUpdate({ fromId: UNKNOWN_CHAT, messageId: 1, text: "$1000 cafe" }),
      async (text) => {
        replies.push(text);
      },
    );

    expect(await prisma.expense.count()).toBe(0);
    expect(await prisma.processedMessage.count()).toBe(0);
    expect(replies).toHaveLength(0);
    const secretLog = logs.find((line) => line.includes("ignoring"));
    expect(secretLog).toBeTruthy();
    expect(secretLog).not.toContain(String(UNKNOWN_CHAT));
  });

  it("processes the same messageId in two different chats (dedup is per chatId+messageId)", async () => {
    await seedCategories("rita", []);
    await seedCategories("edgardo", []);

    await service.handleUpdate(textUpdate({ fromId: RITA_CHAT, messageId: 7, text: "$1000 cafe rita" }), async () => undefined);
    await service.handleUpdate(textUpdate({ fromId: EDGARDO_CHAT, messageId: 7, text: "$2000 super edgardo" }), async () => undefined);

    expect(await prisma.expense.count()).toBe(2);
    expect(await prisma.processedMessage.count()).toBe(2);
  });

  it("skips a duplicate (chatId, messageId) after the gate without creating or replying", async () => {
    await seedCategories("rita", []);

    await service.handleUpdate(textUpdate({ fromId: RITA_CHAT, messageId: 9, text: "$1000 cafe rita" }), async () => undefined);
    await service.handleUpdate(textUpdate({ fromId: RITA_CHAT, messageId: 9, text: "$1000 cafe rita" }), async () => undefined);

    expect(await prisma.expense.count()).toBe(1);
  });

  it("registers 'compartido: $2000 super' as SHARED under the sender with the stripped note", async () => {
    await seedCategories("rita", []);

    await service.handleUpdate(textUpdate({ fromId: RITA_CHAT, messageId: 1, text: "compartido: $2000 super" }), async () => undefined);

    const movements = await prisma.expense.findMany({ where: { ownerId: "rita" } });
    expect(movements).toHaveLength(1);
    expect(movements[0]?.visibility).toBe("SHARED");
    // The prefix is stripped from the stored note (the "$" prefix is the
    // pre-existing deterministic-parser note format, pinned by the legacy suite).
    expect(movements[0]?.note).toContain("super");
    expect(movements[0]?.note).not.toContain("compartido");
  });

  it("lets the compartido: prefix win over a brain envelope with shared: false", async () => {
    await seedCategories("rita", []);
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({
          intent: "register_expense",
          amount: 2000,
          category: null,
          note: null,
          shared: false,
        }),
      }),
    );

    await stubbed.handleUpdate(textUpdate({ fromId: RITA_CHAT, messageId: 1, text: "compartido: $2000 super" }), async () => undefined);

    const movements = await prisma.expense.findMany({ where: { ownerId: "rita" } });
    expect(movements[0]?.visibility).toBe("SHARED");
  });

  it("registers SHARED from the brain shared flag alone (no prefix)", async () => {
    await seedCategories("rita", []);
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({
          intent: "register_expense",
          amount: 2000,
          category: null,
          note: null,
          shared: true,
        }),
      }),
    );

    await stubbed.handleUpdate(textUpdate({ fromId: RITA_CHAT, messageId: 1, text: "$2000 super" }), async () => undefined);

    const movements = await prisma.expense.findMany({ where: { ownerId: "rita" } });
    expect(movements[0]?.visibility).toBe("SHARED");
  });

  it("registers INDIVIDUAL when neither the prefix nor the brain flag is present", async () => {
    await seedCategories("rita", []);

    await service.handleUpdate(textUpdate({ fromId: RITA_CHAT, messageId: 1, text: "$2000 super" }), async () => undefined);

    const movements = await prisma.expense.findMany({ where: { ownerId: "rita" } });
    expect(movements[0]?.visibility).toBe("INDIVIDUAL");
  });

  it("persists the shared bit through the amount-confirmation dialog (payload carries shared)", async () => {
    await seedCategories("rita", []);
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({
          intent: "register_expense",
          amount: 5000,
          category: null,
          note: null,
          shared: true,
        }),
      }),
    );
    const replies: string[] = [];

    // Deterministic parse traps 4800 vs the brain 5000 → asks for confirmation.
    await stubbed.handleUpdate(
      textUpdate({ fromId: RITA_CHAT, messageId: 1, text: "compartido: $4800 kiosco" }),
      async (text) => {
        replies.push(text);
      },
    );
    expect(await prisma.expense.count()).toBe(0);
    const state = await prisma.botState.findUnique({ where: { ownerId: "rita" } });
    expect(state?.state).toBe("awaiting_amount_confirmation");
    const stored = JSON.parse(state?.pendingNote ?? "{}") as { shared?: boolean };
    expect(stored.shared).toBe(true);

    // The user picks the brain amount: registers SHARED from the payload bit.
    await stubbed.handleUpdate(textUpdate({ fromId: RITA_CHAT, messageId: 2, text: "5000" }), async () => undefined);

    const movements = await prisma.expense.findMany({ where: { ownerId: "rita" } });
    expect(movements).toHaveLength(1);
    expect(movements[0]?.visibility).toBe("SHARED");
  });
});