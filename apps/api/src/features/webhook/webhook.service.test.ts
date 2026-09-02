import { createHmac } from "node:crypto";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UnauthorizedError } from "../../infra/errors";
import type { ExpenseService } from "../expenses/expenses.service";
import type { ProcessedMessageRepository } from "../messages/message.repository";
import { WebhookService } from "./webhook.service";

const secret = "test-app-secret";
const ownerPhone = "+5491100000000";
const ownerId = "default";

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    "Unique constraint failed on the fields: (`chatId`,`messageId`)",
    { code: "P2002", clientVersion: "6.0.0", meta: { target: ["chatId_messageId"] } },
  );
}

function signature(rawBody: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

function buildPayload(messages: unknown[]): unknown {
  return { object: "whatsapp_business_account", entry: [{ id: "e1", changes: [{ value: { messages } }] }] };
}

function textMessage(id: string, from: string, body: string): unknown {
  return { id, from, type: "text", text: { body } };
}

function incoming(messages: unknown[]): { payload: unknown; rawBody: string; signature: string } {
  const payload = buildPayload(messages);
  const rawBody = JSON.stringify(payload);
  return { payload, rawBody, signature: signature(rawBody) };
}

describe("WebhookService", () => {
  let messageRepository: ProcessedMessageRepository;
  let expenseService: ExpenseService;
  let mockRecord: ReturnType<typeof vi.fn>;
  let mockCreateExpense: ReturnType<typeof vi.fn>;
  let service: WebhookService;

  beforeEach(() => {
    messageRepository = { recordProcessed: vi.fn() } as unknown as ProcessedMessageRepository;
    expenseService = { createExpense: vi.fn() } as unknown as ExpenseService;
    mockRecord = vi.mocked(messageRepository.recordProcessed);
    mockCreateExpense = vi.mocked(expenseService.createExpense);
    service = new WebhookService({ messageRepository, expenseService, appSecret: secret, ownerPhone, ownerId });
  });

  it("rejects a request with an invalid signature without touching the repository", async () => {
    const { payload, rawBody } = incoming([textMessage("wamid_1", ownerPhone, "café 2.500")]);

    await expect(service.handleIncoming(payload, rawBody, "sha256=deadbeef")).rejects.toBeInstanceOf(
      UnauthorizedError,
    );

    expect(mockRecord).not.toHaveBeenCalled();
    expect(mockCreateExpense).not.toHaveBeenCalled();
  });

  it("records the message and creates an expense for a valid text message from the owner", async () => {
    const { payload, rawBody, signature: valid } = incoming([textMessage("wamid_1", ownerPhone, "café 2.500")]);
    mockCreateExpense.mockResolvedValue(undefined);

    await service.handleIncoming(payload, rawBody, valid);

    expect(mockRecord).toHaveBeenCalledWith(ownerPhone, "wamid_1", ownerId);
    expect(mockCreateExpense).toHaveBeenCalledTimes(1);
    expect(mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2500, currency: "ARS", note: "café" }),
      ownerId,
    );
  });

  it("persists the classified INCOME type for a keyword message", async () => {
    const { payload, rawBody, signature: valid } = incoming([textMessage("wamid_inc_1", ownerPhone, "sueldo 50000")]);
    mockCreateExpense.mockResolvedValue(undefined);

    await service.handleIncoming(payload, rawBody, valid);

    expect(mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 50000, note: "sueldo", type: "INCOME" }),
      ownerId,
    );
  });

  it("persists the classified INCOME type for a plus-prefixed amount", async () => {
    const { payload, rawBody, signature: valid } = incoming([textMessage("wamid_inc_2", ownerPhone, "+5000")]);
    mockCreateExpense.mockResolvedValue(undefined);

    await service.handleIncoming(payload, rawBody, valid);

    expect(mockCreateExpense).toHaveBeenCalledWith(expect.objectContaining({ amount: 5000, type: "INCOME" }), ownerId);
  });

  it("persists the classified EXPENSE type for a plain expense message", async () => {
    const { payload, rawBody, signature: valid } = incoming([textMessage("wamid_exp_1", ownerPhone, "café 2.500")]);
    mockCreateExpense.mockResolvedValue(undefined);

    await service.handleIncoming(payload, rawBody, valid);

    expect(mockCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2500, note: "café", type: "EXPENSE" }),
      ownerId,
    );
  });

  it("skips a message that was already processed (unique violation) without creating an expense", async () => {
    const { payload, rawBody, signature: valid } = incoming([textMessage("wamid_1", ownerPhone, "café 2.500")]);
    mockRecord.mockRejectedValue(uniqueViolation());

    await expect(service.handleIncoming(payload, rawBody, valid)).resolves.toBeUndefined();

    expect(mockCreateExpense).not.toHaveBeenCalled();
  });

  it("records the message but does not create an expense when no amount is found", async () => {
    const { payload, rawBody, signature: valid } = incoming([textMessage("wamid_1", ownerPhone, "hola")]);

    await service.handleIncoming(payload, rawBody, valid);

    expect(mockRecord).toHaveBeenCalledWith(ownerPhone, "wamid_1", ownerId);
    expect(mockCreateExpense).not.toHaveBeenCalled();
  });

  it("records the message but does not create an expense for a non-owner phone", async () => {
    const { payload, rawBody, signature: valid } = incoming([
      textMessage("wamid_1", "+5491199999999", "café 2.500"),
    ]);

    await service.handleIncoming(payload, rawBody, valid);

    expect(mockRecord).toHaveBeenCalledWith("+5491199999999", "wamid_1", ownerId);
    expect(mockCreateExpense).not.toHaveBeenCalled();
  });

  it("does not create an expense for a non-text message", async () => {
    const message = { id: "wamid_2", from: ownerPhone, type: "image", image: { id: "img_1" } };
    const { payload, rawBody, signature: valid } = incoming([message]);

    await service.handleIncoming(payload, rawBody, valid);

    expect(mockRecord).toHaveBeenCalledWith(ownerPhone, "wamid_2", ownerId);
    expect(mockCreateExpense).not.toHaveBeenCalled();
  });

  it("ignores payloads without messages (status updates)", async () => {
    const payload = { object: "whatsapp_business_account", entry: [{ id: "e1", changes: [{ value: { statuses: [{ id: "s1" }] } }] }] };
    const rawBody = JSON.stringify(payload);

    await service.handleIncoming(payload, rawBody, signature(rawBody));

    expect(mockRecord).not.toHaveBeenCalled();
    expect(mockCreateExpense).not.toHaveBeenCalled();
  });

  it("processes every message of a batch and skips already-processed ones", async () => {
    const { payload, rawBody, signature: valid } = incoming([
      textMessage("m1", ownerPhone, "pan 100"),
      textMessage("m2", ownerPhone, "leche 200"),
    ]);
    mockRecord.mockRejectedValueOnce(uniqueViolation()).mockResolvedValueOnce(undefined);

    await service.handleIncoming(payload, rawBody, valid);

    expect(mockRecord).toHaveBeenCalledTimes(2);
    expect(mockCreateExpense).toHaveBeenCalledTimes(1);
    expect(mockCreateExpense).toHaveBeenCalledWith(expect.objectContaining({ amount: 200, note: "leche" }), ownerId);
  });

  it("does not fail the batch when creating the expense fails", async () => {
    const { payload, rawBody, signature: valid } = incoming([textMessage("wamid_1", ownerPhone, "café 2.500")]);
    mockCreateExpense.mockRejectedValue(new Error("db down"));

    await expect(service.handleIncoming(payload, rawBody, valid)).resolves.toBeUndefined();
  });
});
