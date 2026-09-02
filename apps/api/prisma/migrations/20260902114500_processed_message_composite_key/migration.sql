-- Prune legacy WhatsApp rows (retry guard only; no business readers).
-- Must run first so the NOT NULL add lands on an empty table.
DELETE FROM "ProcessedMessage";

-- AlterTable
ALTER TABLE "ProcessedMessage" ADD COLUMN "chatId" TEXT NOT NULL DEFAULT '';

-- DropIndex
DROP INDEX "ProcessedMessage_messageId_key";

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedMessage_chatId_messageId_key" ON "ProcessedMessage"("chatId", "messageId");