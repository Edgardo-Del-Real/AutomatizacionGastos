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
import type { BotBrain, ConversationEnvelope } from "./bot-brain";
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

  it("brain: a redirect intent creates no movement and replies honestly", async () => {
    await seedCategories([]);
    const replies: string[] = [];
    const stubbed = buildService(
      () => undefined,
      stubBrain({
        interpret: async () => ({ intent: "query_balance", amount: null, category: null, note: null }),
        reply: async () => "Todavía no puedo consultar el balance.",
      }),
    );

    await stubbed.handleUpdate(textUpdate({ messageId: 1, text: "cuánto gasté?" }), async (text) => {
      replies.push(text);
    });

    expect(await prisma.expense.count()).toBe(0);
    // A redirect never writes state: no row means the owner stays idle.
    const state = await prisma.botState.findUnique({ where: { ownerId } });
    expect(state).toBeNull();
    expect(replies.at(-1)).toBe("Todavía no puedo consultar el balance.");
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
});