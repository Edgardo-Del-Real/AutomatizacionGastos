import { expenseSummarySchema, listExpensesSchema } from "@rita/contracts";
import type { Expense, ExpenseSummary } from "@rita/contracts";
import { z } from "zod";

export type ApiErrorKind = "network" | "http" | "validation";

/**
 * Error surfaced by the API client. `kind` discriminates the failure class:
 * - "network": the request never reached the server (fetch rejected)
 * - "http": the server answered with a non-2xx status (`status` set)
 * - "validation": the payload did not match the shared contract (`issues` set)
 */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly issues?: z.ZodIssue[];

  constructor(
    kind: ApiErrorKind,
    options: { status?: number; issues?: z.ZodIssue[] } = {},
  ) {
    super(
      kind === "validation"
        ? "Response failed validation"
        : kind === "http"
          ? `Request failed with status ${options.status}`
          : "Network request failed",
    );
    this.name = "ApiError";
    this.kind = kind;
    if (options.status !== undefined) this.status = options.status;
    if (options.issues !== undefined) this.issues = options.issues;
  }
}

async function request<T>(
  path: string,
  ownerId: string,
  schema: z.ZodType<T>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${path}?ownerId=${encodeURIComponent(ownerId)}`);
  } catch {
    throw new ApiError("network");
  }

  if (!response.ok) {
    throw new ApiError("http", { status: response.status });
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new ApiError("validation", { issues: [] });
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError("validation", { issues: parsed.error.issues });
  }
  return parsed.data;
}

export function fetchSummary(ownerId: string): Promise<ExpenseSummary> {
  return request("/api/expenses/summary", ownerId, expenseSummarySchema);
}

export function fetchExpenses(ownerId: string): Promise<Expense[]> {
  return request("/api/expenses", ownerId, listExpensesSchema);
}