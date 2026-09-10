import {
  listMovementsSchema,
  movementSummarySchema,
} from "@rita/contracts";
import type { Movement, MovementSummary } from "@rita/contracts";
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

/** Client-side movement list filters, mapped onto `/movements` query params. */
export type MovementListFilters = {
  type?: "EXPENSE" | "INCOME";
  from?: string;
  to?: string;
  category?: string;
  q?: string;
};

async function request<T>(
  path: string,
  ownerId: string,
  schema: z.ZodType<T>,
  params: Record<string, string> = {},
): Promise<T> {
  const query = new URLSearchParams({ ownerId });
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, value);
  }

  let response: Response;
  try {
    response = await fetch(`${path}?${query.toString()}`);
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

export function fetchMovementSummary(ownerId: string): Promise<MovementSummary> {
  return request("/api/movements/summary", ownerId, movementSummarySchema);
}

export function fetchMovements(
  ownerId: string,
  filters: MovementListFilters = {},
): Promise<Movement[]> {
  const params: Record<string, string> = {};
  if (filters.type) params.type = filters.type;
  if (filters.from) params.from = filters.from;
  if (filters.to) params.to = filters.to;
  if (filters.category) params.category = filters.category;
  if (filters.q) params.q = filters.q;
  return request("/api/movements", ownerId, listMovementsSchema, params);
}
