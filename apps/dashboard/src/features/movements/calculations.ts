/** Daily series point used by the last-30-days chart. */
export type DailyPoint = { day: string; income: number; expenses: number; balance: number };

/**
 * Percentage change from a previous month's balance to the current month's.
 * Growing from a zero previous month counts as +100%; both zero as 0%.
 */
export function momPercent(previous: number, current: number): number {
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** Mean balance across the daily series; 0 for an empty series. */
export function dailyAverage(daily: DailyPoint[]): number {
  if (daily.length === 0) return 0;
  return daily.reduce((sum, point) => sum + point.balance, 0) / daily.length;
}
