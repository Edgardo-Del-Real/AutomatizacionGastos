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
import { compartidoPrefixRedirectReply, questionDroppedReply, unresolvableReply } from "./reply-text";

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

function callbackUpdate(fromId: number, data: string): unknown {
  return {
    update_id: 9100,
    callback_query: {
      id: "cb_1",
      chat_instance: "987654321",
      from: { id: fromId, is_bot: false, first_name: "Member" },
      message: { message_id: 77, chat: { id: fromId, type: "private", first_name: "Member" }, date: 1712803046, text: "preview" },
      data,
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

describe("TelegramService household multi-chat (spec: Owner Filtering / Dedup / v2 capture)", () => {
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
      if (name === "otro") {
        continue;
      }
      await categoryService.createCategory(ownerId, name);
    }
    await categoryService.ensureOtro(ownerId);
  }

  /** Registers a REAL capture for a member through the v2 menu-tap chain. */
  async function capture(chatId: number, messageId: number, text: string): Promise<void> {
    await service.handleCallback(callbackUpdate(chatId, "m:new"), async () => undefined);
    await service.handleUpdate(textUpdate({ fromId: chatId, messageId, text }), async () => undefined);
    const state = await prisma.botState.findUnique({ where: { ownerId: chatId === RITA_CHAT ? "rita" : "edgardo" } });
    const note = state?.pendingNote ?? "";
    const preview = JSON.parse(note) as { saveToken: string };
    const categories = await categoryService.listCategories(chatId === RITA_CHAT ? "rita" : "edgardo");
    const normal = categories.find((category) => category.name !== "otro");
    if (normal === undefined) {
      throw new Error("capture helper needs a NORMAL category seeded");
    }
    await service.handleCallback(callbackUpdate(chatId, `cat:${normal.id}`), async () => undefined);
    await service.handleCallback(callbackUpdate(chatId, `pv:save:${preview.saveToken}`), async () => undefined);
  }

  it("attributes a capture from Rita's chat under her ownerId and Edgardo's under his", async () => {
    await seedCategories("rita", ["Cafe"]);
    await seedCategories("edgardo", ["Cafe"]);

    await capture(RITA_CHAT, 1, "1000 cafe rita");
    await capture(EDGARDO_CHAT, 2, "2000 super edgardo");

    const ritaMovements = await prisma.expense.findMany({ where: { ownerId: "rita" } });
    const edgardoMovements = await prisma.expense.findMany({ where: { ownerId: "edgardo" } });
    expect(ritaMovements).toHaveLength(1);
    expect(ritaMovements[0]?.amount.toNumber()).toBe(1000);
    expect(ritaMovements[0]?.visibility).toBe("INDIVIDUAL");
    expect(edgardoMovements).toHaveLength(1);
    expect(edgardoMovements[0]?.amount.toNumber()).toBe(2000);
  });

  it("ignores an unknown chat silently: no movement, no reply, NOT recorded, and the log line contains no chatId", async () => {
    await seedCategories("rita", ["Cafe"]);
    const logs: string[] = [];
    const logged = buildService((message) => logs.push(message));
    const replies: string[] = [];

    await logged.handleUpdate(
      textUpdate({ fromId: UNKNOWN_CHAT, messageId: 1, text: "1000 cafe" }),
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
    await seedCategories("rita", ["Cafe"]);
    await seedCategories("edgardo", ["Cafe"]);

    await capture(RITA_CHAT, 7, "1000 cafe rita");
    await capture(EDGARDO_CHAT, 7, "2000 super edgardo");

    expect(await prisma.expense.count()).toBe(2);
    expect(await prisma.processedMessage.count()).toBe(2);
  });

  it("skips a duplicate (chatId, messageId) after the gate without registering twice", async () => {
    await seedCategories("rita", ["Cafe"]);
    await service.handleCallback(callbackUpdate(RITA_CHAT, "m:new"), async () => undefined);
    await service.handleUpdate(textUpdate({ fromId: RITA_CHAT, messageId: 9, text: "1000 cafe rita" }), async () => undefined);
    const state = await prisma.botState.findUnique({ where: { ownerId: "rita" } });
    const preview = JSON.parse(state?.pendingNote ?? "{}") as { saveToken: string };
    const ritaCategories = await categoryService.listCategories("rita");
    const cafe = ritaCategories.find((category) => category.name === "Cafe");
    expect(cafe).toBeDefined();
    await service.handleCallback(callbackUpdate(RITA_CHAT, `cat:${cafe!.id}`), async () => undefined);
    await service.handleCallback(callbackUpdate(RITA_CHAT, `pv:save:${preview.saveToken}`), async () => undefined);

    // Same messageId again: dedup skips before any state consumption.
    await service.handleUpdate(textUpdate({ fromId: RITA_CHAT, messageId: 9, text: "9999 cafe" }), async () => undefined);

    expect(await prisma.expense.count()).toBe(1);
  });

  it("the legacy compartido: prefix redirects to the 👥 button and never creates a SHARED movement", async () => {
    await seedCategories("rita", ["Cafe"]);
    const replies: string[] = [];

    await service.handleUpdate(
      textUpdate({ fromId: RITA_CHAT, messageId: 1, text: "compartido: 2000 super" }),
      async (text) => {
        replies.push(text);
      },
    );

    expect(await prisma.expense.count()).toBe(0);
    expect(replies.at(-2)).toBe(compartidoPrefixRedirectReply());
  });

  it("a capture from the 👥 menu button registers a SHARED movement under the sender", async () => {
    await seedCategories("rita", ["Cafe"]);
    await service.handleCallback(callbackUpdate(RITA_CHAT, "m:shr"), async () => undefined);
    await service.handleUpdate(textUpdate({ fromId: RITA_CHAT, messageId: 1, text: "2000 super" }), async () => undefined);
    const state = await prisma.botState.findUnique({ where: { ownerId: "rita" } });
    const preview = JSON.parse(state?.pendingNote ?? "{}") as { saveToken: string };
    const ritaCategories = await categoryService.listCategories("rita");
    const cafe = ritaCategories.find((category) => category.name === "Cafe");
    expect(cafe).toBeDefined();
    await service.handleCallback(callbackUpdate(RITA_CHAT, `cat:${cafe!.id}`), async () => undefined);
    await service.handleCallback(callbackUpdate(RITA_CHAT, `pv:save:${preview.saveToken}`), async () => undefined);

    const movements = await prisma.expense.findMany({ where: { ownerId: "rita" } });
    expect(movements).toHaveLength(1);
    expect(movements[0]?.visibility).toBe("SHARED");
  });

  it("a removed-state payload recovers to idle for the member who owns it", async () => {
    await seedCategories("rita", ["Cafe"]);
    await prisma.botState.create({
      data: { ownerId: "rita", state: "awaiting_amount_confirmation", pendingMovementId: null, pendingNote: "{}" },
    });
    const replies: string[] = [];

    await service.handleUpdate(
      textUpdate({ fromId: RITA_CHAT, messageId: 1, text: "5000" }),
      async (text) => {
        replies.push(text);
      },
    );

    expect(await prisma.expense.count()).toBe(0);
    const state = await prisma.botState.findUnique({ where: { ownerId: "rita" } });
    expect(state?.state).toBe("idle");
    expect(replies.at(-1)).toBe(questionDroppedReply());
  });

  it("a register-intent text with no amount degrades to the unresolvable fallback (never registers)", async () => {
    await seedCategories("rita", ["Cafe"]);
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        // The v2 brain returns null for register-intent text; the bot never
        // registers from free text.
        interpret: async () => null,
      }),
    );
    const replies: string[] = [];

    await stubbed.handleUpdate(
      textUpdate({ fromId: RITA_CHAT, messageId: 1, text: "quiero registrar un gasto" }),
      async (text) => {
        replies.push(text);
      },
    );

    expect(await prisma.expense.count()).toBe(0);
    expect(replies.at(-2)).toBe(unresolvableReply());
  });
});