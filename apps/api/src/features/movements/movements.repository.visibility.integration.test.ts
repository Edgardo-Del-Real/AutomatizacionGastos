import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadDotEnvFromDisk } from "../../config/load-env";
import { PrismaMovementRepository } from "./movements.repository";
import type { ViewerScope } from "./movements.types";

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

describe("movement visibility model", () => {
  const testDatabaseUrl = resolveTestDatabaseUrl();
  let prisma: PrismaClient;
  let repository: PrismaMovementRepository;

  beforeAll(async () => {
    execSync("npx --no-install prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
      stdio: "pipe",
    });
    prisma = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    repository = new PrismaMovementRepository(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.expense.deleteMany();
  });

  async function readVisibility(id: string): Promise<string> {
    const rows = await prisma.$queryRaw<{ visibility: string }[]>`
      SELECT "visibility" FROM "Expense" WHERE "id" = ${id}
    `;
    return rows[0]?.visibility ?? "NO_ROW";
  }

  describe("default and backfill (spec: Movement Visibility Model)", () => {
    it("stores a movement created without an explicit visibility as INDIVIDUAL", async () => {
      const row = await prisma.expense.create({
        data: {
          ownerId: "rita",
          amount: new Prisma.Decimal(2500),
          currency: "ARS",
          category: "casa",
          note: "super",
          occurredAt: new Date("2026-09-01T12:00:00.000Z"),
          type: "EXPENSE",
        },
      });

      expect(await readVisibility(row.id)).toBe("INDIVIDUAL");
    });

    it("backfills rows inserted without the visibility column to INDIVIDUAL via the DEFAULT", async () => {
      // Simulates a pre-migration row: the column is not referenced at all, so
      // only the ADD COLUMN ... NOT NULL DEFAULT 'INDIVIDUAL' can fill it.
      await prisma.$executeRaw`
        INSERT INTO "Expense" ("id", "ownerId", "amount", "currency", "category", "note", "occurredAt", "type")
        VALUES ('backfill-1', 'rita', 1000, 'ARS', NULL, 'viejo', '2026-09-01T12:00:00.000Z'::timestamp, 'EXPENSE'::"MovementType")
      `;

      expect(await readVisibility("backfill-1")).toBe("INDIVIDUAL");
    });

    it("pins the migration contract: CREATE TYPE + ADD COLUMN NOT NULL DEFAULT 'INDIVIDUAL'", () => {
      const migration = readFileSync(
        join(process.cwd(), "prisma", "migrations", "20260921130000_movement_visibility", "migration.sql"),
        "utf8",
      );

      expect(migration).toContain('CREATE TYPE "MovementVisibility" AS ENUM');
      expect(migration).toContain('ADD COLUMN "visibility" "MovementVisibility" NOT NULL DEFAULT \'INDIVIDUAL\'');
    });
  });

  describe("viewer-scoped read predicate (spec: Viewer-Scoped Read Predicate)", () => {
    const BA_NOW_OFFSET_MS = 3 * 60 * 60 * 1000;
    const now = new Date(Date.now() - BA_NOW_OFFSET_MS);

    const RITA_MINE = 100;
    const RITA_SHARED = 200;
    const EDGARDO_MINE = 300;
    const EDGARDO_SHARED = 400;

    async function seedHousehold(): Promise<void> {
      await prisma.expense.createMany({
        data: [
          {
            ownerId: "rita",
            amount: RITA_MINE,
            currency: "ARS",
            category: "casa",
            note: "rita individual",
            occurredAt: now,
            type: "EXPENSE",
            visibility: "INDIVIDUAL",
          },
          {
            ownerId: "rita",
            amount: RITA_SHARED,
            currency: "ARS",
            category: "alquiler",
            note: "rita shared",
            occurredAt: now,
            type: "EXPENSE",
            visibility: "SHARED",
          },
          {
            ownerId: "edgardo",
            amount: EDGARDO_MINE,
            currency: "ARS",
            category: "auto",
            note: "edgardo individual",
            occurredAt: now,
            type: "EXPENSE",
            visibility: "INDIVIDUAL",
          },
          {
            ownerId: "edgardo",
            amount: EDGARDO_SHARED,
            currency: "ARS",
            category: "comida",
            note: "edgardo shared",
            occurredAt: now,
            type: "EXPENSE",
            visibility: "SHARED",
          },
        ],
      });
    }

    const rita: ViewerScope = { viewerId: "rita", partnerId: "edgardo", visibility: "mine" };
    const ritaShared: ViewerScope = { viewerId: "rita", partnerId: "edgardo", visibility: "shared" };
    const ritaAll: ViewerScope = { viewerId: "rita", partnerId: "edgardo", visibility: "all" };
    const edgardo: ViewerScope = { viewerId: "edgardo", partnerId: "rita", visibility: "mine" };
    const edgardoShared: ViewerScope = { viewerId: "edgardo", partnerId: "rita", visibility: "shared" };
    const edgardoAll: ViewerScope = { viewerId: "edgardo", partnerId: "rita", visibility: "all" };

    function notesOf(rows: { note: string | null }[]): string[] {
      return rows.map((row) => row.note ?? "").sort();
    }

    it("returns exactly the viewer's own movements for visibility=mine", async () => {
      await seedHousehold();

      expect(notesOf(await repository.listByOwner(rita, {}))).toEqual(["rita individual", "rita shared"]);
      expect(notesOf(await repository.listByOwner(edgardo, {}))).toEqual(["edgardo individual", "edgardo shared"]);
    });

    it("returns only SHARED movements visible to the viewer for visibility=shared", async () => {
      await seedHousehold();

      expect(notesOf(await repository.listByOwner(ritaShared, {}))).toEqual(["edgardo shared", "rita shared"]);
      expect(notesOf(await repository.listByOwner(edgardoShared, {}))).toEqual(["edgardo shared", "rita shared"]);
    });

    it("returns own movements plus the partner's SHARED ones for visibility=all", async () => {
      await seedHousehold();

      expect(notesOf(await repository.listByOwner(ritaAll, {}))).toEqual([
        "edgardo shared",
        "rita individual",
        "rita shared",
      ]);
      expect(notesOf(await repository.listByOwner(edgardoAll, {}))).toEqual([
        "edgardo individual",
        "edgardo shared",
        "rita shared",
      ]);
    });

    it("leak guard: neither owner ever sees the other's INDIVIDUAL movement (both directions)", async () => {
      await seedHousehold();

      const ritaAllNotes = notesOf(await repository.listByOwner(ritaAll, {}));
      const edgardoAllNotes = notesOf(await repository.listByOwner(edgardoAll, {}));

      expect(ritaAllNotes).not.toContain("edgardo individual");
      expect(edgardoAllNotes).not.toContain("rita individual");
    });

    it("reduces to owner-only when the viewer has no partner (single-user mode)", async () => {
      await seedHousehold();
      const soloAll: ViewerScope = { viewerId: "rita", partnerId: null, visibility: "all" };
      const soloShared: ViewerScope = { viewerId: "rita", partnerId: null, visibility: "shared" };

      expect(notesOf(await repository.listByOwner(soloAll, {}))).toEqual(["rita individual", "rita shared"]);
      expect(notesOf(await repository.listByOwner(soloShared, {}))).toEqual(["rita shared"]);
    });

    it("emits visibility and registrantId on every mapped movement row", async () => {
      await seedHousehold();

      const rows = await repository.listByOwner(ritaAll, {});
      const shared = rows.find((row) => row.note === "edgardo shared");

      expect(shared?.visibility).toBe("SHARED");
      expect(shared?.registrantId).toBe("edgardo");
      const own = rows.find((row) => row.note === "rita individual");
      expect(own?.visibility).toBe("INDIVIDUAL");
      expect(own?.registrantId).toBe("rita");
    });

    it("scopes every summary feed (kpis/months/daily/categories/top) by the viewer predicate", async () => {
      await seedHousehold();

      const [kpisMine, kpisAll, monthsAll, dailyAll, categoriesAll, topAll] = await Promise.all([
        repository.summaryKpis(rita, { from: undefined, to: undefined }),
        repository.summaryKpis(ritaAll, { from: undefined, to: undefined }),
        repository.summaryMonths(ritaAll),
        repository.summaryDaily(ritaAll),
        repository.summaryCategories(ritaAll, { from: undefined, to: undefined }),
        repository.topByType(ritaAll, "EXPENSE", 10, { from: undefined, to: undefined }),
      ]);

      // mine: rita's own 100 + 200
      expect(kpisMine.expenses).toBe(RITA_MINE + RITA_SHARED);
      expect(kpisMine.count).toBe(2);
      // all: rita's own + edgardo's SHARED (400), never edgardo's INDIVIDUAL (300)
      expect(kpisAll.expenses).toBe(RITA_MINE + RITA_SHARED + EDGARDO_SHARED);
      expect(kpisAll.count).toBe(3);
      expect(kpisAll.expenses).not.toBe(RITA_MINE + RITA_SHARED + EDGARDO_MINE + EDGARDO_SHARED);

      // months and daily buckets: same scoped totals
      const monthBucket = monthsAll.find((bucket) => bucket.expenses > 0);
      expect(monthBucket?.expenses).toBe(RITA_MINE + RITA_SHARED + EDGARDO_SHARED);
      const dayBucket = dailyAll.find((bucket) => bucket.expenses > 0);
      expect(dayBucket?.expenses).toBe(RITA_MINE + RITA_SHARED + EDGARDO_SHARED);

      // categories: edgardo's INDIVIDUAL "auto" must never appear
      const categoryNames = categoriesAll.map((category) => category.name);
      expect(categoryNames).toContain("casa");
      expect(categoryNames).toContain("alquiler");
      expect(categoryNames).toContain("comida");
      expect(categoryNames).not.toContain("auto");
      const comida = categoriesAll.find((category) => category.name === "comida");
      expect(comida?.expenseAmount).toBe(EDGARDO_SHARED);

      // top: same scoped set, ordered by amount desc
      const topNotes = topAll.map((movement) => movement.note).sort();
      expect(topNotes).toEqual(["edgardo shared", "rita individual", "rita shared"]);
    });
  });
});