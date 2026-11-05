-- recurring-fixed-expense: templates the bot asks about before loading them.

CREATE TABLE "RecurringExpense" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "category" TEXT NOT NULL,
    "notifyDay" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringExpense_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecurringConfirmation" (
    "id" TEXT NOT NULL,
    "recurringId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "messageId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "remindedAt" TIMESTAMP(3),

    CONSTRAINT "RecurringConfirmation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RecurringExpense_ownerId_idx" ON "RecurringExpense"("ownerId");
CREATE INDEX "RecurringExpense_active_nextRunAt_idx" ON "RecurringExpense"("active", "nextRunAt");
CREATE UNIQUE INDEX "RecurringConfirmation_recurringId_period_key" ON "RecurringConfirmation"("recurringId", "period");
CREATE INDEX "RecurringConfirmation_status_createdAt_idx" ON "RecurringConfirmation"("status", "createdAt");

ALTER TABLE "RecurringConfirmation"
  ADD CONSTRAINT "RecurringConfirmation_recurringId_fkey"
  FOREIGN KEY ("recurringId") REFERENCES "RecurringExpense"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
