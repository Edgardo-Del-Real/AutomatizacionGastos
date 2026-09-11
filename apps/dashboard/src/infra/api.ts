import {
  categoryListSchema,
  listMovementsSchema,
  movementSchema,
  movementSummarySchema,
} from "@rita/contracts";
import type {
  Movement,
  MovementSummary,
  OwnerCategory,
} from "@rita/contracts";
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

/** Fields that may be updated on a movement via `PATCH /movements/:id`. */
export type MovementPatch = {
  amount?: number;
  note?: string | null;
  category?: string | null;
};

/**
 * Core request helper. GET requests with no headers go out as a plain
 * `fetch(path)`; mutations send `method`, `headers`, and a JSON `body`.
 * A `204` response short-circuits before any JSON parsing (no schema needed).
 */
async function request<T>(
  method: string,
  path: string,
  body: unknown,
  headers: Record<string, string>,
  schema: z.ZodType<T>,
): Promise<T>;
async function request(
  method: string,
  path: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<void>;
async function request<T>(
  method: string,
  path: string,
  body: unknown,
  headers: Record<string, string>,
  schema?: z.ZodType<T>,
): Promise<T | void> {
  const hasHeaders = Object.keys(headers).length > 0;
  const init: RequestInit = { method };
  if (hasHeaders) init.headers = headers;
  if (body !== undefined) {
    init.headers = {
      ...(init.headers as Record<string, string>),
      "Content-Type": "application/json",
    };
    init.body = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await (method === "GET" && !hasHeaders && body === undefined
      ? fetch(path)
      : fetch(path, init));
  } catch {
    throw new ApiError("network");
  }

  if (!response.ok) {
    throw new ApiError("http", { status: response.status });
  }

  if (response.status === 204) {
    return undefined;
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new ApiError("validation", { issues: [] });
  }

  if (!schema) {
    return undefined;
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError("validation", { issues: parsed.error.issues });
  }
  return parsed.data;
}

export function fetchMovementSummary(ownerId: string): Promise<MovementSummary> {
  return request(
    "GET",
    `/api/movements/summary?${new URLSearchParams({ ownerId })}`,
    undefined,
    {},
    movementSummarySchema,
  );
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
  return request(
    "GET",
    `/api/movements?${new URLSearchParams({ ownerId, ...params })}`,
    undefined,
    {},
    listMovementsSchema,
  );
}

export function fetchCategories(ownerId: string): Promise<OwnerCategory[]> {
  return request(
    "GET",
    `/api/movements/categories?${new URLSearchParams({ ownerId })}`,
    undefined,
    {},
    categoryListSchema,
  );
}

export function patchMovement(
  id: string,
  ownerId: string,
  patch: MovementPatch,
): Promise<Movement> {
  return request(
    "PATCH",
    `/api/movements/${id}`,
    patch,
    { "x-owner-id": ownerId },
    movementSchema,
  );
}

export function deleteMovement(id: string, ownerId: string): Promise<void> {
  return request("DELETE", `/api/movements/${id}`, undefined, {
    "x-owner-id": ownerId,
  });
}