import { describe, expect, it } from "vitest";
import { ValidationFailedError } from "../../infra/errors";
import type { SavingsRuleRepository } from "./savings.repository";
import { SavingsRuleService } from "./savings.service";
import type { SavingsRuleEntity } from "./savings.types";

/** In-memory fake mirroring the Prisma repository contract (oldest-wins order). */
function fakeRepository(initial: SavingsRuleEntity[] = []): SavingsRuleRepository & { rules: SavingsRuleEntity[] } {
  const rules: SavingsRuleEntity[] = [...initial];
  return {
    rules,
    async upsert(ownerId: string, keyword: string, percent: number): Promise<SavingsRuleEntity> {
      const existing = rules.find((rule) => rule.ownerId === ownerId && rule.keyword === keyword);
      if (existing !== undefined) {
        existing.percent = percent;
        return existing;
      }
      const rule: SavingsRuleEntity = {
        id: `rule-${rules.length + 1}`,
        ownerId,
        keyword,
        percent,
        createdAt: new Date(`2026-09-0${rules.length + 1}T12:00:00.000Z`),
      };
      rules.push(rule);
      return rule;
    },
    async listByOwner(ownerId: string): Promise<SavingsRuleEntity[]> {
      return rules
        .filter((rule) => rule.ownerId === ownerId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.keyword.localeCompare(b.keyword));
    },
  };
}

describe("SavingsRuleService.computeSplit", () => {
  const service = new SavingsRuleService(fakeRepository());

  it("splits 10 at 33% into 3.30 savings and 6.70 net, preserving the invariant exactly", () => {
    const { net, savings } = service.computeSplit(10, 33);
    expect(savings).toBe(3.3);
    expect(net).toBe(6.7);
    expect(net + savings).toBe(10);
  });

  it("splits 1000 at 10% into 900 net and 100 savings", () => {
    const { net, savings } = service.computeSplit(1000, 10);
    expect(net).toBe(900);
    expect(savings).toBe(100);
  });

  it("rounds half away from zero and keeps net + savings === gross (10.01 at 33%)", () => {
    const { net, savings } = service.computeSplit(10.01, 33);
    expect(savings).toBe(3.3);
    expect(net).toBe(6.71);
    expect(net + savings).toBe(10.01);
  });

  it("handles the tiny-amount edge: 0.01 at 50% rounds savings to 0.01 and net to 0", () => {
    const { net, savings } = service.computeSplit(0.01, 50);
    expect(savings).toBe(0.01);
    expect(net).toBe(0);
    expect(net + savings).toBe(0.01);
  });
});

describe("SavingsRuleService.defineRule", () => {
  it("creates a rule with the normalized keyword and the given percent", async () => {
    const repo = fakeRepository();
    const service = new SavingsRuleService(repo);
    const rule = await service.defineRule("owner-1", "Entrenuts", 10);
    expect(rule.ownerId).toBe("owner-1");
    expect(rule.keyword).toBe("entrenuts");
    expect(rule.percent).toBe(10);
    expect(repo.rules).toHaveLength(1);
  });

  it("rejects percent 0, 101 and -1 with a validation error", async () => {
    const repo = fakeRepository();
    const service = new SavingsRuleService(repo);
    for (const percent of [0, 101, -1]) {
      await expect(service.defineRule("owner-1", "entrenuts", percent)).rejects.toBeInstanceOf(ValidationFailedError);
    }
    expect(repo.rules).toHaveLength(0);
  });

  it("rejects a non-finite percent", async () => {
    const service = new SavingsRuleService(fakeRepository());
    await expect(service.defineRule("owner-1", "entrenuts", Number.NaN)).rejects.toBeInstanceOf(ValidationFailedError);
  });

  it("rejects an empty keyword", async () => {
    const service = new SavingsRuleService(fakeRepository());
    await expect(service.defineRule("owner-1", "   ", 10)).rejects.toBeInstanceOf(ValidationFailedError);
  });

  it("upserts: redefining an existing keyword replaces the percent without a duplicate", async () => {
    const repo = fakeRepository();
    const service = new SavingsRuleService(repo);
    await service.defineRule("owner-1", "entrenuts", 10);
    const redefined = await service.defineRule("owner-1", "entrenuts", 15);
    expect(redefined.percent).toBe(15);
    expect(repo.rules).toHaveLength(1);
    expect(repo.rules[0]?.percent).toBe(15);
  });

  it("scopes rules per owner: the same keyword under two owners creates two rules", async () => {
    const repo = fakeRepository();
    const service = new SavingsRuleService(repo);
    await service.defineRule("owner-1", "entrenuts", 10);
    await service.defineRule("owner-2", "entrenuts", 20);
    expect(repo.rules).toHaveLength(2);
  });
});

describe("SavingsRuleService.matchNote", () => {
  it("matches a word-boundary keyword and returns its percent", async () => {
    const service = new SavingsRuleService(
      fakeRepository([
        { id: "1", ownerId: "owner-1", keyword: "entrenuts", percent: 10, createdAt: new Date("2026-09-01T12:00:00.000Z") },
      ]),
    );
    await expect(service.matchNote("owner-1", "cobro sueldo de entrenuts 1000")).resolves.toBe(10);
  });

  it("is diacritic-insensitive: cafe matches café", async () => {
    const service = new SavingsRuleService(
      fakeRepository([
        { id: "1", ownerId: "owner-1", keyword: "cafe", percent: 5, createdAt: new Date("2026-09-01T12:00:00.000Z") },
      ]),
    );
    await expect(service.matchNote("owner-1", "cobré un café de 500")).resolves.toBe(5);
  });

  it("does not match a keyword inside another word (boundary)", async () => {
    const service = new SavingsRuleService(
      fakeRepository([
        { id: "1", ownerId: "owner-1", keyword: "entrenuts", percent: 10, createdAt: new Date("2026-09-01T12:00:00.000Z") },
      ]),
    );
    await expect(service.matchNote("owner-1", "cobro entrenut 1000")).resolves.toBeNull();
  });

  it("is oldest-wins when several rules match the same note", async () => {
    const service = new SavingsRuleService(
      fakeRepository([
        { id: "1", ownerId: "owner-1", keyword: "sueldo", percent: 5, createdAt: new Date("2026-09-01T12:00:00.000Z") },
        { id: "2", ownerId: "owner-1", keyword: "entrenuts", percent: 10, createdAt: new Date("2026-09-02T12:00:00.000Z") },
      ]),
    );
    await expect(service.matchNote("owner-1", "cobro sueldo de entrenuts 1000")).resolves.toBe(5);
  });

  it("returns null when no rule matches", async () => {
    const service = new SavingsRuleService(fakeRepository([]));
    await expect(service.matchNote("owner-1", "cobro de otro lado 1000")).resolves.toBeNull();
  });
});

describe("SavingsRuleService.resolveSplit", () => {
  it("returns whole when the override disables savings", async () => {
    const service = new SavingsRuleService(
      fakeRepository([
        { id: "1", ownerId: "owner-1", keyword: "entrenuts", percent: 10, createdAt: new Date("2026-09-01T12:00:00.000Z") },
      ]),
    );
    await expect(service.resolveSplit("owner-1", "cobro sueldo de entrenuts 1000", { kind: "disabled" })).resolves.toEqual({
      kind: "whole",
    });
  });

  it("returns whole when no rule matches and no override is present", async () => {
    const service = new SavingsRuleService(fakeRepository([]));
    await expect(service.resolveSplit("owner-1", "cobro de otro lado 1000", { kind: "none" })).resolves.toEqual({
      kind: "whole",
    });
  });

  it("returns a split with the rule percent when the note matches", async () => {
    const service = new SavingsRuleService(
      fakeRepository([
        { id: "1", ownerId: "owner-1", keyword: "entrenuts", percent: 10, createdAt: new Date("2026-09-01T12:00:00.000Z") },
      ]),
    );
    await expect(service.resolveSplit("owner-1", "cobro sueldo de entrenuts 1000", { kind: "none" })).resolves.toEqual({
      kind: "split",
      percent: 10,
    });
  });

  it("replaces the rule percent with the override percent for this message only (D8)", async () => {
    const service = new SavingsRuleService(
      fakeRepository([
        { id: "1", ownerId: "owner-1", keyword: "entrenuts", percent: 10, createdAt: new Date("2026-09-01T12:00:00.000Z") },
      ]),
    );
    await expect(service.resolveSplit("owner-1", "cobro sueldo de entrenuts 1000", { kind: "percent", percent: 5 })).resolves.toEqual({
      kind: "split",
      percent: 5,
    });
  });

  it("applies the override percent even when no rule exists (rule-free override)", async () => {
    const service = new SavingsRuleService(fakeRepository([]));
    await expect(service.resolveSplit("owner-1", "cobro cualquiera 1000", { kind: "percent", percent: 5 })).resolves.toEqual({
      kind: "split",
      percent: 5,
    });
  });
});