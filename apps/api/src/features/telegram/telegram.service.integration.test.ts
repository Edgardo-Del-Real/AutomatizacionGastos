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
import { formatARS } from "./reply-text";
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
    expect(learned).toHaveLength(0);
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

  it("correction: a multi-word non-category answer lists the categories and keeps the state open", async () => {
    await seedCategories(["Cafe"]);
    const replies: string[] = [];
    const reply = async (text: string): Promise<void> => {
      replies.push(text);
    };

    await service.handleUpdate(textUpdate({ messageId: 1, text: "$1000 panaderia" }), reply);
    await service.handleUpdate(textUpdate({ messageId: 2, text: "no se qué categoria" }), reply);

    const state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state?.state).toBe("awaiting_category");
    expect(replies.at(-1)).toContain("No encontré la categoría");
    expect(replies.at(-1)).toContain("Cafe");

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

  it("learning: a later note containing an explicitly associated keyword auto-matches", async () => {
    await seedCategories(["Transporte"]);
    const reply = async (): Promise<void> => undefined;

    await service.handleUpdate(
      textUpdate({ messageId: 1, text: "asociar palabra: uber a categoria: Transporte" }),
      reply,
    );
    await service.handleUpdate(textUpdate({ messageId: 2, text: "$500 uber al aeropuerto" }), reply);

    const movements = await prisma.expense.findMany({ where: { ownerId }, orderBy: { createdAt: "asc" } });
    expect(movements).toHaveLength(1);
    expect(movements[0]?.category).toBe("Transporte");
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

    // Deterministic bot (no brain): both prefix orders register PENDING rows.
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
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.status === "PENDING")).toBe(true);
    expect(rows.every((row) => row.type === "EXPENSE")).toBe(true);
    expect(rows.map((row) => row.visibility).sort()).toEqual(["INDIVIDUAL", "SHARED", "SHARED"]);
    expect(replies.join("\n")).toContain("previsto");
    // The KPIs exclude PENDING: only the planned block reports the total.
    const summary = await new MovementService(new PrismaMovementRepository(prisma), categoryService).getSummary({
      viewerId: ownerId,
      partnerId: null,
      visibility: "all",
    });
    expect(summary.kpis.expenses).toBe(0);
    expect(summary.planned.total).toBe(5200);

    // "¿cuánto tengo previsto?" answers 5200 from real data through the brain path.
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
    expect(queryReplies.at(-1)).toContain(formatARS(5200));

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
});