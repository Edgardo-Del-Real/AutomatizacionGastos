/**
 * One-off owner-scoped cleanup runbook (design "Migration / Rollout", proposal
 * "Cleanup"): removes the phantom categories created by the pre-guard bot
 * ("No.", "Borrar categoría: no", "si", "gasto provisorio") and, when present,
 * the historical junk expense (30000 PAID in "No."), backing up every
 * to-be-deleted row to `apps/api/.cleanup-backups/`.
 *
 * Run against the REAL database (`automatizacionrita`), NEVER the `_test` DB:
 *   pnpm --filter @rita/api exec tsx src/scripts/cleanup-phantom-data.ts --dry-run   (default: report only)
 *   pnpm --filter @rita/api exec tsx src/scripts/cleanup-phantom-data.ts --write      (apply after backup)
 *
 * Safety (D14):
 * - `--dry-run` is the DEFAULT: it reports the phantoms/junk found and writes
 *   NOTHING (no backup, no deletion). `--write` is required to apply.
 * - Owner-scoped: every read/write filters by `OWNER_ID` (default "default").
 * - Pre-asserted: the FULL expected phantom set must be present to delete;
 *   an already-clean state prints "already clean" and exits 0 (safe re-run);
 *   any partial drift of the phantom set aborts with exit 1 before touching
 *   anything. Junk/valid expenses are OPTIONAL evidence (the DB evolved during
 *   real use — the 30000 PAID moved to "otro" and the owner deleted the valid
 *   PENDING through the bot), never a delete contract by themselves.
 * - Row backup: every to-be-deleted row is written as full JSON BEFORE any
 *   deletion; restore = re-insert from the backup file.
 * - Deletion goes through the guarded services (CategoryService guards and
 *   ExpenseService.deleteExpense), never raw prisma deletes.
 * - Post-verified: phantoms gone (and junk gone when it existed); exit 0 only
 *   when every assertion passes.
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

// Historical junk/valid evidence from when the script was authored. The real
// DB evolved: the 30000 PAID moved to "otro" (dialog rewrite) and the valid
// PENDING "gastos hormiga" was deleted by the owner through the bot during the
// 2026-09-30 test. The CONTRACT is the phantom categories; junk/valid are
// optional evidence only — the script never fabricates or deletes outside them.
const JUNK_EXPENSE = { amount: 30000, category: "No.", status: "PAID" } as const;

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

/** D14 — the write flag is EXPLICIT: absent means dry-run (report only, write nothing). */
function parseWriteFlag(argv: string[]): boolean {
  return argv.includes("--write");
}

async function main(): Promise<number> {
  const ownerId = env.OWNER_ID;
  const apply = parseWriteFlag(process.argv.slice(2));
  console.log(`[cleanup] owner: ${ownerId} · mode: ${apply ? "WRITE" : "DRY-RUN"}`);
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
  // The junk expense is optional evidence: it existed when this script was
  // authored, but the real DB evolved (the 30000 PAID is now in "otro"). If it
  // exists we delete it too; if not, that is NOT drift — the categories are the
  // contract and the valid PENDING must stay untouched.
  const junkExpense = expenses.find(
    (expense) =>
      expense.amount.toNumber() === JUNK_EXPENSE.amount &&
      expense.category === JUNK_EXPENSE.category &&
      expense.status === JUNK_EXPENSE.status,
  );

  const phantomNames = phantoms.map((category) => category.name);

  // Already clean (safe re-run): no phantoms. The junk/valid expenses are
  // optional evidence — only their PRESENCE in the backup matters, not their
  // absence (the owner deleted the valid PENDING during the 2026-09-30 test).
  if (phantomNames.length === 0) {
    console.log("[cleanup] already clean: no phantom categories to remove.");
    return 0;
  }

  // D14 — the DRY-RUN report lists what WOULD be deleted and writes nothing;
  // the pre-assert still runs so a partial drift aborts even in dry-run.
  assert(
    phantomNames.length === PHANTOM_CATEGORY_NAMES.length,
    `partial drift: expected phantoms [${PHANTOM_CATEGORY_NAMES.join(", ")}], found [${phantomNames.join(", ")}]`,
  );

  if (!apply) {
    console.log("[cleanup] DRY-RUN: nothing was written. Found:");
    for (const phantom of phantoms) {
      console.log(`  - phantom category "${phantom.name}" (id ${phantom.id})`);
    }
    if (junkExpense !== undefined) {
      console.log(`  - junk expense ${junkExpense.id} (${JUNK_EXPENSE.amount}, "${junkExpense.note ?? ""}", category "No.")`);
    }
    console.log("[cleanup] Re-run with --write (after a DB backup) to apply.");
    return 0;
  }

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
  if (junkExpense !== undefined) {
    await expenseService.deleteExpense(junkExpense.id, ownerId);
    console.log(`[cleanup] deleted junk expense ${junkExpense.id} (${JUNK_EXPENSE.amount}, "${junkExpense.note ?? ""}")`);
  }
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
  if (junkExpense !== undefined) {
    assert(!afterExpenses.some((expense) => expense.id === junkExpense.id), "junk expense still present after cleanup");
  }

  console.log("[cleanup] done: phantom categories removed, backup written, junk deleted if present.");
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