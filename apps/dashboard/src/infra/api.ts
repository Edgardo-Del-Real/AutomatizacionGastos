import {
  accessHistorySchema,
  accessStatusSchema,
  categoryListSchema,
  changePasswordSchema,
  expenseSchema,
  householdMembersSchema,
  listMovementsSchema,
  loginSchema,
  movementSchema,
  movementSummarySchema,
  sessionSchema,
} from "@rita/contracts";
import type {
  AccessHistory,
  AccessStatusPayload,
  Expense,
  HouseholdMember,
  Movement,
  MovementSummary,
  OwnerCategory,
  Session,
  VisibilityFilter,
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
  type?: "EXPENSE" | "INCOME" | "SAVINGS";
  /** monthly-dashboard: the selected month; the API owns the day range. */
  month?: string;
  category?: string;
  q?: string;
  /** Visibility select state; `undefined` means the default `all`. */
  visibility?: VisibilityFilter;
};

/** Fields that may be updated on a movement via `PATCH /movements/:id`. */
export type MovementPatch = {
  amount?: number;
  note?: string | null;
  category?: string | null;
};

/**
 * Payload for the "Agregar previsto" form. `occurredAt` is derived client-side
 * (the load date) because the API derives the planned target month from it
 * (load month + 1, Buenos Aires); `type`/`status` are pinned to the planned
 * contract (EXPENSE + PENDING) and never travel through this input. Planned
 * expenses are INDIVIDUAL by design: no visibility field ever travels here.
 */
export type PlannedMovementInput = {
  amount: number;
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

/**
 * Household members for the viewer selector. The proxy rewrites `/api/*` to the
 * API root, so this hits `GET /household/members` (chatIds never travel).
 */
export function fetchHouseholdMembers(): Promise<HouseholdMember[]> {
  return request(
    "GET",
    "/api/household/members",
    undefined,
    {},
    householdMembersSchema,
  );
}

export function fetchMovementSummary(
  ownerId: string,
  month?: string,
  visibility: VisibilityFilter = "mine",
): Promise<MovementSummary> {
  const params: Record<string, string> = { ownerId, visibility };
  if (month !== undefined) params.month = month;
  return request(
    "GET",
    `/api/movements/summary?${new URLSearchParams(params)}`,
    undefined,
    {},
    movementSummarySchema,
  );
}

export function fetchMovements(
  ownerId: string,
  filters: MovementListFilters = {},
  visibility: VisibilityFilter = "mine",
): Promise<Movement[]> {
  const params: Record<string, string> = {};
  if (filters.type) params.type = filters.type;
  if (filters.month) params.month = filters.month;
  if (filters.category) params.category = filters.category;
  if (filters.q) params.q = filters.q;
  return request(
    "GET",
    `/api/movements?${new URLSearchParams({ ownerId, ...params, visibility })}`,
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

/**
 * D8/D11 — "Agregar previsto" reuses the existing registration path
 * `POST /expenses` with the planned contract pinned (`type: "EXPENSE"`,
 * `status: "PENDING"`). The endpoint answers with the legacy Expense shape, so
 * the response validates against `expenseSchema`, not `movementSchema`.
 */
export function createPlannedMovement(
  ownerId: string,
  input: PlannedMovementInput,
): Promise<Expense> {
  return request(
    "POST",
    "/api/expenses",
    {
      amount: input.amount,
      category: input.category ?? null,
      note: input.note?.trim() ? input.note : null,
      // The planned row is anchored to the load date; the API derives the
      // target month as load month + 1 (BA).
      occurredAt: new Date().toISOString(),
      type: "EXPENSE",
      status: "PENDING",
    },
    { "x-owner-id": ownerId },
    expenseSchema,
  );
}

/** D5 — the mark-paid transition; 409/404 surface as `ApiError("http")`. */
export function markMovementPaid(
  id: string,
  ownerId: string,
): Promise<Movement> {
  return request(
    "POST",
    `/api/movements/${id}/paid`,
    undefined,
    { "x-owner-id": ownerId },
    movementSchema,
  );
}
// --------------------------------------------------------------- online-access

/**
 * The session is an httpOnly cookie, so the client never sees a token: it just
 * asks who it is. `null` means "no session" and is not an error.
 */
export async function fetchSession(): Promise<Session | null> {
  const response = await fetch("/api/auth/session", { credentials: "include" });
  if (response.status === 401) return null;
  if (!response.ok) throw new ApiError("http", { status: response.status });
  const json = await response.json();
  const parsed = sessionSchema.safeParse(json);
  if (!parsed.success) throw new ApiError("validation", { issues: parsed.error.issues });
  return parsed.data;
}

/** Throws ApiError("http", { status: 401 }) on bad credentials. */
export async function login(ownerId: string, password: string): Promise<Session> {
  return request("POST", "/api/auth/login", loginSchema.parse({ ownerId, password }), {}, sessionSchema);
}

export async function logout(): Promise<void> {
  return request("POST", "/api/auth/logout", undefined, {});
}

// ------------------------------------------------------------ household-access

export type AccessStatus = AccessStatusPayload;

export async function requestAccess(): Promise<{
  requestId: string;
  targetOwnerId: string;
  expiresAt: string;
}> {
  return request("POST", "/api/access/requests", undefined, {}, z.object({
    requestId: z.string(),
    targetOwnerId: z.string(),
    expiresAt: z.string(),
  }));
}

export async function fetchAccessStatus(): Promise<AccessStatus> {
  return request("GET", "/api/access", undefined, {}, accessStatusSchema);
}

export async function revokeAccess(): Promise<void> {
  return request("DELETE", "/api/access", undefined, {});
}

export async function fetchAccessHistory(): Promise<AccessHistory> {
  return request("GET", "/api/access/history", undefined, {}, accessHistorySchema);
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  return request(
    "POST",
    "/api/auth/password",
    changePasswordSchema.parse({ currentPassword, newPassword }),
    {},
  );
}
