import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpenseService } from "../expenses/expenses.service";
import type { ProcessedMessageRepository } from "../messages/message.repository";
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

describe("TelegramService", () => {
  let messageRepository: ProcessedMessageRepository;
  let expenseService: ExpenseService;
  let mockRecord: ReturnType<typeof vi.fn>;
  let mockCreateExpense: ReturnType<typeof vi.fn>;
  let service: TelegramService;

  beforeEach(() => {
    messageRepository = { recordProcessed: vi.fn() } as unknown as ProcessedMessageRepository;
    expenseService = { createExpense: vi.fn() } as unknown as ExpenseService;
    mockRecord = vi.mocked(messageRepository.recordProcessed);
    mockCreateExpense = vi.mocked(expenseService.createExpense);
    service = new TelegramService({ messageRepository, expenseService, ownerChatId: OWNER_CHAT_ID, ownerId });
  });

  it("records the message and creates an expense for a valid text message from the owner", async () => {
    mockCreateExpense.mockResolvedValue(undefined);

    await service.handleUpdate(textUpdate());

    expect(mockRecord).toHaveBeenCalledWith("123456789", "42", ownerId);
    expect(mockCreateExpense).toHaveBeenCalledTimes(1);
    expect(mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2500, currency: "ARS", note: "café" }),
      ownerId,
    );
  });

  it("persists the classified INCOME type for a keyword message", async () => {
    mockCreateExpense.mockResolvedValue(undefined);

    await service.handleUpdate(textUpdate({ text: "Recibí $50000 de sueldo" }));

    expect(mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 50000, note: "Recibí $ de sueldo", type: "INCOME" }),
      ownerId,
    );
  });

  it("persists the classified INCOME type for a plus-prefixed amount", async () => {
    mockCreateExpense.mockResolvedValue(undefined);

    await service.handleUpdate(textUpdate({ text: "+5000" }));

    expect(mockCreateExpense).toHaveBeenCalledWith(expect.objectContaining({ amount: 5000, type: "INCOME" }), ownerId);
  });

  it("persists the classified EXPENSE type for a plain expense message", async () => {
    mockCreateExpense.mockResolvedValue(undefined);

    await service.handleUpdate(textUpdate({ text: "$2000 supermercado" }));

    expect(mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2000, note: "$ supermercado", type: "EXPENSE" }),
      ownerId,
    );
  });

  it("skips a message that was already processed (unique violation) without creating an expense", async () => {
    mockRecord.mockRejectedValue(uniqueViolation());

    await expect(service.handleUpdate(textUpdate())).resolves.toBeUndefined();

    expect(mockCreateExpense).not.toHaveBeenCalled();
  });

  it("records the message but does not create an expense when no amount is found", async () => {
    await service.handleUpdate(textUpdate({ text: "hola" }));

    expect(mockRecord).toHaveBeenCalledWith("123456789", "42", ownerId);
    expect(mockCreateExpense).not.toHaveBeenCalled();
  });

  it("records the message but does not create an expense for a non-owner sender", async () => {
    await service.handleUpdate(textUpdate({ fromId: 987654321 }));

    expect(mockRecord).toHaveBeenCalledWith("987654321", "42", ownerId);
    expect(mockCreateExpense).not.toHaveBeenCalled();
  });

  it("ignores an edited_message update without touching the repository", async () => {
    await service.handleUpdate({
      update_id: 2,
      edited_message: { message_id: 42, from: { id: OWNER_CHAT_ID }, chat: { id: OWNER_CHAT_ID, type: "private" }, text: "café 2500" },
    });

    expect(mockRecord).not.toHaveBeenCalled();
    expect(mockCreateExpense).not.toHaveBeenCalled();
  });

  it("ignores a non-text message without touching the repository", async () => {
    await service.handleUpdate({
      update_id: 3,
      message: {
        message_id: 43,
        from: { id: OWNER_CHAT_ID, is_bot: false, first_name: "Rita" },
        chat: { id: OWNER_CHAT_ID, type: "private" },
        date: 1712803046,
        photo: [{ file_id: "photo_1" }],
      },
    });

    expect(mockRecord).not.toHaveBeenCalled();
    expect(mockCreateExpense).not.toHaveBeenCalled();
  });

  it("ignores a group chat message without touching the repository", async () => {
    await service.handleUpdate(textUpdate({ chatType: "group", chatId: -100123456789 }));

    expect(mockRecord).not.toHaveBeenCalled();
    expect(mockCreateExpense).not.toHaveBeenCalled();
  });

  it("records and processes both messages when the same id arrives from different chats", async () => {
    mockCreateExpense.mockResolvedValue(undefined);

    await service.handleUpdate(textUpdate({ messageId: 777, chatId: 111111111, text: "pan 100" }));
    await service.handleUpdate(textUpdate({ messageId: 777, chatId: 222222222, text: "leche 200" }));

    expect(mockRecord).toHaveBeenCalledTimes(2);
    expect(mockRecord).toHaveBeenCalledWith("111111111", "777", ownerId);
    expect(mockRecord).toHaveBeenCalledWith("222222222", "777", ownerId);
    expect(mockCreateExpense).toHaveBeenCalledTimes(2);
  });

  it("does not fail the batch when creating the expense fails", async () => {
    mockCreateExpense.mockRejectedValue(new Error("db down"));

    await expect(service.handleUpdate(textUpdate())).resolves.toBeUndefined();
  });
});