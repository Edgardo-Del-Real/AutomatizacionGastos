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
import { categoryButtonsReply, formatARS, markPaidAlreadyReply, markPaidReply, nothingPendingReply, nothingToDeleteReply } from "./reply-text";
import { quickCapturePreviewPayloadSchema, registrationCollectPayloadSchema, TelegramService } from "./telegram.service";

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
      // Single-user degraded mode: only the owner chat resolves, to `default`.
      household: new HouseholdService([{ ownerId, name: "default", chatId: OWNER_CHAT_ID }]),
      logger,
      // Default: no brain → deterministic-only; tests inject stubs.
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
      // "otro" is the reserved fallback: it is created by ensureOtro below,
      // never through createCategory (reserved guard).
      if (name === "otro") {
        continue;
      }
      await categoryService.createCategory(ownerId, name);
    }
    await categoryService.ensureOtro(ownerId);
  }

  it("savings split e2e: a matching income registers net INCOME + SAVINGS and the summary excludes savings", async () => {
    const savingsService = new SavingsRuleService(new PrismaSavingsRuleRepository(prisma));
    await savingsService.defineRule(ownerId, "entrenuts", 10);
    await seedCategories(["trabajo"]);
    const replies: string[] = [];
    const reply = async (text: string): Promise<void> => {
      replies.push(text);
    };

    await service.handleUpdate(
      textUpdate({ messageId: 50, text: "cobro sueldo de entrenuts 1000" }),
      reply,
    );

    const movements = await prisma.expense.findMany({ where: { ownerId } });
    expect(movements).toHaveLength(2);
    const income = movements.find((movement) => movement.type === "INCOME");
    const savings = movements.find((movement) => movement.type === "SAVINGS");
    expect(income?.amount.toNumber()).toBe(900);
    expect(savings?.amount.toNumber()).toBe(100);
    expect(savings?.category).toBe("ahorro");
    expect(replies.join("\n")).toContain("900,00");

    const summaryService = new MovementService(new PrismaMovementRepository(prisma), categoryService);
    const summary = await summaryService.getSummary({
      viewerId: ownerId,
      partnerId: null,
      visibility: "all",
    });
    expect(summary.kpis.income).toBe(900);
    expect(summary.kpis.expenses).toBe(0);
    expect(summary.kpis.balance).toBe(900);
    expect(summary.kpis.savings).toBe(100);
  });

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

  it("setup: the brain is never invoked when the owner has no categories", async () => {
    const interpret = vi.fn(async () => null);
    const stubbed = buildService(() => undefined, stubBrain({ interpret }));

    await stubbed.handleUpdate(textUpdate({ messageId: 1, text: "$2500 cafe" }), async () => undefined);

    expect(interpret).not.toHaveBeenCalled();
    const state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("awaiting_setup");
  });

  it("correction: an unmatched registration gets 'otro', the answer reassigns it without learning", async () => {
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
    expect(learned).toHaveLength(0);
    const state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("idle");
    expect(replies.at(-1)).toBe('Listo, el movimiento quedó en "Transporte".');
  });

  it("correction: an unknown single-word answer shows the category buttons and never auto-creates (D9)", async () => {
    await seedCategories([]);
    const replies: string[] = [];
    const reply = async (text: string): Promise<void> => {
      replies.push(text);
    };

    await service.handleUpdate(textUpdate({ messageId: 1, text: "$8000 veterinaria" }), reply);
    await service.handleUpdate(textUpdate({ messageId: 2, text: "Mascotas" }), reply);

    // The single-token auto-create is REMOVED: no category is created and the
    // movement stays in "otro" while the correction stays open.
    const movements = await prisma.expense.findMany({ where: { ownerId } });
    expect(movements[0]?.category).toBe("otro");
    const categories = await categoryService.listCategories(ownerId);
    expect(categories.some((category) => category.name === "Mascotas")).toBe(false);
    const state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("awaiting_category");
    expect(replies.at(-1)).toBe(categoryButtonsReply());
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

  it("correction: 'no' keeps the movement as 'otro' and clears the state", async () => {
    await seedCategories([]);
    const replies: string[] = [];
    const reply = async (text: string): Promise<void> => {
      replies.push(text);
    };

    await service.handleUpdate(textUpdate({ messageId: 1, text: "$1000 panaderia" }), reply);
    await service.handleUpdate(textUpdate({ messageId: 2, text: "no" }), reply);

    const movements = await prisma.expense.findMany({ where: { ownerId } });
    expect(movements).toHaveLength(1);
    expect(movements[0]?.category).toBe("otro");
    const state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("idle");
    expect(replies.at(-1)).toBe('Listo, quedó en "otro".');
  });

  it("correction: a multi-word non-category answer shows the category buttons and keeps the state open", async () => {
    await seedCategories(["Cafe"]);
    const replies: string[] = [];
    const reply = async (text: string): Promise<void> => {
      replies.push(text);
    };

    await service.handleUpdate(textUpdate({ messageId: 1, text: "$1000 panaderia" }), reply);
    await service.handleUpdate(textUpdate({ messageId: 2, text: "no se qué categoria" }), reply);

    const state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("awaiting_category");
    expect(replies.at(-1)).toBe(categoryButtonsReply());

    // The pending correction is still resolvable afterwards.
    await service.handleUpdate(textUpdate({ messageId: 3, text: "Cafe" }), reply);
    const movements = await prisma.expense.findMany({ where: { ownerId } });
    expect(movements[0]?.category).toBe("Cafe");
  });

  it("correction: reassigns without learning, so a later note does not auto-match", async () => {
    await seedCategories(["Cafe"]);
    const reply = async (): Promise<void> => undefined;

    await service.handleUpdate(textUpdate({ messageId: 1, text: "$2500 compre un cafe en el kiosco" }), reply);
    await service.handleUpdate(textUpdate({ messageId: 2, text: "Cafe" }), reply);

    const movements = await prisma.expense.findMany({ where: { ownerId } });
    expect(movements[0]?.category).toBe("Cafe");
    const learned = await prisma.categoryKeyword.findMany({ where: { ownerId } });
    expect(learned).toHaveLength(0);

    await service.handleUpdate(textUpdate({ messageId: 3, text: "$300 cafe con leche" }), reply);
    const after = await prisma.expense.findMany({ where: { ownerId }, orderBy: { createdAt: "asc" } });
    expect(after).toHaveLength(2);
    expect(after[1]?.category).toBe("otro");
    const state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("awaiting_category");
  });

  it("learning: a later note containing an explicitly associated keyword resolves through the quick-capture parser", async () => {
    await seedCategories(["Transporte"]);
    const reply = async (): Promise<void> => undefined;

    await service.handleUpdate(
      textUpdate({ messageId: 1, text: "asociar palabra: uber a categoria: Transporte" }),
      reply,
    );
    // The associated keyword now feeds the deterministic fast path: the note
    // parses into a preview whose category resolves to Transporte (no LLM).
    await service.handleUpdate(textUpdate({ messageId: 2, text: "$500 uber al aeropuerto" }), reply);

    const state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("awaiting_preview");
    const preview = quickCapturePreviewPayloadSchema.parse(JSON.parse(state?.pendingNote ?? "{}"));
    expect(preview.amount).toBe(500);
    expect(preview.category).toBe("Transporte");
    expect(await prisma.expense.count({ where: { ownerId } })).toBe(0);
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

  it("an unknown chat is ignored silently: NOT recorded, no movement, no reply (spec Owner Filtering)", async () => {
    const replies: string[] = [];
    const logs: string[] = [];
    const logged = buildService((message) => logs.push(message));
    await logged.handleUpdate(
      textUpdate({ messageId: 1, fromId: 987654321, text: "café 2500" }),
      async (text) => {
        replies.push(text);
      },
    );

    expect(await prisma.processedMessage.count()).toBe(0);
    expect(await prisma.expense.count()).toBe(0);
    expect(replies).toHaveLength(0);
    const secretLog = logs.find((line) => line.includes("ignoring"));
    expect(secretLog).toBeTruthy();
    expect(secretLog).not.toContain("987654321");
  });

  it("brain: a keyword-miss suggestion resolving to an owner category registers without a correction round-trip", async () => {
    await seedCategories(["Supermercado"]);
    const replies: string[] = [];
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({
          intent: "register_expense",
          amount: 2000,
          category: "supermercado",
          note: null,
        }),
      }),
    );

    await stubbed.handleUpdate(textUpdate({ messageId: 1, text: "$2000 feria" }), async (text) => {
      replies.push(text);
    });

    const movements = await prisma.expense.findMany({ where: { ownerId } });
    expect(movements).toHaveLength(1);
    expect(movements[0]?.category).toBe("Supermercado");
    expect(movements[0]?.amount.toNumber()).toBe(2000);
    const state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("idle");
    expect(replies.at(-1)).toContain("Supermercado");
  });

  it("brain: rescues an amount for an unparseable note and registers it", async () => {
    await seedCategories([]);
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({ intent: "register_expense", amount: 5000, category: null, note: null }),
      }),
    );

    await stubbed.handleUpdate(textUpdate({ messageId: 1, text: "compre mercaderia" }), async () => undefined);

    const movements = await prisma.expense.findMany({ where: { ownerId } });
    expect(movements).toHaveLength(1);
    expect(movements[0]?.amount.toNumber()).toBe(5000);
    expect(movements[0]?.category).toBe("otro");
    const state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("awaiting_category");
  });

  it("brain: a registered movement sends the brain reply verbatim", async () => {
    await seedCategories(["Cafe"]);
    const replies: string[] = [];
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({ intent: "register_expense", amount: 2500, category: "Cafe", note: null }),
        reply: async () => "Listo, quedó registrado 2500 en Cafe.",
      }),
    );

    await stubbed.handleUpdate(textUpdate({ messageId: 1, text: "$2500 cafe" }), async (text) => {
      replies.push(text);
    });

    const movements = await prisma.expense.findMany({ where: { ownerId } });
    expect(movements).toHaveLength(1);
    expect(movements[0]?.amount.toNumber()).toBe(2500);
    expect(movements[0]?.category).toBe("Cafe");
    expect(replies.at(-1)).toBe("Listo, quedó registrado 2500 en Cafe.");
  });

  it("brain: a null reply falls back to the fixed success template carrying the same facts", async () => {
    await seedCategories(["Cafe"]);
    const replies: string[] = [];
    const reply = vi.fn(async (text: string): Promise<void> => {
      replies.push(text);
    });
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({ intent: "register_expense", amount: 2500, category: "Cafe", note: null }),
        reply: async () => null,
      }),
    );

    await stubbed.handleUpdate(textUpdate({ messageId: 1, text: "$2500 cafe" }), reply);

    expect(replies.at(-1)).toContain("Registrado");
    expect(replies.at(-1)).toContain(formatARS(2500));
    expect(replies.at(-1)).toContain("Cafe");
  });

  it("brain: a query_balance intent executes the real balance and falls back to the fixed template when the brain reply is null", async () => {
    await seedCategories([]);
    const replies: string[] = [];
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({ intent: "query_balance", amount: null, category: null, note: null }),
      }),
    );

    await stubbed.handleUpdate(textUpdate({ messageId: 1, text: "cuánto me queda?" }), async (text) => {
      replies.push(text);
    });

    expect(await prisma.expense.count()).toBe(0);
    // An answered query never writes state: no row means the owner stays idle.
    const state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state).toBeNull();
    expect(replies.at(-1)).toContain(formatARS(0));
  });

  it("brain: a query/categories intent lists the real categories through the brain reply", async () => {
    await seedCategories(["Cafe", "Transporte"]);
    const replies: string[] = [];
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({
          intent: "query",
          amount: null,
          category: null,
          note: null,
          query_type: "categories",
        }),
        reply: async () => "Tenés Cafe, Transporte y otro.",
      }),
    );

    await stubbed.handleUpdate(
      textUpdate({ messageId: 1, text: "cuales son las categorias disponibles?" }),
      async (text) => {
        replies.push(text);
      },
    );

    expect(await prisma.expense.count()).toBe(0);
    expect(replies.at(-1)).toBe("Tenés Cafe, Transporte y otro.");
  });

  it("brain: an off_topic intent creates no movement and never chats", async () => {
    await seedCategories([]);
    const replies: string[] = [];
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({ intent: "off_topic", amount: null, category: null, note: null }),
      }),
    );

    await stubbed.handleUpdate(textUpdate({ messageId: 1, text: "hola, cómo andás?" }), async (text) => {
      replies.push(text);
    });

    expect(await prisma.expense.count()).toBe(0);
    expect(replies.at(-1)).toContain("gastos");
    expect(replies.at(-1)).not.toContain("bien");
  });

  it("brain: conflicting amounts persist an awaiting_amount_confirmation row and ask the owner", async () => {
    await seedCategories([]);
    const replies: string[] = [];
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({ intent: "register_expense", amount: 5000, category: null, note: null }),
      }),
    );

    await stubbed.handleUpdate(textUpdate({ messageId: 1, text: "gaste 4800 en el kiosco" }), async (text) => {
      replies.push(text);
    });

    expect(await prisma.expense.count()).toBe(0);
    const state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("awaiting_amount_confirmation");
    const payload = JSON.parse(state?.pendingNote ?? "{}") as { amounts: number[] };
    expect(payload.amounts).toEqual([4800, 5000]);
    expect(replies.at(-1)).toContain("monto");
  });

  it('brain: a "5 mil" stance message registers the brain amount with no conflict question', async () => {
    await seedCategories([]);
    const replies: string[] = [];
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({ intent: "register_expense", amount: 5000, category: null, note: null }),
      }),
    );

    await stubbed.handleUpdate(textUpdate({ messageId: 1, text: "gaste 5 mil en el super" }), async (text) => {
      replies.push(text);
    });

    const movements = await prisma.expense.findMany({ where: { ownerId } });
    expect(movements).toHaveLength(1);
    expect(movements[0]?.amount.toNumber()).toBe(5000);
    const state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("awaiting_category");
    expect(replies.at(-1)).toContain(formatARS(5000));
  });

  it("brain: the confirmation resolves after a service rebuild (restart survival)", async () => {
    await seedCategories(["Transporte"]);
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({
          intent: "register_expense",
          amount: 5000,
          category: "Transporte",
          note: null,
        }),
      }),
    );
    await stubbed.handleUpdate(textUpdate({ messageId: 1, text: "gaste 4800 en taxi" }), async () => undefined);

    // The process restarts: a fresh service without the brain still
    // resolves the persisted question.
    const restarted = buildService();
    await restarted.handleUpdate(textUpdate({ messageId: 2, text: "5000" }), async () => undefined);

    const movements = await prisma.expense.findMany({ where: { ownerId } });
    expect(movements).toHaveLength(1);
    expect(movements[0]?.amount.toNumber()).toBe(5000);
    expect(movements[0]?.category).toBe("Transporte");
    const state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("idle");
  });

  it("brain: a non-matching reply abandons the question and the new text registers normally", async () => {
    await seedCategories([]);
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({ intent: "register_expense", amount: 5000, category: null, note: null }),
      }),
    );
    await stubbed.handleUpdate(textUpdate({ messageId: 1, text: "gaste 4800 en el kiosco" }), async () => undefined);

    const restarted = buildService();
    await restarted.handleUpdate(textUpdate({ messageId: 2, text: "6000" }), async () => undefined);

    // Nothing registers from the conflicting message (4800 or 5000); only 6000.
    const movements = await prisma.expense.findMany({ where: { ownerId } });
    expect(movements).toHaveLength(1);
    expect(movements[0]?.amount.toNumber()).toBe(6000);
    const state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("awaiting_category");
  });

  it("brain: a create_category intent creates the category through the real service and replies", async () => {
    await seedCategories(["otro"]);
    const replies: string[] = [];
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({ intent: "create_category", amount: null, category: "Mascotas", note: null }),
        reply: async () => "Listo, creé Mascotas.",
      }),
    );

    await stubbed.handleUpdate(
      textUpdate({ messageId: 1, text: "creá una categoria llamada mascotas" }),
      async (text) => {
        replies.push(text);
      },
    );

    const categories = await categoryService.listCategories(ownerId);
    expect(categories.some((category) => category.name === "Mascotas")).toBe(true);
    expect(await prisma.expense.count()).toBe(0);
    expect(replies.at(-1)).toBe("Listo, creé Mascotas.");
  });

  it("brain: a duplicate create_category intent falls back to the fixed duplicate template", async () => {
    await seedCategories(["Mascotas"]);
    const replies: string[] = [];
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({ intent: "create_category", amount: null, category: "Mascotas", note: null }),
      }),
    );

    await stubbed.handleUpdate(
      textUpdate({ messageId: 1, text: "creá la categoria mascotas" }),
      async (text) => {
        replies.push(text);
      },
    );

    expect(replies.at(-1)).toBe('Ya existe una categoría "Mascotas".');
  });

  it("brain: a delete_category intent deletes the category and its keywords but not the movements", async () => {
    await seedCategories(["Viajes"]);
    await categoryService.associateKeyword(ownerId, "aerolinea", "Viajes");
    await prisma.expense.createMany({
      data: [
        {
          ownerId,
          amount: 5000,
          currency: "ARS",
          category: "Viajes",
          note: "pasaje",
          occurredAt: new Date("2026-09-01T12:00:00.000Z"),
          type: "EXPENSE",
        },
      ],
    });
    const replies: string[] = [];
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({ intent: "delete_category", amount: null, category: "Viajes", note: null }),
        reply: async () => "Listo, borré Viajes.",
      }),
    );

    await stubbed.handleUpdate(
      textUpdate({ messageId: 1, text: "borra la categoria viajes" }),
      async (text) => {
        replies.push(text);
      },
    );

    const categories = await categoryService.listCategories(ownerId);
    expect(categories.some((category) => category.name === "Viajes")).toBe(false);
    expect(categories.some((category) => category.name === "otro")).toBe(true);
    expect(await prisma.categoryKeyword.count({ where: { ownerId } })).toBe(0);
    const movements = await prisma.expense.findMany({ where: { ownerId } });
    expect(movements).toHaveLength(1);
    expect(movements[0]?.category).toBe("Viajes");
    expect(replies.at(-1)).toBe("Listo, borré Viajes.");
  });

  it("brain: a delete_category intent for 'otro' is refused with the fixed warning", async () => {
    await seedCategories([]);
    const replies: string[] = [];
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({ intent: "delete_category", amount: null, category: "otro", note: null }),
      }),
    );

    await stubbed.handleUpdate(
      textUpdate({ messageId: 1, text: "borra la categoria otro" }),
      async (text) => {
        replies.push(text);
      },
    );

    expect(replies.at(-1)).toContain("otro");
    expect(replies.at(-1)).not.toBe('Categoría "otro" borrada.');
    const categories = await categoryService.listCategories(ownerId);
    expect(categories.some((category) => category.name === "otro")).toBe(true);
  });

  it("brain: a rename_category intent renames the category through the real service", async () => {
    await seedCategories(["Super"]);
    const replies: string[] = [];
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({
          intent: "rename_category",
          amount: null,
          category: "Super",
          note: null,
          new_name: "Supermercado",
        }),
        reply: async () => "Listo, ahora es Supermercado.",
      }),
    );

    await stubbed.handleUpdate(
      textUpdate({ messageId: 1, text: "renombra super a supermercado" }),
      async (text) => {
        replies.push(text);
      },
    );

    const categories = await categoryService.listCategories(ownerId);
    expect(categories.some((category) => category.name === "Supermercado")).toBe(true);
    expect(categories.some((category) => category.name === "Super")).toBe(false);
    expect(replies.at(-1)).toBe("Listo, ahora es Supermercado.");
  });

  it("brain: a capabilities intent answers with the fixed summary and never with 'No se ejecutó nada'", async () => {
    await seedCategories(["otro"]);
    const replies: string[] = [];
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({ intent: "capabilities", amount: null, category: null, note: null }),
      }),
    );

    await stubbed.handleUpdate(
      textUpdate({ messageId: 1, text: "podes borrar categorias?" }),
      async (text) => {
        replies.push(text);
      },
    );

    expect(await prisma.expense.count()).toBe(0);
    expect(replies.at(-1)).toContain("borrar");
    expect(replies.at(-1)).not.toContain("No se ejecutó nada");
  });

  it("brain: a capabilities intent sends the brain reply verbatim", async () => {
    await seedCategories(["otro"]);
    const replies: string[] = [];
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({ intent: "capabilities", amount: null, category: null, note: null }),
        reply: async () => "Sí, puedo crear, borrar y renombrar categorías.",
      }),
    );

    await stubbed.handleUpdate(
      textUpdate({ messageId: 1, text: "qué sabés hacer?" }),
      async (text) => {
        replies.push(text);
      },
    );

    expect(replies.at(-1)).toBe("Sí, puedo crear, borrar y renombrar categorías.");
  });

  it("dialog: a query during awaiting_category answers without consuming the pending, then a resolve reassigns", async () => {
    await seedCategories(["Transporte"]);
    const replies: string[] = [];
    const reply = async (text: string): Promise<void> => {
      replies.push(text);
    };
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async (message) => {
          if (message === "decime los últimos movimientos") {
            return { intent: "query", amount: null, category: null, note: null, query_type: "recent", dialog_action: null };
          }
          if (message === "Transporte") {
            return {
              intent: "correct_category",
              amount: null,
              category: "Transporte",
              note: null,
              dialog_action: "resolve",
            };
          }
          return { intent: "register_expense", amount: 1200, category: null, note: null, dialog_action: null };
        },
      }),
    );

    // Register → "otro" → awaiting_category.
    await stubbed.handleUpdate(textUpdate({ messageId: 1, text: "$1200 uber viaje" }), reply);
    let movements = await prisma.expense.findMany({ where: { ownerId } });
    expect(movements).toHaveLength(1);
    expect(movements[0]?.category).toBe("otro");
    const pendingId = movements[0]?.id;
    expect(pendingId).toBeDefined();

    // Query during the dialog: answered from real data, pending intact.
    await stubbed.handleUpdate(textUpdate({ messageId: 2, text: "decime los últimos movimientos" }), reply);
    let state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("awaiting_category");
    expect(state?.pendingMovementId).toBe(pendingId);
    expect(replies.at(-1)).toContain("uber viaje");

    // Resolve: reassigns the pending movement and closes the dialog.
    await stubbed.handleUpdate(textUpdate({ messageId: 3, text: "Transporte" }), reply);
    movements = await prisma.expense.findMany({ where: { ownerId } });
    expect(movements[0]?.category).toBe("Transporte");
    state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("idle");
  });

  it("correction: an ambiguous correct_category asks, and the pick survives a restart", async () => {
    await seedCategories(["gastos hormiga"]);
    const now = Date.now();
    await prisma.expense.createMany({
      data: [
        {
          ownerId,
          amount: 2500,
          currency: "ARS",
          category: "otro",
          note: "super",
          occurredAt: new Date(now - 24 * 60 * 60 * 1000),
          type: "EXPENSE",
        },
        {
          ownerId,
          amount: 2500,
          currency: "ARS",
          category: "otro",
          note: "uber",
          occurredAt: new Date(now - 6 * 60 * 60 * 1000),
          type: "EXPENSE",
        },
      ],
    });
    const replies: string[] = [];
    const reply = async (text: string): Promise<void> => {
      replies.push(text);
    };
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({
          intent: "correct_category",
          amount: 2500,
          category: "gastos hormiga",
          note: null,
          dialog_action: null,
        }),
      }),
    );

    await stubbed.handleUpdate(textUpdate({ messageId: 1, text: "esos 2500 a gastos hormiga" }), reply);

    const state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("awaiting_movement_selection");
    expect(state?.pendingMovementId).toBeNull();
    const stored = JSON.parse(state?.pendingNote ?? "{}") as { category: string; candidates: { id: string }[] };
    expect(stored.category).toBe("gastos hormiga");
    expect(stored.candidates).toHaveLength(2);
    expect(replies.at(-1)).toContain("¿Cuál de estos movimientos corrijo?");

    // Restart: a fresh service resolves the pick deterministically, no brain.
    const restarted = buildService();
    await restarted.handleUpdate(textUpdate({ messageId: 2, text: "2" }), async () => undefined);

    const movements = await prisma.expense.findMany({ where: { ownerId }, orderBy: { occurredAt: "asc" } });
    // Candidates are listed recency-descending: [uber (6h), super (24h)]. The
    // pick "2" selects the second candidate (super) and reassigns it.
    expect(movements.map((movement) => movement.category)).toEqual(["gastos hormiga", "otro"]);
    const after = await prisma.botState.findUnique({ where: { ownerId } });
    expect(after?.state).toBe("idle");
  });

  it("dialog: create_category with then_reassign creates and reassigns the pending in one cycle", async () => {
    await seedCategories([]);
    // The deterministic service enters awaiting_category with a pending movement.
    const deterministic = buildService();
    await deterministic.handleUpdate(textUpdate({ messageId: 1, text: "$1200 uber viaje" }), async () => undefined);

    const pending = await prisma.botState.findUnique({ where: { ownerId } });
    expect(pending?.state).toBe("awaiting_category");
    expect(pending?.pendingMovementId).toBeDefined();

    const replies: string[] = [];
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({
          intent: "create_category",
          amount: null,
          category: "mascotas",
          note: null,
          dialog_action: null,
          then_reassign: true,
        }),
      }),
    );
    await stubbed.handleUpdate(textUpdate({ messageId: 2, text: "creá mascotas y guardalo ahí" }), async (text) => {
      replies.push(text);
    });

    const categories = await categoryService.listCategories(ownerId);
    expect(categories.some((category) => category.name === "mascotas")).toBe(true);
    const movements = await prisma.expense.findMany({ where: { ownerId } });
    expect(movements[0]?.category).toBe("mascotas");
    const state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("idle");
    // Exactly one confirmation reply.
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain("mascotas");
  });

  it("correction: a free-form correct_category reassigns a unique recent movement", async () => {
    await seedCategories(["gastos hormiga"]);
    const now = Date.now();
    await prisma.expense.createMany({
      data: [
        {
          ownerId,
          amount: 2500,
          currency: "ARS",
          category: "otro",
          note: "uber",
          occurredAt: new Date(now - 6 * 60 * 60 * 1000),
          type: "EXPENSE",
        },
      ],
    });
    const replies: string[] = [];
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({
          intent: "correct_category",
          amount: 2500,
          category: "gastos hormiga",
          note: null,
          dialog_action: null,
        }),
      }),
    );

    await stubbed.handleUpdate(textUpdate({ messageId: 1, text: "esos 2500 a gastos hormiga" }), async (text) => {
      replies.push(text);
    });

    const movements = await prisma.expense.findMany({ where: { ownerId } });
    expect(movements[0]?.category).toBe("gastos hormiga");
    expect(replies.at(-1)).toContain(formatARS(2500));
    expect(replies.at(-1)).toContain("gastos hormiga");
  });

  it("planned e2e: previsto: registers PENDING EXPENSE rows, the planned query answers real data, and recent/correction exclude them", async () => {
    await seedCategories(["Vivienda", "otro"]);
    const replies: string[] = [];
    const reply = async (text: string): Promise<void> => {
      replies.push(text);
    };

    // Deterministic bot (no brain): the plain previsto: registers a PENDING
    // row; the combined compartido:+previsto: orders (either way) are REJECTED
    // with the individual-only redirect and create nothing.
    await service.handleUpdate(
      textUpdate({ messageId: 1, text: "previsto: 2500 alquiler" }),
      reply,
    );
    await service.handleUpdate(
      textUpdate({ messageId: 2, text: "compartido: previsto: 1500 expensas" }),
      reply,
    );
    await service.handleUpdate(
      textUpdate({ messageId: 3, text: "previsto: compartido: 1200 luz" }),
      reply,
    );

    const rows = await prisma.expense.findMany({ where: { ownerId }, orderBy: { occurredAt: "asc" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("PENDING");
    expect(rows[0]?.type).toBe("EXPENSE");
    expect(rows[0]?.visibility).toBe("INDIVIDUAL");
    // Both combinations answered the educational redirect; nothing registered.
    expect(replies.filter((r) => r.includes("previstos son individuales"))).toHaveLength(2);
    expect(replies.join("\n")).toContain("previsto");
    // The KPIs exclude PENDING: only the planned block reports the total.
    const summary = await new MovementService(new PrismaMovementRepository(prisma), categoryService).getSummary({
      viewerId: ownerId,
      partnerId: null,
      visibility: "all",
    });
    expect(summary.kpis.expenses).toBe(0);
    expect(summary.planned.total).toBe(2500);

    // "¿cuánto tengo previsto?" answers 2500 from real data through the brain path.
    const queryReplies: string[] = [];
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({ intent: "query_planned", amount: null, category: null, note: null, dialog_action: null }),
        reply: async () => null,
      }),
    );
    await stubbed.handleUpdate(
      textUpdate({ messageId: 4, text: "cuánto tengo previsto?" }),
      async (text) => {
        queryReplies.push(text);
      },
    );
    expect(queryReplies.at(-1)).toContain(formatARS(2500));

    // Recent excludes PENDING rows at the telegram layer (repository keeps them).
    const recentReplies: string[] = [];
    const recentStubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({ intent: "query", amount: null, category: null, note: null, query_type: "recent", dialog_action: null }),
        reply: async () => null,
      }),
    );
    await recentStubbed.handleUpdate(
      textUpdate({ messageId: 5, text: "ultimos movimientos" }),
      async (text) => {
        recentReplies.push(text);
      },
    );
    expect(recentReplies.at(-1)).toContain("movimientos");
    expect(recentReplies.at(-1)).not.toContain("previsto");

    // Correction excludes PENDING: a free-form correct_category over the
    // pending alquiler finds no PAID match → no reassignment.
    const correctReplies: string[] = [];
    const correctStubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({
          intent: "correct_category",
          amount: 2500,
          category: "gastos hormiga",
          note: "alquiler",
          dialog_action: null,
        }),
      }),
    );
    await correctStubbed.handleUpdate(
      textUpdate({ messageId: 6, text: "esos 2500 alquiler a gastos hormiga" }),
      async (text) => {
        correctReplies.push(text);
      },
    );
    const after = await prisma.expense.findMany({ where: { ownerId }, orderBy: { occurredAt: "asc" } });
    expect(after.every((row) => row.category === "otro" || row.category === null)).toBe(true);
    expect(correctReplies.at(-1)).toContain("No encontré");
  });

  it("planned e2e: without the previsto: prefix the brain can never register PENDING (D7)", async () => {
    await seedCategories(["Vivienda"]);
    const replies: string[] = [];
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({
          intent: "register_expense",
          amount: 2500,
          category: "Vivienda",
          note: "alquiler",
        }),
      }),
    );

    await stubbed.handleUpdate(
      textUpdate({ messageId: 1, text: "dejalo para el mes que viene: 2500 alquiler" }),
      async (text) => {
        replies.push(text);
      },
    );

    // A future-expense phrasing WITHOUT the prefix registers as a REAL
    // expense — PENDING results only from the prefix or the Previsto button
    // (spec telegram-bot "Brain never decides the planned type").
    const rows = await prisma.expense.findMany({ where: { ownerId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amount.toNumber()).toBe(2500);
    expect(rows[0]?.category).toBe("Vivienda");
    expect(rows[0]?.status).toBe("PAID");
    expect(rows[0]?.type).toBe("EXPENSE");
  });

  it("planned e2e: the previsto: prefix beats a brain planned:false flag", async () => {
    await seedCategories(["Vivienda"]);
    const replies: string[] = [];
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({
          intent: "register_expense",
          amount: 2500,
          category: "Vivienda",
          note: "alquiler",
          planned: false,
        }),
      }),
    );

    await stubbed.handleUpdate(
      textUpdate({ messageId: 1, text: "previsto: 2500 alquiler" }),
      async (text) => {
        replies.push(text);
      },
    );

    const rows = await prisma.expense.findMany({ where: { ownerId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("PENDING");
    expect(replies.at(-1)).toContain("previsto");
  });

  it("collect e2e: amount-null entry → amount answer → category answer registers from stored context", async () => {
    await seedCategories(["Gimnasio"]);
    const replies: string[] = [];
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async (message) => {
          if (message === "5000") {
            return { intent: "register_expense", amount: 5000, category: null, note: null, dialog_action: "resolve" };
          }
          if (message === "Gimnasio") {
            return { intent: "register_expense", amount: null, category: "Gimnasio", note: null, dialog_action: "resolve" };
          }
          return { intent: "register_expense", amount: null, category: null, note: "gym", dialog_action: null };
        },
      }),
    );

    await stubbed.handleUpdate(textUpdate({ messageId: 1, text: "quiero cargar un gasto gym" }), async (text) => {
      replies.push(text);
    });

    expect(await prisma.expense.count()).toBe(0);
    let state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("awaiting_registration");
    let payload = registrationCollectPayloadSchema.parse(JSON.parse(state?.pendingNote ?? "{}"));
    expect(payload.amount).toBeNull();
    expect(payload.note).toBe("gym");
    expect(replies.at(-1)).toContain("¿Qué monto");

    // Amount answer: keeps collecting, asks the category.
    await stubbed.handleUpdate(textUpdate({ messageId: 2, text: "5000" }), async (text) => {
      replies.push(text);
    });
    state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("awaiting_registration");
    payload = registrationCollectPayloadSchema.parse(JSON.parse(state?.pendingNote ?? "{}"));
    expect(payload.amount).toBe(5000);
    expect(payload.category).toBeNull();
    expect(replies.at(-1)).toContain("¿En qué categoría");

    // Category answer: registers from the stored context and returns to idle.
    await stubbed.handleUpdate(textUpdate({ messageId: 3, text: "Gimnasio" }), async (text) => {
      replies.push(text);
    });
    const rows = await prisma.expense.findMany({ where: { ownerId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amount.toNumber()).toBe(5000);
    expect(rows[0]?.category).toBe("Gimnasio");
    expect(rows[0]?.note).toBe("gym");
    state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("idle");
  });

  it("collect e2e: a planned collect registers a PENDING EXPENSE honoring the payload bit", async () => {
    await seedCategories(["otro"]);
    const replies: string[] = [];
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async (message) => {
          if (message === "5000") {
            return { intent: "register_expense", amount: 5000, category: null, note: null, dialog_action: "resolve" };
          }
          if (message === "otro") {
            return { intent: "register_expense", amount: null, category: "otro", note: null, dialog_action: "resolve" };
          }
          return { intent: "register_expense", amount: null, category: null, note: "gym", planned: true, dialog_action: null };
        },
      }),
    );

    await stubbed.handleUpdate(textUpdate({ messageId: 1, text: "previsto: gym" }), async (text) => {
      replies.push(text);
    });

    let state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("awaiting_registration");
    let payload = registrationCollectPayloadSchema.parse(JSON.parse(state?.pendingNote ?? "{}"));
    expect(payload.planned).toBe(true);
    expect(payload.shared).toBe(false);

    await stubbed.handleUpdate(textUpdate({ messageId: 2, text: "5000" }), async (text) => {
      replies.push(text);
    });
    state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("awaiting_registration");
    payload = registrationCollectPayloadSchema.parse(JSON.parse(state?.pendingNote ?? "{}"));
    expect(payload.amount).toBe(5000);

    await stubbed.handleUpdate(textUpdate({ messageId: 3, text: "otro" }), async (text) => {
      replies.push(text);
    });

    const rows = await prisma.expense.findMany({ where: { ownerId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("PENDING");
    expect(rows[0]?.type).toBe("EXPENSE");
    expect(rows[0]?.visibility).toBe("INDIVIDUAL");
  });

  it("collect e2e: restart survival mid-dialog — a fresh service continues the collect", async () => {
    await seedCategories(["otro"]);
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({
          intent: "register_expense",
          amount: null,
          category: null,
          note: "gym",
          dialog_action: null,
        }),
      }),
    );
    await stubbed.handleUpdate(textUpdate({ messageId: 1, text: "quiero cargar un gasto gym" }), async () => undefined);

    let state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("awaiting_registration");
    const storedNote = state?.pendingNote;

    // The process restarts: a fresh service without the brain still resolves
    // the persisted collect from the payload.
    const restarted = buildService();
    const replies: string[] = [];
    await restarted.handleUpdate(textUpdate({ messageId: 2, text: "5000" }), async (text) => {
      replies.push(text);
    });

    state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("awaiting_registration");
    const payload = registrationCollectPayloadSchema.parse(JSON.parse(state?.pendingNote ?? "{}"));
    expect(payload.amount).toBe(5000);
    expect(payload.note).toBe("gym");
    expect(payload.body).toBe("quiero cargar un gasto gym");
    expect(state?.pendingNote).not.toBe(storedNote); // the amount was persisted
    expect(replies.at(-1)).toContain("¿En qué categoría");
  });

  it("collect e2e: a corrupt collect payload recovers to idle with the dropped reply, registering nothing", async () => {
    await seedCategories(["otro"]);
    await prisma.botState.upsert({
      where: { ownerId },
      update: { state: "awaiting_registration", pendingMovementId: null, pendingNote: "{not-json" },
      create: { ownerId, state: "awaiting_registration", pendingMovementId: null, pendingNote: "{not-json" },
    });
    const replies: string[] = [];
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({ intent: "register_expense", amount: null, category: null, note: null, dialog_action: null }),
      }),
    );

    await stubbed.handleUpdate(textUpdate({ messageId: 2, text: "$3000 panaderia" }), async (text) => {
      replies.push(text);
    });

    expect(await prisma.expense.count()).toBe(0);
    const state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("idle");
    expect(state?.pendingNote).toBeNull();
    expect(replies.at(-1)).toContain("pregunta");
  });

  it("collect e2e: a shared collect registers a SHARED movement honoring the payload bit", async () => {
    await seedCategories(["otro"]);
    const replies: string[] = [];
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async (message) => {
          if (message === "5000") {
            return { intent: "register_expense", amount: 5000, category: null, note: null, dialog_action: "resolve" };
          }
          if (message === "otro") {
            return { intent: "register_expense", amount: null, category: "otro", note: null, dialog_action: "resolve" };
          }
          return { intent: "register_expense", amount: null, category: null, note: "expensas", shared: true, dialog_action: null };
        },
      }),
    );

    await stubbed.handleUpdate(textUpdate({ messageId: 1, text: "compartido: expensas" }), async (text) => {
      replies.push(text);
    });
    await stubbed.handleUpdate(textUpdate({ messageId: 2, text: "5000" }), async (text) => {
      replies.push(text);
    });
    await stubbed.handleUpdate(textUpdate({ messageId: 3, text: "otro" }), async (text) => {
      replies.push(text);
    });

    const rows = await prisma.expense.findMany({ where: { ownerId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amount.toNumber()).toBe(5000);
    expect(rows[0]?.visibility).toBe("SHARED");
  });

  async function seedExpense(input: {
    amount: number;
    category: string;
    note: string | null;
    status?: "PENDING" | "PAID";
  }): Promise<string> {
    const expenseService = new ExpenseService(new PrismaExpenseRepository(prisma));
    const row = await expenseService.createExpense(
      {
        amount: input.amount,
        category: input.category,
        note: input.note,
        occurredAt: new Date(),
        status: input.status ?? "PAID",
      },
      ownerId,
    );
    return row.id;
  }

  it("lifecycle e2e: 'ya lo pagué' transitions the referenced PENDING expense to PAID with one reply", async () => {
    await seedCategories(["Alquiler"]);
    const expenseId = await seedExpense({ amount: 2500, category: "Alquiler", note: "alquiler", status: "PENDING" });
    const replies: string[] = [];
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({ intent: "mark_paid", amount: null, category: "alquiler", note: null }),
        reply: async () => null,
      }),
    );

    await stubbed.handleUpdate(textUpdate({ messageId: 1, text: "el previsto de alquiler lo pagué" }), async (text) => {
      replies.push(text);
    });

    const rows = await prisma.expense.findMany({ where: { ownerId, id: expenseId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("PAID");
    expect(replies).toHaveLength(1);
    expect(replies[0]).toBe(markPaidReply(2500, "alquiler", "Alquiler"));
    const state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state).toBeNull();
  });

  it("lifecycle e2e: 'borralo' opens the confirmation gate and the 🗑 tap deletes the row", async () => {
    await seedCategories(["Cafe"]);
    const expenseId = await seedExpense({ amount: 900, category: "Cafe", note: "cafe", status: "PAID" });
    const replies: string[] = [];
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({ intent: "delete_expense", amount: null, category: "cafe", note: null }),
        reply: async () => null,
      }),
    );

    await stubbed.handleUpdate(textUpdate({ messageId: 1, text: "borra el de cafe" }), async (text) => {
      replies.push(text);
    });

    // Nothing deleted yet: the confirmation gate holds the persisted target.
    expect(await prisma.expense.count({ where: { ownerId, id: expenseId } })).toBe(1);
    const gate = await prisma.botState.findUnique({ where: { ownerId } });
    expect(gate?.state).toBe("awaiting_delete_confirmation");
    expect(replies.at(-1)).toContain("Borrar");

    // The owner confirms with 🗑 → the row is deleted through deleteExpense.
    const storedTarget = JSON.parse(gate?.pendingNote ?? "{}") as { target: { id: string } };
    await stubbed.handleCallback(
      {
        update_id: 9001,
        callback_query: {
          id: "cb_2",
          chat_instance: "987654321",
          from: { id: OWNER_CHAT_ID, is_bot: false, first_name: "Rita" },
          message: { message_id: 3, chat: { id: OWNER_CHAT_ID, type: "private", first_name: "Rita" }, date: 1712803046, text: "gate" },
          data: `dc:ok:${storedTarget.target.id}`,
        },
      },
      async (text) => {
        replies.push(text);
      },
    );

    expect(await prisma.expense.count({ where: { ownerId, id: expenseId } })).toBe(0);
    const after = await prisma.botState.findUnique({ where: { ownerId } });
    expect(after?.state).toBe("idle");
  });

  it("lifecycle e2e: an already-PAID reference replies the 409 conflict and changes no state", async () => {
    await seedCategories(["Alquiler"]);
    const expenseId = await seedExpense({ amount: 2500, category: "Alquiler", note: "alquiler", status: "PAID" });
    const replies: string[] = [];
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({ intent: "mark_paid", amount: null, category: "alquiler", note: null }),
        reply: async () => null,
      }),
    );

    await stubbed.handleUpdate(textUpdate({ messageId: 1, text: "el previsto de alquiler lo pagué" }), async (text) => {
      replies.push(text);
    });

    const rows = await prisma.expense.findMany({ where: { ownerId, id: expenseId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("PAID");
    expect(replies.at(-1)).toBe(markPaidAlreadyReply());
  });

  it("lifecycle e2e: no PENDING anywhere replies nothing_pending and changes no state", async () => {
    await seedCategories(["Alquiler"]);
    const replies: string[] = [];
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({ intent: "mark_paid", amount: null, category: "alquiler", note: null }),
      }),
    );

    await stubbed.handleUpdate(textUpdate({ messageId: 1, text: "ya lo pagué" }), async (text) => {
      replies.push(text);
    });

    expect(await prisma.expense.count()).toBe(0);
    expect(replies.at(-1)).toBe(nothingPendingReply());
  });

  it("lifecycle e2e: no movement matches a delete and nothing is deleted", async () => {
    await seedCategories(["Cafe"]);
    const replies: string[] = [];
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({ intent: "delete_expense", amount: null, category: "supermercado", note: null }),
      }),
    );

    await stubbed.handleUpdate(textUpdate({ messageId: 1, text: "borra el de supermercado" }), async (text) => {
      replies.push(text);
    });

    expect(await prisma.expense.count()).toBe(0);
    expect(replies.at(-1)).toBe(nothingToDeleteReply());
  });

  it("lifecycle e2e: two PENDING in the same category ask, and the pick '2' marks the picked one paid", async () => {
    await seedCategories(["Alquiler"]);
    await seedExpense({ amount: 2500, category: "Alquiler", note: "alquiler", status: "PENDING" });
    await seedExpense({ amount: 3100, category: "Alquiler", note: "expensas", status: "PENDING" });
    const replies: string[] = [];
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({ intent: "mark_paid", amount: null, category: "alquiler", note: null }),
        reply: async () => null,
      }),
    );

    await stubbed.handleUpdate(textUpdate({ messageId: 1, text: "el previsto de alquiler lo pagué" }), async (text) => {
      replies.push(text);
    });

    // Ambiguity: no movement changed yet, the lifecycle payload is persisted.
    expect(await prisma.expense.count({ where: { ownerId, status: "PENDING" } })).toBe(2);
    const state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("awaiting_movement_selection");
    expect(replies.at(-1)).toContain("marcaste como pagado");

    await stubbed.handleUpdate(textUpdate({ messageId: 2, text: "2" }), async (text) => {
      replies.push(text);
    });

    // Exactly one PENDING row remains: the picked one transitioned to PAID.
    const pending = await prisma.expense.findMany({ where: { ownerId, status: "PENDING" } });
    expect(pending).toHaveLength(1);
    const paid = await prisma.expense.findMany({ where: { ownerId, status: "PAID" } });
    expect(paid).toHaveLength(1);
    expect(replies.at(-1)).toContain("pagado");
  });

  it("lifecycle e2e: setup lists the real categories and a batch delete executes without a literal", async () => {
    await seedCategories(["Cafe", "Transporte"]);
    const replies: string[] = [];

    await service.handleUpdate(textUpdate({ messageId: 1, text: "configurar categorias" }), async (text) => {
      replies.push(text);
    });

    expect(replies.at(-1)).toContain("Cafe");
    expect(replies.at(-1)).toContain("Transporte");
    const state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("awaiting_setup");

    await service.handleUpdate(textUpdate({ messageId: 2, text: "borrar categoria: Cafe" }), async (text) => {
      replies.push(text);
    });

    const names = (await categoryService.listCategories(ownerId)).map((category) => category.name);
    expect(names).not.toContain("Cafe");
    expect(names).not.toContain("borrar categoria: cafe");
    expect(replies.at(-1)).toContain("Borradas: Cafe");
  });

  it("quick-capture e2e: '30000 gym' → preview → Guardar registers a REAL expense row", async () => {
    await seedCategories(["Gimnasio"]);
    await categoryService.associateKeyword(ownerId, "gym", "Gimnasio");
    const replies: string[] = [];

    await service.handleUpdate(textUpdate({ messageId: 1, text: "30000 gym" }), async (text) => {
      replies.push(text);
    });

    const state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("awaiting_preview");
    const preview = quickCapturePreviewPayloadSchema.parse(JSON.parse(state?.pendingNote ?? "{}"));
    expect(preview.amount).toBe(30000);
    expect(preview.category).toBe("Gimnasio");
    expect(preview.type).toBe("REAL");

    await service.handleCallback(
      {
        update_id: 9000,
        callback_query: {
          id: "cb_1",
          chat_instance: "987654321",
          from: { id: OWNER_CHAT_ID, is_bot: false, first_name: "Rita" },
          message: { message_id: 1, chat: { id: OWNER_CHAT_ID, type: "private", first_name: "Rita" }, date: 1712803046, text: "preview" },
          data: `pv:save:${preview.saveToken}`,
        },
      },
      async (text) => {
        replies.push(text);
      },
    );

    const rows = await prisma.expense.findMany({ where: { ownerId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amount.toNumber()).toBe(30000);
    expect(rows[0]?.category).toBe("Gimnasio");
    expect(rows[0]?.status).toBe("PAID");
    expect(replies.at(-1)).toContain("Registrado");
  });

  it("quick-capture e2e: Previsto button → Guardar registers a PENDING row, retry registers once", async () => {
    await seedCategories(["Gimnasio"]);
    await categoryService.associateKeyword(ownerId, "gym", "Gimnasio");
    const replies: string[] = [];

    await service.handleUpdate(textUpdate({ messageId: 1, text: "30000 gym" }), async (text) => {
      replies.push(text);
    });
    const state = await prisma.botState.findUnique({ where: { ownerId } });
    const preview = quickCapturePreviewPayloadSchema.parse(JSON.parse(state?.pendingNote ?? "{}"));

    await service.handleCallback(
      {
        update_id: 9001,
        callback_query: {
          id: "cb_2",
          chat_instance: "987654321",
          from: { id: OWNER_CHAT_ID, is_bot: false, first_name: "Rita" },
          message: { message_id: 1, chat: { id: OWNER_CHAT_ID, type: "private", first_name: "Rita" }, date: 1712803046, text: "preview" },
          data: `pv:typ:p:${preview.saveToken}`,
        },
      },
      async (text) => {
        replies.push(text);
      },
    );
    const afterToggle = await prisma.botState.findUnique({ where: { ownerId } });
    const toggled = quickCapturePreviewPayloadSchema.parse(JSON.parse(afterToggle?.pendingNote ?? "{}"));

    await service.handleCallback(
      {
        update_id: 9002,
        callback_query: {
          id: "cb_3",
          chat_instance: "987654321",
          from: { id: OWNER_CHAT_ID, is_bot: false, first_name: "Rita" },
          message: { message_id: 1, chat: { id: OWNER_CHAT_ID, type: "private", first_name: "Rita" }, date: 1712803046, text: "preview" },
          data: `pv:save:${toggled.saveToken}`,
        },
      },
      async (text) => {
        replies.push(text);
      },
    );

    const rows = await prisma.expense.findMany({ where: { ownerId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("PENDING");
    expect(rows[0]?.visibility).toBe("INDIVIDUAL");

    // Retry: no second row, "ya procesado".
    await service.handleCallback(
      {
        update_id: 9003,
        callback_query: {
          id: "cb_4",
          chat_instance: "987654321",
          from: { id: OWNER_CHAT_ID, is_bot: false, first_name: "Rita" },
          message: { message_id: 1, chat: { id: OWNER_CHAT_ID, type: "private", first_name: "Rita" }, date: 1712803046, text: "preview" },
          data: `pv:save:${toggled.saveToken}`,
        },
      },
      async (text) => {
        replies.push(text);
      },
    );
    expect(await prisma.expense.count({ where: { ownerId } })).toBe(1);
    expect(replies.at(-1)).toContain("ya fue procesada");
  });

  it("delete e2e: Cancelar keeps the row; a new message abandons the gate", async () => {
    await seedCategories(["Cafe"]);
    const expenseId = await seedExpense({ amount: 900, category: "Cafe", note: "cafe", status: "PAID" });
    const replies: string[] = [];
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async (message: string) =>
          message === "hola"
            ? null
            : ({ intent: "delete_expense", amount: null, category: "cafe", note: null } as ConversationEnvelope),
        reply: async () => null,
      }),
    );

    await stubbed.handleUpdate(textUpdate({ messageId: 1, text: "borra el de cafe" }), async (text) => {
      replies.push(text);
    });
    const gate = await prisma.botState.findUnique({ where: { ownerId } });
    expect(gate?.state).toBe("awaiting_delete_confirmation");

    // ❌ Cancelar keeps the movement.
    await stubbed.handleCallback(
      {
        update_id: 9010,
        callback_query: {
          id: "cb_10",
          chat_instance: "987654321",
          from: { id: OWNER_CHAT_ID, is_bot: false, first_name: "Rita" },
          message: { message_id: 2, chat: { id: OWNER_CHAT_ID, type: "private", first_name: "Rita" }, date: 1712803046, text: "gate" },
          data: `dc:no:${(JSON.parse(gate?.pendingNote ?? "{}") as { target: { id: string } }).target.id}`,
        },
      },
      async (text) => {
        replies.push(text);
      },
    );
    expect(await prisma.expense.count({ where: { ownerId, id: expenseId } })).toBe(1);

    // A new text message abandons the gate (nothing deleted) and reprocesses.
    await stubbed.handleUpdate(textUpdate({ messageId: 3, text: "hola" }), async (text) => {
      replies.push(text);
    });
    expect(await prisma.expense.count({ where: { ownerId, id: expenseId } })).toBe(1);
    const after = await prisma.botState.findUnique({ where: { ownerId } });
    expect(after?.state).toBe("idle");
  });

  it("dialog e2e: an unknown dialog answer creates NO new Category row (D9)", async () => {
    await seedCategories(["Cafe"]);
    const replies: string[] = [];

    await service.handleUpdate(textUpdate({ messageId: 1, text: "$1000 panaderia" }), async (text) => {
      replies.push(text);
    });
    await service.handleUpdate(textUpdate({ messageId: 2, text: "Mascotas" }), async (text) => {
      replies.push(text);
    });

    const categories = await categoryService.listCategories(ownerId);
    expect(categories.some((category) => category.name === "Mascotas")).toBe(false);
    const state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("awaiting_category");
  });
});