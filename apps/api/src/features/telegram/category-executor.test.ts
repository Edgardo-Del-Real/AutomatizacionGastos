import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError, ValidationFailedError } from "../../infra/errors";
import type { CategoryService } from "../categories/categories.service";
import type { ConversationEnvelope } from "./bot-brain";
import { CategoryExecutor } from "./category-executor";

function makeExecutor(overrides?: {
  createCategory?: ReturnType<typeof vi.fn>;
  deleteCategory?: ReturnType<typeof vi.fn>;
  renameCategory?: ReturnType<typeof vi.fn>;
}): {
  executor: CategoryExecutor;
  createCategory: ReturnType<typeof vi.fn>;
  deleteCategory: ReturnType<typeof vi.fn>;
  renameCategory: ReturnType<typeof vi.fn>;
} {
  const createCategory =
    overrides?.createCategory ?? vi.fn(async (owner: string, name: string) => ({ id: `c-${name}`, ownerId: owner, name, createdAt: new Date() }));
  const deleteCategory =
    overrides?.deleteCategory ?? vi.fn(async (owner: string, name: string) => ({ id: `c-${name}`, ownerId: owner, name, createdAt: new Date() }));
  const renameCategory =
    overrides?.renameCategory ?? vi.fn(async (owner: string, from: string, to: string) => ({ id: `c-${from}`, ownerId: owner, name: to, createdAt: new Date() }));
  const executor = new CategoryExecutor({ createCategory, deleteCategory, renameCategory } as unknown as CategoryService);
  return { executor, createCategory, deleteCategory, renameCategory };
}

function envelope(intent: ConversationEnvelope["intent"], category: string | null, newName?: string | null): ConversationEnvelope {
  return { intent, amount: null, category, note: null, ...(newName ? { new_name: newName } : {}) };
}

const OWNER = "default";

describe("CategoryExecutor.create", () => {
  let h: ReturnType<typeof makeExecutor>;

  beforeEach(() => {
    h = makeExecutor();
  });

  it("creates the category and reports the created name", async () => {
    const result = await h.executor.execute(OWNER, envelope("create_category", "Mascotas"));

    expect(h.createCategory).toHaveBeenCalledWith(OWNER, "Mascotas");
    expect(result).toMatchObject({ intent: "create_category", ok: true, action: "created", category: "Mascotas", error: null });
  });

  it("carries the duplicate error in the result instead of throwing", async () => {
    h = makeExecutor({
      createCategory: vi.fn(async () => {
        throw new ValidationFailedError('Category "Mascotas" already exists');
      }),
    });

    const result = await h.executor.execute(OWNER, envelope("create_category", "Mascotas"));

    expect(result.ok).toBe(false);
    expect(result.error).toBe("duplicate");
    expect(result.message).toContain("already exists");
  });

  it("reports a generic failure when the category name is missing, without calling the service", async () => {
    const result = await h.executor.execute(OWNER, envelope("create_category", null));

    expect(h.createCategory).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("unknown");
  });
});

describe("CategoryExecutor.delete", () => {
  let h: ReturnType<typeof makeExecutor>;

  beforeEach(() => {
    h = makeExecutor();
  });

  it("deletes the category and reports the deleted name", async () => {
    const result = await h.executor.execute(OWNER, envelope("delete_category", "Viajes"));

    expect(h.deleteCategory).toHaveBeenCalledWith(OWNER, "Viajes");
    expect(result).toMatchObject({ intent: "delete_category", ok: true, action: "deleted", category: "Viajes" });
  });

  it("carries the not-found error in the result instead of throwing", async () => {
    h = makeExecutor({
      deleteCategory: vi.fn(async () => {
        throw new NotFoundError('Category "Viajes" not found');
      }),
    });

    const result = await h.executor.execute(OWNER, envelope("delete_category", "Viajes"));

    expect(result.ok).toBe(false);
    expect(result.error).toBe("not_found");
    expect(result.message).toContain("not found");
  });

  it("carries the otro-guard error in the result", async () => {
    h = makeExecutor({
      deleteCategory: vi.fn(async () => {
        throw new ValidationFailedError('Cannot delete the "otro" fallback category');
      }),
    });

    const result = await h.executor.execute(OWNER, envelope("delete_category", "otro"));

    expect(result.ok).toBe(false);
    expect(result.error).toBe("otro_forbidden");
    expect(result.message).toContain("otro");
  });

  it("reports a generic failure when the name is missing, without calling the service", async () => {
    const result = await h.executor.execute(OWNER, envelope("delete_category", null));

    expect(h.deleteCategory).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("unknown");
  });
});

describe("CategoryExecutor.rename", () => {
  let h: ReturnType<typeof makeExecutor>;

  beforeEach(() => {
    h = makeExecutor();
  });

  it("renames the category and reports both names", async () => {
    const result = await h.executor.execute(OWNER, envelope("rename_category", "Super", "Supermercado"));

    expect(h.renameCategory).toHaveBeenCalledWith(OWNER, "Super", "Supermercado");
    expect(result).toMatchObject({ intent: "rename_category", ok: true, action: "renamed", category: "Super", new_name: "Supermercado" });
  });

  it("carries the not-found error when rename returns null", async () => {
    h = makeExecutor({
      renameCategory: vi.fn(async () => null),
    });

    const result = await h.executor.execute(OWNER, envelope("rename_category", "Fantasma", "Fantasmas"));

    expect(result.ok).toBe(false);
    expect(result.error).toBe("not_found");
  });

  it("carries the duplicate error in the result instead of throwing", async () => {
    h = makeExecutor({
      renameCategory: vi.fn(async () => {
        throw new ValidationFailedError('Category "Supermercado" already exists');
      }),
    });

    const result = await h.executor.execute(OWNER, envelope("rename_category", "Super", "Supermercado"));

    expect(result.ok).toBe(false);
    expect(result.error).toBe("duplicate");
    expect(result.message).toContain("already exists");
  });

  it("reports a generic failure when either name is missing, without calling the service", async () => {
    const result = await h.executor.execute(OWNER, envelope("rename_category", "Super", null));

    expect(h.renameCategory).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("unknown");
  });
});

describe("CategoryExecutor.execute dispatch", () => {
  it("throws for an intent it does not run", async () => {
    const { executor } = makeExecutor();

    await expect(executor.execute(OWNER, envelope("help", null))).rejects.toThrow("CategoryExecutor");
  });
});