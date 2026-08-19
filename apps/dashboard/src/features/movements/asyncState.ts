import type { ApiError } from "../../infra/api";

/** Discriminated async state shared by the movement data hooks. */
export type AsyncState<T> =
  | { status: "idle" | "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: ApiError };
