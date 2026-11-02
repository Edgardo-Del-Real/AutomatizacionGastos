/**
 * monthly-dashboard: the ONE place that turns a month key into a Buenos Aires
 * day range. Calendar arithmetic stays server-side so the dashboard never has
 * to know how many days a month has, and so every reader agrees on the
 * boundary (the previous optional from/to pair let callers disagree).
 *
 * Same technique as the service used before: shift the instant by the Buenos
 * Aires offset and read the UTC parts, which then hold the wall clock.
 */

export const BA_OFFSET_MS = 3 * 60 * 60 * 1000;

const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export type MonthPeriod = { from: string; to: string };

function formatBaDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

/** The current calendar month in Buenos Aires, as `YYYY-MM`. */
export function currentBaMonth(now: Date = new Date()): string {
  const ba = new Date(now.getTime() - BA_OFFSET_MS);
  return `${ba.getUTCFullYear()}-${String(ba.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** `YYYY-MM` → the inclusive first/last day of that month. */
export function monthToPeriod(month: string): MonthPeriod {
  const [yearPart, monthPart] = month.split("-");
  const year = Number(yearPart);
  const monthIndex = Number(monthPart) - 1;
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return {
    from: formatBaDate(new Date(Date.UTC(year, monthIndex, 1))),
    to: formatBaDate(new Date(Date.UTC(year, monthIndex, lastDay))),
  };
}

export function isMonthKey(value: unknown): value is string {
  return typeof value === "string" && MONTH_KEY_PATTERN.test(value);
}
