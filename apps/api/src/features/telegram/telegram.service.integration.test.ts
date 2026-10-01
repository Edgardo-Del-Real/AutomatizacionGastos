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
import { PrismaSavingsRuleRepository } from "../savings/savings.repository";
import { SavingsRuleService } from "../savings/savings.service";
import type { BotBrain, ConversationEnvelope } from "./bot-brain";
import { HouseholdService } from "../household/household.service";
import { captureShapedRedirectReply, categoryCrudRedirectReply, menuReply, previstoPrefixRedirectReply, questionDroppedReply } from "./reply-text";
import { capturePayloadSchema, previewPayloadSchema, TelegramService } from "./telegram.service";

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

function callbackUpdate(data: string): unknown {
  return {
    update_id: 9000,
    callback_query: {
      id: "cb_1",
      chat_instance: "987654321",
      from: { id: OWNER_CHAT_ID, is_bot: false, first_name: "Rita" },
      message: { message_id: 77, chat: { id: OWNER_CHAT_ID, type: "private", first_name: "Rita" }, date: 1712803046, text: "preview" },
      data,
    },
  };
}

/** Canned brain with a null interpret by default: deterministic-only unless overridden. */
function stubBrain(overrides?: {
  interpret?: (message: string) => Promise<ConversationEnvelope | null>;
  reply?: (result: unknown) => Promise<string | null>;
}): BotBrain {
  return {
    interpret: overrides?.interpret ?? (async () => null),
    reply: overrides?.reply ?? (async () => null),
  };
}

describe("TelegramService (integration v2)", () => {
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

  function buildService(
    logger: (message: string) => void = () => undefined,
    brain?: BotBrain,
  ): TelegramService {
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
      household: new HouseholdService([{ ownerId, name: "default", chatId: OWNER_CHAT_ID }]),
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
    await prisma.savingsRule.deleteMany();
  });

  async function seedCategories(names: string[]): Promise<void> {
    for (const name of names) {
      if (name === "otro") {
        continue;
      }
      await categoryService.createCategory(ownerId, name);
    }
    await categoryService.ensureOtro(ownerId);
  }

  function replyCollector(): { replies: string[]; reply: (text: string) => Promise<number | undefined> } {
    const replies: string[] = [];
    const reply = async (text: string): Promise<number | undefined> => {
      replies.push(text);
      return undefined;
    };
    return { replies, reply };
  }

  /** Resolves the real Prisma category id by name (cat:<id> callbacks carry real ids). */
  async function categoryIdFor(name: string): Promise<string> {
    const categories = await categoryService.listCategories(ownerId);
    const found = categories.find((category) => category.name === name);
    if (found === undefined) {
      throw new Error(`category "${name}" not seeded`);
    }
    return found.id;
  }

  /** Opens a capture of the given type (menu tap + monto+nota) and returns the preview save token. */
  async function openPreview(type: "REAL" | "PENDING" | "INGRESO" | "COMPARTIDO", text: string): Promise<{ saveToken: string }> {
    const menu = { REAL: "m:new", PENDING: "m:prev", INGRESO: "m:inc", COMPARTIDO: "m:shr" }[type];
    const collector = replyCollector();
    await service.handleCallback(callbackUpdate(menu), collector.reply);
    await service.handleUpdate(textUpdate({ messageId: 1, text }), collector.reply);
    const state = await prisma.botState.findUnique({ where: { ownerId } });
    const payload = previewPayloadSchema.parse(JSON.parse(state?.pendingNote ?? "{}"));
    return { saveToken: payload.saveToken };
  }

  it("setup: a first registration enters awaiting_setup without persisting, and the reply creates the categories", async () => {
    const { replies, reply } = replyCollector();

    await service.handleUpdate(textUpdate({ messageId: 1, text: "$2500 cafe" }), reply);

    expect(await prisma.expense.count()).toBe(0);
    const state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("awaiting_setup");
    expect(replies.at(-1)).toContain("categorías");

    await service.handleUpdate(textUpdate({ messageId: 2, text: "Cafe\nTransporte" }), reply);

    const categories = await categoryService.listCategories(ownerId);
    // v2: no legacy "otro" row is auto-created for new owners.
    expect(categories.map((category) => category.name).sort()).toEqual(["Cafe", "Transporte"]);
    const after = await prisma.botState.findUnique({ where: { ownerId } });
    expect(after?.state).toBe("idle");
  });

  it("setup: the brain is never invoked when the owner has no categories", async () => {
    const interpret = vi.fn(async () => null);
    const stubbed = buildService(() => undefined, stubBrain({ interpret }));

    await stubbed.handleUpdate(textUpdate({ messageId: 1, text: "$2500 cafe" }), async () => undefined);

    expect(interpret).not.toHaveBeenCalled();
    const state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("awaiting_setup");
  });

  it("capture e2e: menu tap → monto+nota → category → Guardar registers a REAL expense row and returns to the menu", async () => {
    await seedCategories(["Cafe", "Transporte"]);
    const { replies, reply } = replyCollector();

    const preview = await openPreview("REAL", "14000 pasaje");
    await service.handleCallback(callbackUpdate(`cat:${await categoryIdFor("Cafe")}`), reply);
    await service.handleCallback(callbackUpdate(`pv:save:${preview.saveToken}`), reply);

    // Two-step e2e: the category tap sent a confirmation message with the data.
    expect(replies[0]).toContain("Confirmá");
    expect(replies[0]).toContain("Cafe");

    const movements = await prisma.expense.findMany({ where: { ownerId } });
    expect(movements).toHaveLength(1);
    expect(movements[0]?.amount.toNumber()).toBe(14000);
    expect(movements[0]?.note).toBe("pasaje");
    expect(movements[0]?.category).toBe("Cafe");
    expect(movements[0]?.type).toBe("EXPENSE");
    expect(movements[0]?.status).toBe("PAID");
    expect(movements[0]?.visibility).toBe("INDIVIDUAL");
    expect(replies.at(-1)).toBe(menuReply());
  });

  it("capture e2e: the PENDING type registers a PENDING EXPENSE row", async () => {
    await seedCategories(["Alquiler"]);
    const preview = await openPreview("PENDING", "2500 alquiler");
    const { reply } = replyCollector();
    await service.handleCallback(callbackUpdate(`cat:${await categoryIdFor("Alquiler")}`), reply);
    await service.handleCallback(callbackUpdate(`pv:save:${preview.saveToken}`), reply);

    const movements = await prisma.expense.findMany({ where: { ownerId } });
    expect(movements).toHaveLength(1);
    expect(movements[0]?.type).toBe("EXPENSE");
    expect(movements[0]?.status).toBe("PENDING");
  });

  it("capture e2e: INGRESO registers a whole INCOME row when no rule matches", async () => {
    await seedCategories(["Cafe"]);
    const preview = await openPreview("INGRESO", "cobro sueldo 1000");
    const { reply } = replyCollector();
    await service.handleCallback(callbackUpdate(`cat:${await categoryIdFor("Cafe")}`), reply);
    await service.handleCallback(callbackUpdate(`pv:save:${preview.saveToken}`), reply);

    const movements = await prisma.expense.findMany({ where: { ownerId } });
    expect(movements).toHaveLength(1);
    expect(movements[0]?.type).toBe("INCOME");
    expect(movements[0]?.amount.toNumber()).toBe(1000);
  });

  it("capture e2e: an INGRESO with a matching savings rule splits net INCOME + SAVINGS in ahorro", async () => {
    await seedCategories(["Cafe"]);
    const savingsService = new SavingsRuleService(new PrismaSavingsRuleRepository(prisma));
    await savingsService.defineRule(ownerId, "entrenuts", 10);
    const preview = await openPreview("INGRESO", "cobro sueldo de entrenuts 1000");
    const { replies, reply } = replyCollector();
    await service.handleCallback(callbackUpdate(`cat:${await categoryIdFor("Cafe")}`), reply);
    await service.handleCallback(callbackUpdate(`pv:save:${preview.saveToken}`), reply);

    const movements = await prisma.expense.findMany({ where: { ownerId } });
    expect(movements).toHaveLength(2);
    const income = movements.find((movement) => movement.type === "INCOME");
    const savings = movements.find((movement) => movement.type === "SAVINGS");
    expect(income?.amount.toNumber()).toBe(900);
    expect(savings?.amount.toNumber()).toBe(100);
    expect(savings?.category).toBe("ahorro");
    // The fixed confirmation reports gross, net and saved; the menu follows.
    expect(replies.at(-1)).toBe(menuReply());
    expect(replies.at(-2)).toContain("900");
    expect(replies.at(-2)).toContain("100");
  });

  it("capture e2e: COMPARTIDO registers a SHARED EXPENSE row", async () => {
    await seedCategories(["Cafe"]);
    const preview = await openPreview("COMPARTIDO", "2000 super");
    const { reply } = replyCollector();
    await service.handleCallback(callbackUpdate(`cat:${await categoryIdFor("Cafe")}`), reply);
    await service.handleCallback(callbackUpdate(`pv:save:${preview.saveToken}`), reply);

    const movements = await prisma.expense.findMany({ where: { ownerId } });
    expect(movements).toHaveLength(1);
    expect(movements[0]?.type).toBe("EXPENSE");
    expect(movements[0]?.visibility).toBe("SHARED");
  });

  it("capture e2e: Guardar is gated until a category is chosen; ➕ creates and selects", async () => {
    await seedCategories(["Cafe"]);
    const preview = await openPreview("REAL", "30000 gym");
    const { replies, reply } = replyCollector();

    // Gated: no category → nothing registers.
    await service.handleCallback(callbackUpdate(`pv:save:${preview.saveToken}`), reply);
    expect(await prisma.expense.count()).toBe(0);
    expect(replies.at(-1)).toContain("categoría");

    // ➕ create from the preview → category selected → save registers.
    await service.handleCallback(callbackUpdate(`pv:catnew:${preview.saveToken}`), reply);
    await service.handleUpdate(textUpdate({ messageId: 2, text: "Gimnasio" }), reply);
    const state = await prisma.botState.findUnique({ where: { ownerId } });
    const updated = previewPayloadSchema.parse(JSON.parse(state?.pendingNote ?? "{}"));
    expect(updated.category).toBe("Gimnasio");
    // The created category is selected and the step-2 confirmation is shown.
    expect(replies.at(-1)).toContain("Confirmá");
    expect(replies.at(-1)).toContain("Gimnasio");

    await service.handleCallback(callbackUpdate(`pv:save:${preview.saveToken}`), reply);
    const movements = await prisma.expense.findMany({ where: { ownerId } });
    expect(movements).toHaveLength(1);
    expect(movements[0]?.category).toBe("Gimnasio");
    expect(replies.at(-1)).toBe(menuReply());
  });

  it("idle routing e2e: capture-shaped free text never creates a movement and never calls the brain", async () => {
    await seedCategories(["Cafe"]);
    const interpret = vi.fn(async () => null);
    const stubbed = buildService(() => undefined, stubBrain({ interpret }));
    const { replies, reply } = replyCollector();

    await stubbed.handleUpdate(textUpdate({ messageId: 1, text: "14000 pasaje" }), reply);

    expect(interpret).not.toHaveBeenCalled();
    expect(await prisma.expense.count()).toBe(0);
    expect(replies.at(-2)).toBe(captureShapedRedirectReply());
    expect(replies.at(-1)).toBe(menuReply());
  });

  it("idle routing e2e: the three pre-checks and awaiting_capture NEVER invoke the brain (zero-LLM contract)", async () => {
    await seedCategories(["Cafe"]);
    const interpret = vi.fn(async () => null);
    const stubbed = buildService(() => undefined, stubBrain({ interpret }));
    const { replies, reply } = replyCollector();

    // 1. Legacy prefix.
    await stubbed.handleUpdate(textUpdate({ messageId: 1, text: "previsto: 2500 alquiler" }), reply);
    expect(interpret).not.toHaveBeenCalled();
    expect(replies.at(-2)).toBe(previstoPrefixRedirectReply());

    // 2. Capture-shaped text.
    await stubbed.handleUpdate(textUpdate({ messageId: 2, text: "14000 pasaje" }), reply);
    expect(interpret).not.toHaveBeenCalled();
    expect(replies.at(-2)).toBe(captureShapedRedirectReply());

    // 3. Legacy text CRUD.
    await stubbed.handleUpdate(textUpdate({ messageId: 3, text: "registrar categoria: Salud" }), reply);
    expect(interpret).not.toHaveBeenCalled();
    expect(replies.at(-2)).toBe(categoryCrudRedirectReply());

    // awaiting_capture + monto+nota: the capture chain runs without the brain.
    await stubbed.handleCallback(callbackUpdate("m:new"), reply);
    await stubbed.handleUpdate(textUpdate({ messageId: 4, text: "30000 gym" }), reply);
    expect(interpret).not.toHaveBeenCalled();
    expect(replies.at(-1)).toContain("¿Guardamos?");

    expect(await prisma.expense.count()).toBe(0);
  });

  it("idle routing e2e: the legacy previsto: prefix redirects and creates nothing", async () => {
    await seedCategories(["Alquiler"]);
    const { replies, reply } = replyCollector();

    await service.handleUpdate(textUpdate({ messageId: 1, text: "previsto: 2500 alquiler" }), reply);

    expect(await prisma.expense.count()).toBe(0);
    expect(replies.at(-2)).toBe(previstoPrefixRedirectReply());
    expect(replies.at(-1)).toBe(menuReply());
  });

  it("idle routing e2e: a query-classified message answers from real data", async () => {
    await seedCategories(["Cafe"]);
    // Register a REAL expense through the capture chain so real data exists.
    const regPreview = await openPreview("REAL", "2500 cafe");
    const regReply = replyCollector();
    await service.handleCallback(callbackUpdate(`cat:${await categoryIdFor("Cafe")}`), regReply.reply);
    await service.handleCallback(callbackUpdate(`pv:save:${regPreview.saveToken}`), regReply.reply);

    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({ intent: "query_balance", amount: null, note: null }),
      }),
    );
    const { replies, reply } = replyCollector();

    await stubbed.handleUpdate(textUpdate({ messageId: 2, text: "cuánto gasté" }), reply);

    expect(replies.at(-1)).toBe(menuReply());
    expect(replies.at(-2)).toContain("2.500");
  });

  it("recovery e2e: a removed-state payload recovers to idle with the dropped reply and registers nothing", async () => {
    await seedCategories(["Cafe"]);
    await prisma.botState.create({
      data: { ownerId, state: "awaiting_registration", pendingMovementId: null, pendingNote: "{}" },
    });
    const { replies, reply } = replyCollector();

    await service.handleUpdate(textUpdate({ messageId: 1, text: "30000 gym" }), reply);

    expect(await prisma.expense.count()).toBe(0);
    const state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("idle");
    expect(replies.at(-1)).toBe(questionDroppedReply());
  });

  it("delete gate e2e: pick → gate → Cancelar keeps the row and the menu returns", async () => {
    await seedCategories(["Cafe"]);
    const { reply } = replyCollector();
    // Register a REAL expense via the capture chain so a real row exists.
    const preview = await openPreview("REAL", "2500 cafe");
    await service.handleCallback(callbackUpdate(`cat:${await categoryIdFor("Cafe")}`), reply);
    await service.handleCallback(callbackUpdate(`pv:save:${preview.saveToken}`), reply);

    const movements = await prisma.expense.findMany({ where: { ownerId } });
    expect(movements).toHaveLength(1);
    const target = movements[0]!;

    // Open a delete pick (Phase 6 re-enters via am:del; seed the pick payload).
    const pickPayload = JSON.stringify({
      action: "delete_expense",
      candidates: [{ id: target.id, amount: target.amount.toNumber(), note: target.note, date: "2026-10-01" }],
    });
    await prisma.botState.upsert({
      where: { ownerId },
      update: { state: "awaiting_movement_selection", pendingMovementId: null, pendingNote: pickPayload },
      create: { ownerId, state: "awaiting_movement_selection", pendingMovementId: null, pendingNote: pickPayload },
    });
    await service.handleCallback(callbackUpdate(`dk:${target.id}`), reply);
    await service.handleCallback(callbackUpdate(`dc:no:${target.id}`), reply);

    expect(await prisma.expense.count()).toBe(1);
    const state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("idle");
  });

  it("menu e2e: the menu command abandons an open capture and renders the eight-button menu", async () => {
    await seedCategories(["Cafe"]);
    await service.handleCallback(callbackUpdate("m:new"), async () => undefined);
    const { replies, reply } = replyCollector();

    await service.handleUpdate(textUpdate({ messageId: 1, text: "/menu" }), reply);

    const state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("idle");
    expect(replies.at(-1)).toBe(menuReply());
  });

  it("capture type persists in the awaiting_capture payload", async () => {
    await seedCategories(["Cafe"]);
    await service.handleCallback(callbackUpdate("m:prev"), async () => undefined);

    const state = await prisma.botState.findUnique({ where: { ownerId } });
    const payload = capturePayloadSchema.parse(JSON.parse(state?.pendingNote ?? "{}"));
    expect(payload.type).toBe("PENDING");
  });

  it("sub-menu e2e: am:cor → mc pick → cc reassign updates the movement and returns to the menu", async () => {
    await seedCategories(["Cafe", "Transporte"]);
    const { reply } = replyCollector();
    const preview = await openPreview("REAL", "2500 cafe");
    await service.handleCallback(callbackUpdate(`cat:${await categoryIdFor("Cafe")}`), reply);
    await service.handleCallback(callbackUpdate(`pv:save:${preview.saveToken}`), reply);

    const movements = await prisma.expense.findMany({ where: { ownerId } });
    expect(movements).toHaveLength(1);
    const target = movements[0]!;
    const transporteId = await categoryIdFor("Transporte");

    await service.handleCallback(callbackUpdate("am:cor"), reply);
    await service.handleCallback(callbackUpdate(`mc:${target.id}`), reply);
    await service.handleCallback(callbackUpdate(`cc:${transporteId}`), reply);

    const after = await prisma.expense.findUnique({ where: { id: target.id } });
    expect(after?.category).toBe("Transporte");
    expect(reply).toBeDefined();
  });

  it("sub-menu e2e: am:pay → mp pick marks the PENDING expense paid", async () => {
    await seedCategories(["Cafe"]);
    const { reply } = replyCollector();
    const preview = await openPreview("PENDING", "3000 gym");
    await service.handleCallback(callbackUpdate(`cat:${await categoryIdFor("Cafe")}`), reply);
    await service.handleCallback(callbackUpdate(`pv:save:${preview.saveToken}`), reply);

    const movements = await prisma.expense.findMany({ where: { ownerId } });
    expect(movements[0]?.status).toBe("PENDING");
    const target = movements[0]!;

    await service.handleCallback(callbackUpdate("am:pay"), reply);
    await service.handleCallback(callbackUpdate(`mp:${target.id}`), reply);

    const after = await prisma.expense.findUnique({ where: { id: target.id } });
    expect(after?.status).toBe("PAID");
  });

  it("sub-menu e2e: ac:new creates a real category; ac:del deletes it through the guarded service", async () => {
    await seedCategories(["Cafe"]);
    const { reply } = replyCollector();

    await service.handleCallback(callbackUpdate("ac:new"), reply);
    await service.handleUpdate(textUpdate({ messageId: 2, text: "Gimnasio" }), reply);
    const created = await categoryService.listCategories(ownerId);
    const gym = created.find((category) => category.name === "Gimnasio");
    expect(gym).toBeDefined();

    await service.handleCallback(callbackUpdate("ac:del"), reply);
    await service.handleCallback(callbackUpdate(`ac:dl:${gym!.id}`), reply);
    await service.handleCallback(callbackUpdate(`ac:ok:${gym!.id}`), reply);

    const after = await categoryService.listCategories(ownerId);
    expect(after.some((category) => category.name === "Gimnasio")).toBe(false);
  });

  it("sub-menu e2e: rep:balance answers from real data and returns to the menu", async () => {
    await seedCategories(["Cafe"]);
    const { replies, reply } = replyCollector();
    const preview = await openPreview("REAL", "2500 cafe");
    await service.handleCallback(callbackUpdate(`cat:${await categoryIdFor("Cafe")}`), reply);
    await service.handleCallback(callbackUpdate(`pv:save:${preview.saveToken}`), reply);

    await service.handleCallback(callbackUpdate("rep:balance"), reply);

    expect(replies.at(-2)).toContain("2.500");
    expect(replies.at(-1)).toBe(menuReply());
  });
});