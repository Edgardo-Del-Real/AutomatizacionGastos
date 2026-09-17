import { AppError, NotFoundError, ValidationFailedError } from "../../infra/errors";
import type { CategoryService } from "../categories/categories.service";
import type {
  BotIntent,
  BotAction,
  CategoryCommandErrorCode,
  ConversationEnvelope,
  ExecutionResult,
} from "./bot-brain";

/**
 * Deterministic category command executors: run a CRUD intent against the REAL
 * CategoryService and shape the executed result for the conversational reply.
 * Domain errors (duplicate, not found, the "otro" guard) are carried in the
 * result instead of thrown, so the LLM reply is grounded in the actual outcome
 * and the fixed templates render the same shape via
 * `categoryCommandReplyTemplate`.
 */
export class CategoryExecutor {
  constructor(private readonly categoryService: CategoryService) {}

  async execute(ownerId: string, envelope: ConversationEnvelope): Promise<ExecutionResult> {
    switch (envelope.intent) {
      case "create_category":
        return this.create(ownerId, envelope.category);
      case "delete_category":
        return this.delete(ownerId, envelope.category);
      case "rename_category":
        return this.rename(ownerId, envelope.category, envelope.new_name ?? null);
      default:
        throw new Error(`CategoryExecutor cannot run intent "${envelope.intent}"`);
    }
  }

  private async create(ownerId: string, name: string | null): Promise<ExecutionResult> {
    const category = name?.trim() ?? "";
    if (category.length === 0) {
      return this.result("create_category", false, "created", {
        category,
        error: "unknown",
        message: "no se indicó el nombre de la categoría",
      });
    }
    try {
      const created = await this.categoryService.createCategory(ownerId, category);
      return this.result("create_category", true, "created", { category: created.name });
    } catch (error) {
      if (error instanceof ValidationFailedError) {
        return this.result("create_category", false, "created", {
          category,
          error: "duplicate",
          message: error.message,
        });
      }
      return this.result("create_category", false, "created", {
        category,
        error: "unknown",
        message: "no se pudo crear la categoría",
      });
    }
  }

  private async delete(ownerId: string, name: string | null): Promise<ExecutionResult> {
    const category = name?.trim() ?? "";
    if (category.length === 0) {
      return this.result("delete_category", false, "deleted", {
        category,
        error: "unknown",
        message: "no se indicó el nombre de la categoría",
      });
    }
    try {
      const deleted = await this.categoryService.deleteCategory(ownerId, category);
      return this.result("delete_category", true, "deleted", { category: deleted.name });
    } catch (error) {
      if (error instanceof NotFoundError) {
        return this.result("delete_category", false, "deleted", {
          category,
          error: "not_found",
          message: error.message,
        });
      }
      if (error instanceof ValidationFailedError) {
        return this.result("delete_category", false, "deleted", {
          category,
          error: "otro_forbidden",
          message: error.message,
        });
      }
      return this.result("delete_category", false, "deleted", {
        category,
        error: "unknown",
        message: "no se pudo borrar la categoría",
      });
    }
  }

  private async rename(ownerId: string, fromName: string | null, toName: string | null): Promise<ExecutionResult> {
    const from = fromName?.trim() ?? "";
    const to = toName?.trim() ?? "";
    if (from.length === 0 || to.length === 0) {
      return this.result("rename_category", false, "renamed", {
        category: from,
        new_name: to,
        error: "unknown",
        message: "faltan los nombres de la categoría",
      });
    }
    try {
      const renamed = await this.categoryService.renameCategory(ownerId, from, to);
      if (renamed === null) {
        return this.result("rename_category", false, "renamed", {
          category: from,
          new_name: to,
          error: "not_found",
          message: `Category "${from}" not found`,
        });
      }
      return this.result("rename_category", true, "renamed", { category: from, new_name: renamed.name });
    } catch (error) {
      if (error instanceof ValidationFailedError) {
        return this.result("rename_category", false, "renamed", {
          category: from,
          new_name: to,
          error: "duplicate",
          message: error.message,
        });
      }
      if (error instanceof AppError) {
        return this.result("rename_category", false, "renamed", {
          category: from,
          new_name: to,
          error: "unknown",
          message: error.message,
        });
      }
      return this.result("rename_category", false, "renamed", {
        category: from,
        new_name: to,
        error: "unknown",
        message: "no se pudo renombrar la categoría",
      });
    }
  }

  private result(
    intent: BotIntent,
    ok: boolean,
    action: BotAction,
    fields: {
      category?: string;
      new_name?: string;
      message?: string;
      error?: CategoryCommandErrorCode;
    },
  ): ExecutionResult {
    return {
      intent,
      ok,
      action,
      amount: null,
      category: fields.category ?? null,
      note: null,
      new_name: fields.new_name ?? null,
      message: fields.message ?? null,
      error: fields.error ?? null,
    };
  }
}