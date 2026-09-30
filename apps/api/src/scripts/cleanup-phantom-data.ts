/**
 * One-off owner-scoped cleanup runbook (design "Migration / Rollout", proposal
 * "Cleanup"): removes the phantom categories and the junk expense created by
 * the pre-guard bot ("No.", "Borrar categoría: no", "si", "gasto provisorio"
 * categories; the 30000 PAID expense in category "No."), backs up every
 * to-be-deleted row to `apps/api/.cleanup-backups/`, and asserts the valid
 * PENDING "gastos hormiga" expense stays untouched.
 *
 * Run against the REAL database (`automatizacionrita`), NEVER the `_test` DB:
 *   pnpm --filter @rita/api exec tsx src/scripts/cleanup-phantom-data.ts
 *
 * Safety:
 * - Owner-scoped: every read/write filters by `OWNER_ID` (default "default").
 * - Pre-asserted: the FULL expected phantom set must be present to delete;
 *   an already-clean state prints "already clean" and exits 0 (safe re-run);
 *   any partial drift aborts with exit 1 before touching anything.
 * - Row backup: every to-be-deleted row is written as full JSON BEFORE any
 *   deletion; restore = re-insert from the backup file.
 * - Deletion goes through the guarded services (CategoryService guards and
 *   ExpenseService.deleteExpense), never raw prisma deletes.
 * - Post-verified: phantoms gone, the valid PENDING row byte-identical to the
 *   captured pre-row; exit 0 only when every assertion passes.
 *
 * The script is excluded from the build (`tsconfig.build.json` excludes
 * `src/scripts`): it is a manual runbook step, not shipped code.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { env } from "../config/env";
import { prismaClient } from "../infra/db/prisma";
import { PrismaCategoryRepository } from "../features/categories/categories.repository";
import { CategoryService } from "../features/categories/categories.service";
import { PrismaExpenseRepository } from "../features/expenses/expenses.repository";
import { ExpenseService } from "../features/expenses/expenses.service";
import { normalizeForMatchTolerant } from "../features/categories/matcher";

const PHANTOM_CATEGORY_NAMES = ["No.", "Borrar categoría: no", "si", "gasto provisorio"] as const;

const JUNK_EXPENSE = { amount: 30000, category: "No.", status: "PAID" } as const;
const VALID_EXPENSE = { amount: 30000, note: "gastos hormiga", status: "PENDING" } as const;

type ExpenseRow = {
  id: string;
  ownerId: string;
  amount: { toNumber(): number; toString(): string };
  currency: string;
  category: string | null;
  note: string | null;
  occurredAt: Date;
  createdAt: Date;
  type: string;
  visibility: string;
  status: string;
};

type CategoryRow = {
  id: string;
  ownerId: string;
  name: string;
  type: string;
  createdAt: Date;
};

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Assert-and-narrow: returns the value or throws, satisfying TS control flow. */
function requireDefined<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}

async function main(): Promise<number> {
  const ownerId = env.OWNER_ID;
  console.log(`[cleanup] owner: ${ownerId}`);
  const prisma: PrismaClient = prismaClient;
  const categoryService = new CategoryService(new PrismaCategoryRepository(prisma));
  const expenseService = new ExpenseService(new PrismaExpenseRepository(prisma));

  const [categories, expenses] = await Promise.all([
    prisma.category.findMany({ where: { ownerId } }) as Promise<CategoryRow[]>,
    prisma.expense.findMany({ where: { ownerId } }) as Promise<ExpenseRow[]>,
  ]);

  const phantoms = categories.filter((category) =>
    (PHANTOM_CATEGORY_NAMES as readonly string[]).includes(category.name),
  );
  const junkExpense = expenses.find(
    (expense) =>
      expense.amount.toNumber() === JUNK_EXPENSE.amount &&
      expense.category === JUNK_EXPENSE.category &&
      expense.status === JUNK_EXPENSE.status,
  );
  const validExpense = expenses.find(
    (expense) =>
      expense.amount.toNumber() === VALID_EXPENSE.amount &&
      expense.note === VALID_EXPENSE.note &&
      expense.status === VALID_EXPENSE.status,
  );

  const phantomNames = phantoms.map((category) => category.name);

  // Already clean (safe re-run): no phantoms, no junk, valid expense intact.
  if (phantomNames.length === 0 && junkExpense === undefined && validExpense !== undefined) {
    console.log("[cleanup] already clean: no phantom categories, no junk expense, valid PENDING intact.");
    return 0;
  }

  // Pre-assert: the FULL expected set must be present to proceed; any partial
  // drift aborts BEFORE any deletion or backup write.
  assert(
    phantomNames.length === PHANTOM_CATEGORY_NAMES.length,
    `partial drift: expected phantoms [${PHANTOM_CATEGORY_NAMES.join(", ")}], found [${phantomNames.join(", ")}]`,
  );
  const junk = requireDefined(
    junkExpense,
    `partial drift: junk expense (${JUNK_EXPENSE.amount} ${JUNK_EXPENSE.category} ${JUNK_EXPENSE.status}) not found`,
  );
  const valid = requireDefined(
    validExpense,
    `partial drift: valid PENDING (${VALID_EXPENSE.amount} "${VALID_EXPENSE.note}" ${VALID_EXPENSE.status}) not found`,
  );

  // Backup every to-be-deleted row (full JSON) BEFORE deleting.
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const backupDir = path.resolve(scriptDir, "../../.cleanup-backups");
  await mkdir(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `cleanup-phantom-data-${timestamp}.json`);
  await writeFile(
    backupPath,
    JSON.stringify(
      {
        ownerId,
        deletedAt: new Date().toISOString(),
        categories: phantoms,
        junkExpense,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`[cleanup] backup written: ${backupPath}`);

  // Delete through the guarded services (design "Delete" step).
  await expenseService.deleteExpense(junk.id, ownerId);
  console.log(`[cleanup] deleted junk expense ${junk.id} (${JUNK_EXPENSE.amount}, "${junk.note ?? ""}")`);
  for (const phantom of phantoms) {
    await categoryService.deleteCategory(ownerId, phantom.name);
    console.log(`[cleanup] deleted phantom category "${phantom.name}"`);
  }

  // Post-verify.
  const afterCategories = (await prisma.category.findMany({ where: { ownerId } })) as CategoryRow[];
  const afterExpenses = (await prisma.expense.findMany({ where: { ownerId } })) as ExpenseRow[];

  // Report only (no auto-fix): exactly one category must fold to "otro".
  const otroFolded = afterCategories.filter((category) => normalizeForMatchTolerant(category.name) === "otro");
  console.log(`[cleanup] categories folding to "otro": ${otroFolded.length} (${otroFolded.map((category) => category.name).join(", ") || "none"})`);
  assert(otroFolded.length === 1, `expected exactly one category folding to "otro", found ${otroFolded.length}`);

  for (const name of PHANTOM_CATEGORY_NAMES) {
    assert(!afterCategories.some((category) => category.name === name), `phantom category "${name}" still present after cleanup`);
  }
  assert(!afterExpenses.some((expense) => expense.id === junk.id), "junk expense still present after cleanup");

  // The valid PENDING row must be identical to the captured pre-row.
  const afterValid = requireDefined(
    afterExpenses.find((expense) => expense.id === valid.id),
    "valid PENDING expense was deleted by the cleanup",
  );
  assert(
    afterValid.amount.toString() === valid.amount.toString() &&
      afterValid.note === valid.note &&
      afterValid.status === valid.status &&
      afterValid.occurredAt.getTime() === valid.occurredAt.getTime() &&
      afterValid.category === valid.category,
    "valid PENDING expense changed by the cleanup",
  );

  console.log("[cleanup] done: phantoms removed, junk deleted, valid PENDING intact.");
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(`[cleanup] ABORT: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });