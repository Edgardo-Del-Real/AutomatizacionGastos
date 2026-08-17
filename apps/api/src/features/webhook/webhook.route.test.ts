import { execSync } from "node:child_process";
import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { env } from "../../config/env";
import { loadDotEnvFromDisk } from "../../config/load-env";

loadDotEnvFromDisk();

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

function sign(rawBody: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

function textWebhook(messageId: string, from: string, body: string): string {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "e1",
        changes: [{ value: { messaging_product: "whatsapp", messages: [{ id: messageId, from, type: "text", text: { body } }] } }],
      },
    ],
  });
}

describe("whatsapp webhook route", () => {
  const testDatabaseUrl = resolveTestDatabaseUrl();
  let app: FastifyInstance;
  let prisma: PrismaClient;

  beforeAll(async () => {
    execSync("npx --no-install prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
      stdio: "pipe",
    });
    prisma = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    app = buildApp({ prisma });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.processedMessage.deleteMany();
    await prisma.expense.deleteMany();
  });

  function post(rawBody: string, headers: Record<string, string> = {}) {
    return app.inject({
      method: "POST",
      url: "/webhook/whatsapp",
      headers: { "content-type": "application/json", ...headers },
      payload: rawBody,
    });
  }

  describe("GET /webhook/whatsapp (verification handshake)", () => {
    it("returns the challenge when the verify token matches", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=${env.WHATSAPP_VERIFY_TOKEN}&hub.challenge=CHALLENGE_123`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/plain");
      expect(response.body).toBe("CHALLENGE_123");
    });

    it("rejects with 403 when the verify token does not match", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=CHALLENGE_123",
      });

      expect(response.statusCode).toBe(403);
    });

    it("rejects with 403 when the mode is not subscribe", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/webhook/whatsapp?hub.mode=other&hub.verify_token=${env.WHATSAPP_VERIFY_TOKEN}&hub.challenge=CHALLENGE_123`,
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe("POST /webhook/whatsapp", () => {
    it("creates a ProcessedMessage and an Expense for a valid text message from the owner", async () => {
      const rawBody = textWebhook("wamid_valid_1", env.WHATSAPP_OWNER_PHONE, "café 2.500");

      const response = await post(rawBody, { "x-hub-signature-256": sign(rawBody, env.WHATSAPP_APP_SECRET) });

      expect(response.statusCode).toBe(200);
      const processed = await prisma.processedMessage.findUnique({ where: { messageId: "wamid_valid_1" } });
      expect(processed).not.toBeNull();
      expect(processed?.ownerId).toBe(env.OWNER_ID);
      const expenses = await prisma.expense.findMany({ where: { ownerId: env.OWNER_ID } });
      expect(expenses).toHaveLength(1);
      expect(expenses[0]?.amount.toNumber()).toBe(2500);
      expect(expenses[0]?.currency).toBe("ARS");
      expect(expenses[0]?.note).toBe("café");
    });

    it("answers 200 on a duplicate message id and does not create a second expense", async () => {
      const rawBody = textWebhook("wamid_dupe_1", env.WHATSAPP_OWNER_PHONE, "café 2.500");
      const headers = { "x-hub-signature-256": sign(rawBody, env.WHATSAPP_APP_SECRET) };

      const first = await post(rawBody, headers);
      const second = await post(rawBody, headers);

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(await prisma.processedMessage.count()).toBe(1);
      expect(await prisma.expense.count()).toBe(1);
    });

    it("rejects with 401 when the signature is wrong", async () => {
      const rawBody = textWebhook("wamid_bad_1", env.WHATSAPP_OWNER_PHONE, "café 2.500");

      const response = await post(rawBody, { "x-hub-signature-256": "sha256=deadbeef" });

      expect(response.statusCode).toBe(401);
      expect(await prisma.processedMessage.count()).toBe(0);
      expect(await prisma.expense.count()).toBe(0);
    });

    it("rejects with 401 when the signature is missing", async () => {
      const rawBody = textWebhook("wamid_nosig_1", env.WHATSAPP_OWNER_PHONE, "café 2.500");

      const response = await post(rawBody);

      expect(response.statusCode).toBe(401);
    });

    it("answers 200 and does nothing for a status-only payload", async () => {
      const rawBody = JSON.stringify({
        object: "whatsapp_business_account",
        entry: [{ id: "e1", changes: [{ value: { statuses: [{ id: "s1" }] } }] }],
      });

      const response = await post(rawBody, { "x-hub-signature-256": sign(rawBody, env.WHATSAPP_APP_SECRET) });

      expect(response.statusCode).toBe(200);
      expect(await prisma.processedMessage.count()).toBe(0);
      expect(await prisma.expense.count()).toBe(0);
    });

    it("records the message but creates no expense when no amount is found", async () => {
      const rawBody = textWebhook("wamid_noamount_1", env.WHATSAPP_OWNER_PHONE, "hola");

      const response = await post(rawBody, { "x-hub-signature-256": sign(rawBody, env.WHATSAPP_APP_SECRET) });

      expect(response.statusCode).toBe(200);
      expect(await prisma.processedMessage.count()).toBe(1);
      expect(await prisma.expense.count()).toBe(0);
    });

    it("records the message but creates no expense for a non-owner phone", async () => {
      const rawBody = textWebhook("wamid_other_1", "+5491199999999", "café 2.500");

      const response = await post(rawBody, { "x-hub-signature-256": sign(rawBody, env.WHATSAPP_APP_SECRET) });

      expect(response.statusCode).toBe(200);
      expect(await prisma.processedMessage.count()).toBe(1);
      expect(await prisma.expense.count()).toBe(0);
    });

    it("answers 200 for a malformed body with a valid signature", async () => {
      const rawBody = "{this is not json";

      const response = await post(rawBody, { "x-hub-signature-256": sign(rawBody, env.WHATSAPP_APP_SECRET) });

      expect(response.statusCode).toBe(200);
      expect(await prisma.processedMessage.count()).toBe(0);
      expect(await prisma.expense.count()).toBe(0);
    });
  });
});
