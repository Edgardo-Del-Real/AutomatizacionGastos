/** Single slice rendered by the category pie chart. */
export type CategoryPieSlice = {
  id: string;
  name: string;
  value: number;
  percent: number;
  color: string;
};

/** Accrued balance series point: day plus the running total up to that day. */
export type AccumulatedPoint = { day: string; accumulated: number };

const CATEGORY_PALETTE = [
  "#2dd4bf",
  "#818cf8",
  "#f472b6",
  "#fbbf24",
  "#60a5fa",
  "#f87171",
  "#c084fc",
  "#fb923c",
  "#94a3b8",
  "#34d399",
] as const;

const DISPONIBLE_COLOR = "#34d399";

/**
 * Cumulative balance series: each point adds the day's balance to the running
 * total, which starts at 0 before the first day.
 */
export function accumulateBalances(
  daily: ReadonlyArray<{ day: string; balance: number }>,
): AccumulatedPoint[] {
  let accumulated = 0;
  return daily.map((point) => {
    accumulated += point.balance;
    return { day: point.day, accumulated };
  });
}

/**
 * Donut slices for the category breakdown: one slice per category with
 * spending (descending by amount) plus a "Disponible" slice when the balance
 * is positive. The total equals `kpis.income` whenever the balance is
 * positive; a non-positive balance simply drops the Disponible slice.
 * Returns an empty list when there is no income or no slice to draw.
 */
export function categoryPieSlices(
  kpis: { income: number; balance: number },
  categories: ReadonlyArray<{ name: string; expenseAmount: number }>,
): CategoryPieSlice[] {
  const spending = categories
    .filter((category) => category.expenseAmount > 0)
    .sort((a, b) => b.expenseAmount - a.expenseAmount)
    .map((category, index) => ({
      id: category.name,
      name: category.name,
      value: category.expenseAmount,
      color: CATEGORY_PALETTE[index % CATEGORY_PALETTE.length]!,
    }));

  if (kpis.balance > 0) {
    spending.push({
      id: "Disponible",
      name: "Disponible",
      value: kpis.balance,
      color: DISPONIBLE_COLOR,
    });
  }

  if (kpis.income <= 0 || spending.length === 0) return [];

  return spending.map((slice) => ({
    ...slice,
    percent: (slice.value / kpis.income) * 100,
  }));
}