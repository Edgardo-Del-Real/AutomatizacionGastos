/**
 * Fallback owner id (VITE_OWNER_ID, default "default").
 *
 * `ViewerContext` — backed by `GET /household/members` — is the source of truth
 * for the owner of every API request once the household members load. This
 * constant only covers the degraded single-user mode: the household request
 * failed, or the household has a single member (no viewer selector rendered).
 * Unset `VITE_OWNER_ID` → "default", matching the API's single-user owner.
 */
export const OWNER_ID = import.meta.env.VITE_OWNER_ID ?? "default";
