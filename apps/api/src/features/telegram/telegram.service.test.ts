import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpenseService } from "../expenses/expenses.service";
import type { ProcessedMessageRepository } from "../messages/message.repository";
import type { MovementService } from "../movements/movements.service";
import type { CategoryService } from "../categories/categories.service";
import type { BotStateRepository, BotStateRecord } from "./bot-state.repository";
import { TelegramService } from "./telegram.service";

const OWNER_CHAT_ID = 123456789;
const ownerId = "default";

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    "Unique constraint failed on the fields: (`chatId`,`messageId`)",
    { code: "P2002", clientVersion: "6.0.0", meta: { target: ["chatId_messageId"] } },
  );
}

function textUpdate(overrides?: { fromId?: number; chatId?: number; messageId?: number; text?: string; chatType?: string }): unknown {
  const fromId = overrides?.fromId ?? OWNER_CHAT_ID;
  return {
    update_id: 8000,
    message: {
      message_id: overrides?.messageId ?? 42,
      from: { id: fromId, is_bot: false, first_name: "Rita" },
      chat: { id: overrides?.chatId ?? fromId, type: overrides?.chatType ?? "private", first_name: "Rita" },
      date: 1712803046,
      text: overrides?.text ?? "café 2500",
    },
  };
}

type Harness = {
  service: TelegramService;
  messageRepository: ProcessedMessageRepository;
  expenseService: ExpenseService;
  movementService: MovementService;
  categoryService: CategoryService;
  botStateRepository: BotStateRepository;
  mockRecord: ReturnType<typeof vi.fn>;
  mockCreateExpense: ReturnType<typeof vi.fn>;
  mockUpdateMovement: ReturnType<typeof vi.fn>;
  mockListCategories: ReturnType<typeof vi.fn>;
  mockMatchNote: ReturnType<typeof vi.fn>;
  mockCreateCategory: ReturnType<typeof vi.fn>;
  mockAssociateKeyword: ReturnType<typeof vi.fn>;
  mockRenameCategory: ReturnType<typeof vi.fn>;
  mockEnsureOtro: ReturnType<typeof vi.fn>;
  mockSetState: ReturnType<typeof vi.fn>;
  mockLogger: ReturnType<typeof vi.fn>;
  replies: string[];
  reply: (text: string) => Promise<void>;
};

function makeHarness(): Harness {
  const replies: string[] = [];
  const reply = async (text: string): Promise<void> => {
    replies.push(text);
  };

  let storedState: BotStateRecord | null = null;

  const messageRepository = { recordProcessed: vi.fn() } as unknown as ProcessedMessageRepository;
  const expenseService = {
    createExpense: vi.fn(async () => ({
      id: "mov-1",
      ownerId,
      amount: 100,
      currency: "ARS",
      category: null,
      note: null,
      occurredAt: new Date(),
      createdAt: new Date(),
      type: "EXPENSE",
    })),
  } as unknown as ExpenseService;
  const movementService = {
    updateMovement: vi.fn(async (ownerIdArg: string, id: string, patch: unknown) => ({
      id,
      ownerId: ownerIdArg,
      amount: 100,
      currency: "ARS",
      category: null,
      note: null,
      occurredAt: new Date(),
      createdAt: new Date(),
      type: "EXPENSE",
      ...(patch as Record<string, unknown>),
    })),
  } as unknown as MovementService;
  const categoryService = {
    listCategories: vi.fn(async () => []),
    matchNote: vi.fn(async () => null),
    createCategory: vi.fn(async (owner: string, name: string) => ({
      id: `cat-${name}`,
      ownerId: owner,
      name,
      createdAt: new Date(),
    })),
    associateKeyword: vi.fn(async () => undefined),
    renameCategory: vi.fn(async () => null),
    ensureOtro: vi.fn(async (owner: string) => ({
      id: "otro-id",
      ownerId: owner,
      name: "otro",
      createdAt: new Date(),
    })),
    assertOwnerCategory: vi.fn(async () => undefined),
  } as unknown as CategoryService;
  const botStateRepository = {
    get: vi.fn(async () => storedState),
    set: vi.fn(async (state: BotStateRecord) => {
      storedState = state;
    }),
    clear: vi.fn(async () => {
      storedState = null;
    }),
  } as unknown as BotStateRepository;
  const mockLogger = vi.fn();

  const service = new TelegramService({
    messageRepository,
    expenseService,
    movementService,
    categoryService,
    botStateRepository,
    ownerChatId: OWNER_CHAT_ID,
    ownerId,
    logger: mockLogger,
  });

  return {
    service,
    messageRepository,
    expenseService,
    movementService,
    categoryService,
    botStateRepository,
    mockRecord: vi.mocked(messageRepository.recordProcessed),
    mockCreateExpense: vi.mocked(expenseService.createExpense),
    mockUpdateMovement: vi.mocked(movementService.updateMovement),
    mockListCategories: vi.mocked(categoryService.listCategories),
    mockMatchNote: vi.mocked(categoryService.matchNote),
    mockCreateCategory: vi.mocked(categoryService.createCategory),
    mockAssociateKeyword: vi.mocked(categoryService.associateKeyword),
    mockRenameCategory: vi.mocked(categoryService.renameCategory),
    mockEnsureOtro: vi.mocked(categoryService.ensureOtro),
    mockSetState: vi.mocked(botStateRepository.set),
    mockLogger,
    replies,
    reply,
  };
}

describe("TelegramService state machine", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });

  it("enters awaiting_setup for a valid registration when the owner has no categories, without persisting (D7)", async () => {
    await h.service.handleUpdate(textUpdate(), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockSetState).toHaveBeenCalledWith({
      ownerId,
      state: "awaiting_setup",
      pendingMovementId: null,
      pendingNote: null,
    });
    expect(h.replies.join("\n")).toContain("categorías");
  });

  it("creates the listed categories plus 'otro' from a newline-separated setup reply", async () => {
    h.mockSetState.mockClear();
    await h.service.handleUpdate(textUpdate({ text: "$2500 cafe", messageId: 1 }), h.reply);
    await h.service.handleUpdate(textUpdate({ text: "Cafe\nTransporte", messageId: 2 }), h.reply);

    expect(h.mockCreateCategory).toHaveBeenCalledWith(ownerId, "Cafe");
    expect(h.mockCreateCategory).toHaveBeenCalledWith(ownerId, "Transporte");
    expect(h.mockEnsureOtro).toHaveBeenCalledWith(ownerId);
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
    expect(h.replies.at(-1)).toContain("Cafe");
  });

  it("accepts comma-separated setup replies", async () => {
    await h.service.handleUpdate(textUpdate({ text: "$2500 cafe", messageId: 1 }), h.reply);
    await h.service.handleUpdate(textUpdate({ text: "Cafe, Transporte", messageId: 2 }), h.reply);

    expect(h.mockCreateCategory).toHaveBeenCalledWith(ownerId, "Cafe");
    expect(h.mockCreateCategory).toHaveBeenCalledWith(ownerId, "Transporte");
    expect(h.mockEnsureOtro).toHaveBeenCalledWith(ownerId);
  });

  it("dedupes setup names by normalized value", async () => {
    await h.service.handleUpdate(textUpdate({ text: "$2500 cafe", messageId: 1 }), h.reply);
    await h.service.handleUpdate(textUpdate({ text: "Cafe\ncafé", messageId: 2 }), h.reply);

    expect(h.mockCreateCategory).toHaveBeenCalledTimes(1);
    expect(h.mockCreateCategory).toHaveBeenCalledWith(ownerId, "Cafe");
  });

  it("re-asks and stays in awaiting_setup when the setup reply has no names", async () => {
    await h.service.handleUpdate(textUpdate({ text: "$2500 cafe", messageId: 1 }), h.reply);
    const before = h.replies.length;
    await h.service.handleUpdate(textUpdate({ text: "   ,  ", messageId: 2 }), h.reply);

    expect(h.mockCreateCategory).not.toHaveBeenCalled();
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "awaiting_setup",
      pendingMovementId: null,
      pendingNote: null,
    });
    expect(h.replies.length).toBeGreaterThan(before);
  });

  it("skips categories that already exist during setup (append semantics)", async () => {
    h.mockListCategories
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        { id: "c1", ownerId, name: "Cafe", createdAt: new Date(), keywords: [] },
      ]);
    await h.service.handleUpdate(textUpdate({ text: "$2500 cafe", messageId: 1 }), h.reply);
    await h.service.handleUpdate(textUpdate({ text: "Cafe\nSalud", messageId: 2 }), h.reply);

    expect(h.mockCreateCategory).toHaveBeenCalledTimes(1);
    expect(h.mockCreateCategory).toHaveBeenCalledWith(ownerId, "Salud");
    expect(h.mockEnsureOtro).toHaveBeenCalledWith(ownerId);
  });

  it("handles 'configurar categorias' by entering awaiting_setup without removing existing categories", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "Cafe", createdAt: new Date(), keywords: [] },
    ]);

    await h.service.handleUpdate(textUpdate({ text: "configurar categorias", messageId: 1 }), h.reply);

    expect(h.mockSetState).toHaveBeenCalledWith({
      ownerId,
      state: "awaiting_setup",
      pendingMovementId: null,
      pendingNote: null,
    });
    expect(h.replies.at(-1)).toContain("categorías");

    await h.service.handleUpdate(textUpdate({ text: "Salud", messageId: 2 }), h.reply);
    expect(h.mockCreateCategory).toHaveBeenCalledWith(ownerId, "Salud");
    expect(h.mockCreateCategory).not.toHaveBeenCalledWith(ownerId, "Cafe");
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
  });

  it("creates the movement with 'otro' and enters awaiting_category when nothing matches", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]);

    await h.service.handleUpdate(textUpdate({ text: "$2000 supermercado", messageId: 9 }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2000, category: "otro", type: "EXPENSE" }),
      ownerId,
    );
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "awaiting_category",
      pendingMovementId: "mov-1",
      pendingNote: "$ supermercado",
    });
    expect(h.replies.at(-1)).toContain("supermercado");
  });

  it("answers a correction by reassigning the pending movement and learning the note's first word", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
      { id: "c2", ownerId, name: "Transporte", createdAt: new Date(), keywords: [] },
    ]);

    await h.service.handleUpdate(textUpdate({ text: "$1200 uber viaje", messageId: 9 }), h.reply);
    await h.service.handleUpdate(textUpdate({ text: "Transporte", messageId: 10 }), h.reply);

    expect(h.mockUpdateMovement).toHaveBeenCalledWith(ownerId, "mov-1", { category: "Transporte" });
    expect(h.mockAssociateKeyword).toHaveBeenCalledWith(ownerId, "uber", "Transporte");
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
  });

  it("auto-creates an unknown single-word answer category and applies it (D6 rule 3)", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]);
    h.mockCreateCategory.mockResolvedValue({
      id: "cat-Mascotas",
      ownerId,
      name: "Mascotas",
      createdAt: new Date(),
    });

    await h.service.handleUpdate(textUpdate({ text: "$8000 veterinaria", messageId: 9 }), h.reply);
    await h.service.handleUpdate(textUpdate({ text: "Mascotas", messageId: 10 }), h.reply);

    expect(h.mockCreateCategory).toHaveBeenCalledWith(ownerId, "Mascotas");
    expect(h.mockUpdateMovement).toHaveBeenCalledWith(ownerId, "mov-1", { category: "Mascotas" });
    expect(h.mockAssociateKeyword).toHaveBeenCalledWith(ownerId, "veterinaria", "Mascotas");
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
  });

  it("skips keyword learning when the pending note has no significant word", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]);

    await h.service.handleUpdate(textUpdate({ text: "8000", messageId: 9 }), h.reply);
    await h.service.handleUpdate(textUpdate({ text: "Transporte", messageId: 10 }), h.reply);

    expect(h.mockAssociateKeyword).not.toHaveBeenCalled();
  });

  it("resolves a correction after a restart by reading the persisted state (restart survival)", async () => {
    h.mockSetState.mockClear();
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
      { id: "c2", ownerId, name: "Transporte", createdAt: new Date(), keywords: [] },
    ]);
    // The process "restarts": only the persisted state remains.
    const botStateRepository = h.botStateRepository;
    await botStateRepository.set({
      ownerId,
      state: "awaiting_category",
      pendingMovementId: "mov-9",
      pendingNote: "uber viaje",
    });

    await h.service.handleUpdate(textUpdate({ text: "Transporte", messageId: 42 }), h.reply);

    expect(h.mockUpdateMovement).toHaveBeenCalledWith(ownerId, "mov-9", { category: "Transporte" });
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
  });

  it("records and creates a matched movement with the matched category and a success reply", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "Cafe", createdAt: new Date(), keywords: [] },
      { id: "c2", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]);
    h.mockMatchNote.mockResolvedValue("Cafe");

    await h.service.handleUpdate(textUpdate({ text: "$2500 cafe", messageId: 11 }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2500, category: "Cafe" }),
      ownerId,
    );
    expect(h.replies.at(-1)).toContain("Cafe");
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
  });

  it("replies with help for an unparseable message and creates nothing", async () => {
    await h.service.handleUpdate(textUpdate({ text: "hola" }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toContain("No entendí");
  });

  it("does not reply to a non-owner sender", async () => {
    await h.service.handleUpdate(textUpdate({ fromId: 987654321 }), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.replies).toHaveLength(0);
  });

  it("skips a duplicate message without replying", async () => {
    h.mockRecord.mockRejectedValue(uniqueViolation());

    await h.service.handleUpdate(textUpdate(), h.reply);

    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.replies).toHaveLength(0);
  });

  it("tolerates a movement-creation failure by logging and continuing", async () => {
    h.mockCreateExpense.mockRejectedValue(new Error("db down"));
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]);

    await expect(h.service.handleUpdate(textUpdate(), h.reply)).resolves.toBeUndefined();
    expect(h.mockLogger).toHaveBeenCalled();
  });

  it("tolerates a reply failure by logging and continuing", async () => {
    const failingReply = async (): Promise<void> => {
      throw new Error("telegram api down");
    };

    await expect(h.service.handleUpdate(textUpdate({ text: "hola" }), failingReply)).resolves.toBeUndefined();
    expect(h.mockLogger).toHaveBeenCalled();
  });

  it("keeps processing subsequent messages after a reply failure", async () => {
    const failingReply = async (): Promise<void> => {
      throw new Error("telegram api down");
    };

    await h.service.handleUpdate(textUpdate({ text: "hola", messageId: 1 }), failingReply);
    await h.service.handleUpdate(textUpdate({ text: "hola de nuevo", messageId: 2 }), h.reply);

    expect(h.replies.at(-1)).toContain("No entendí");
  });

  it("persists the INCOME classification with the fallback category", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]);

    await h.service.handleUpdate(textUpdate({ text: "Recibí $50000 de sueldo", messageId: 12 }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 50000, category: "otro", type: "INCOME" }),
      ownerId,
    );
  });
});

describe("TelegramService ambiguity rules (awaiting_category, D6)", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]);
  });

  it('treats a lone "8000" as a NEW registration, not an answer', async () => {
    await h.service.handleUpdate(textUpdate({ text: "$1000 anterior", messageId: 1 }), h.reply);
    h.mockCreateExpense.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "8000", messageId: 2 }), h.reply);

    expect(h.mockUpdateMovement).not.toHaveBeenCalled();
    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 8000, note: null, category: "otro" }),
      ownerId,
    );
    // Re-enters the correction loop with the NEW pending movement.
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "awaiting_category",
      pendingMovementId: "mov-1",
      pendingNote: "8000",
    });
  });

  it('a category named "500" beats an amount-shaped answer', async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
      { id: "c2", ownerId, name: "500", createdAt: new Date(), keywords: [] },
    ]);

    await h.service.handleUpdate(textUpdate({ text: "$1000 anterior", messageId: 1 }), h.reply);
    h.mockCreateExpense.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "500", messageId: 2 }), h.reply);

    expect(h.mockUpdateMovement).toHaveBeenCalledWith(ownerId, "mov-1", { category: "500" });
    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
  });

  it("a multi-word category name is treated as the ANSWER", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
      { id: "c2", ownerId, name: "Gastos fijos", createdAt: new Date(), keywords: [] },
    ]);

    await h.service.handleUpdate(textUpdate({ text: "$1000 anterior", messageId: 1 }), h.reply);
    h.mockCreateExpense.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "Gastos fijos", messageId: 2 }), h.reply);

    expect(h.mockUpdateMovement).toHaveBeenCalledWith(ownerId, "mov-1", { category: "Gastos fijos" });
    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "idle",
      pendingMovementId: null,
      pendingNote: null,
    });
  });

  it('"$8000 super" during a correction is a NEW registration that re-enters the loop', async () => {
    await h.service.handleUpdate(textUpdate({ text: "$1000 anterior", messageId: 1 }), h.reply);
    h.mockCreateExpense.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "$8000 super", messageId: 2 }), h.reply);

    expect(h.mockUpdateMovement).not.toHaveBeenCalled();
    expect(h.mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 8000, note: "$ super", category: "otro" }),
      ownerId,
    );
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "awaiting_category",
      pendingMovementId: "mov-1",
      pendingNote: "$ super",
    });
  });

  it("a multi-word non-category non-amount reply falls through to the registration path (help)", async () => {
    await h.service.handleUpdate(textUpdate({ text: "$1000 anterior", messageId: 1 }), h.reply);
    h.mockCreateExpense.mockClear();

    await h.service.handleUpdate(textUpdate({ text: "no se qué categoría", messageId: 2 }), h.reply);

    expect(h.mockUpdateMovement).not.toHaveBeenCalled();
    expect(h.mockCreateExpense).not.toHaveBeenCalled();
    expect(h.replies.at(-1)).toContain("No entendí");
  });
});

describe("TelegramService commands", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });

  it("creates a category via 'registrar categoria: X'", async () => {
    await h.service.handleUpdate(textUpdate({ text: "registrar categoria: Salud", messageId: 1 }), h.reply);

    expect(h.mockCreateCategory).toHaveBeenCalledWith(ownerId, "Salud");
    expect(h.replies.at(-1)).toContain("Salud");
  });

  it("renames a category via 'renombrar categoria: X a: Y'", async () => {
    h.mockRenameCategory.mockResolvedValue({
      id: "c1",
      ownerId,
      name: "Cafeteria",
      createdAt: new Date(),
    });

    await h.service.handleUpdate(
      textUpdate({ text: "renombrar categoria: Cafe a: Cafeteria", messageId: 1 }),
      h.reply,
    );

    expect(h.mockRenameCategory).toHaveBeenCalledWith(ownerId, "Cafe", "Cafeteria");
    expect(h.replies.at(-1)).toContain("Cafeteria");
  });

  it("associates a keyword via 'asociar palabra: P a categoria: X'", async () => {
    await h.service.handleUpdate(
      textUpdate({ text: "asociar palabra: uber a categoria: Transporte", messageId: 1 }),
      h.reply,
    );

    expect(h.mockAssociateKeyword).toHaveBeenCalledWith(ownerId, "uber", "Transporte");
    expect(h.replies.at(-1)).toContain("uber");
  });

  it("lists categories via 'listar categorias'", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "Cafe", createdAt: new Date(), keywords: ["cafe"] },
    ]);

    await h.service.handleUpdate(textUpdate({ text: "listar categorias", messageId: 1 }), h.reply);

    expect(h.replies.at(-1)).toContain("Cafe");
  });

  it("lists an empty category set via 'listar categorias'", async () => {
    await h.service.handleUpdate(textUpdate({ text: "listar categorias", messageId: 1 }), h.reply);

    expect(h.replies.at(-1)).toBe("No hay categorías.");
  });

  it("processes commands during awaiting_category without consuming the pending correction", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]);
    await h.service.handleUpdate(textUpdate({ text: "$1000 anterior", messageId: 1 }), h.reply);

    await h.service.handleUpdate(textUpdate({ text: "listar categorias", messageId: 2 }), h.reply);

    expect(h.mockUpdateMovement).not.toHaveBeenCalled();
    expect(h.mockSetState).toHaveBeenLastCalledWith({
      ownerId,
      state: "awaiting_category",
      pendingMovementId: "mov-1",
      pendingNote: "$ anterior",
    });
  });

  it("falls through to registration for unrecognized text (not a command)", async () => {
    h.mockListCategories.mockResolvedValue([
      { id: "c1", ownerId, name: "otro", createdAt: new Date(), keywords: [] },
    ]);
    await h.service.handleUpdate(textUpdate({ text: "$2000 supermercado", messageId: 1 }), h.reply);

    expect(h.mockCreateExpense).toHaveBeenCalled();
  });
});