/**
 * monthly-dashboard: the current Buenos Aires month as `YYYY-MM`.
 *
 * `Intl` with an explicit timeZone does the conversion, so the dashboard never
 * does offset arithmetic and can never disagree with the API about which month
 * it is (the bug that showed October's numbers on November 1st).
 */
const MONTH_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Argentina/Buenos_Aires",
  year: "numeric",
  month: "2-digit",
});

const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function currentBaMonth(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM.
  return MONTH_FORMATTER.format(now);
}

export function isMonthKey(value: unknown): value is string {
  return typeof value === "string" && MONTH_KEY_PATTERN.test(value);
}

/** Spanish label for a month key: "2026-10" → "octubre 2026". */
export function monthLabel(month: string): string {
  const [yearPart, monthPart] = month.split("-");
  const year = Number(yearPart);
  const monthIndex = Number(monthPart) - 1;
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    return month;
  }
  // Local date construction: the label must not shift a month across time zones.
  return new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" }).format(
    new Date(year, monthIndex, 1),
  );
}

/** Moves a month key by whole months: ("2026-01", -1) → "2025-12". */
export function shiftMonth(month: string, delta: number): string {
  const [yearPart, monthPart] = month.split("-");
  const year = Number(yearPart);
  const monthIndex = Number(monthPart) - 1;
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex)) {
    return month;
  }
  const shifted = new Date(Date.UTC(year, monthIndex + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}
