/**
 * recurring-fixed-expense — Buenos Aires schedule math.
 *
 * Argentina has no DST: the offset is a fixed -03:00, so a BA wall-clock time
 * is UTC+3. Keeping this in one pure module means the scheduler never does
 * date arithmetic inline and every rule is testable without a database.
 *
 * A monthly fixed expense is anchored to a DAY OF THE MONTH, never to "30 days
 * from the last run": counting 30 days drifts (Jan 1 → Jan 31 → Mar 2).
 */

const BA_OFFSET_HOURS = 3;
const MS_PER_HOUR = 60 * 60 * 1000;

/** The hour the bot asks, for every rule. The owner only picks the day. */
export const NOTIFY_HOUR = 12;
export const NOTIFY_MINUTE = 30;

/** Days the owner may pick when creating a template. */
export const NOTIFY_DAYS = [1, 2, 3, 4, 5, 6] as const;
export type NotifyDay = (typeof NOTIFY_DAYS)[number];

export type BaParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

/** Wall-clock parts of an instant in Buenos Aires. */
export function baParts(instant: Date): BaParts {
  const shifted = new Date(instant.getTime() - BA_OFFSET_HOURS * MS_PER_HOUR);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

/** "YYYY-MM" of an instant, in Buenos Aires. */
export function baPeriodKey(instant: Date): string {
  const { year, month } = baParts(instant);
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** The instant of a BA wall-clock date, as a real Date (UTC under the hood). */
export function baInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour + BA_OFFSET_HOURS, minute));
}

/**
 * The next time a rule must fire, strictly after `from`. Anchored to the month,
 * clamped to the last day of short months (a 31st rule fires on Feb 28).
 */
export function nextRunAfter(from: Date, notifyDay: number): Date {
  const { year, month } = baParts(from);
  for (let offset = 0; offset <= 2; offset += 1) {
    const zeroBased = month - 1 + offset;
    const targetYear = year + Math.floor(zeroBased / 12);
    const targetMonth = (zeroBased % 12) + 1;
    const daysInMonth = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
    const day = Math.min(notifyDay, daysInMonth);
    const candidate = baInstant(targetYear, targetMonth, day, NOTIFY_HOUR, NOTIFY_MINUTE);
    if (candidate.getTime() > from.getTime()) {
      return candidate;
    }
  }
  // Unreachable with notifyDay 1..6, kept so the function is total.
  return baInstant(year, month + 1, notifyDay, NOTIFY_HOUR, NOTIFY_MINUTE);
}

/** True when `day` is one the bot offers. */
export function isNotifyDay(day: number): day is NotifyDay {
  return (NOTIFY_DAYS as readonly number[]).includes(day);
}
