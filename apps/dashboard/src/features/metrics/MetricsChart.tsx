import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from "recharts";

import type { ExpenseMonth } from "@rita/contracts";

import { sortMonthsAscending } from "./MetricsCards";

export function MetricsChart({ months }: { months: ExpenseMonth[] }) {
  const sorted = sortMonthsAscending(months);
  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-card sm:p-6">
      <h2 className="text-base font-semibold text-ink">Monthly trends</h2>
      <p className="mt-0.5 text-sm text-ink-soft">
        Expenses per month for the last 6 months
      </p>
      <ResponsiveContainer
        width="100%"
        height={300}
        initialDimension={{ width: 600, height: 300 }}
        role="img"
        aria-label="Monthly expense chart"
        className="mt-4"
      >
        <BarChart data={sorted} barCategoryGap="18%">
          <XAxis
            dataKey="month"
            interval={0}
            axisLine={{ stroke: "var(--color-border)" }}
            tickLine={false}
            tick={{ fill: "var(--color-ink-faint)", fontSize: 12 }}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--color-ink-faint)", fontSize: 12 }}
            width={44}
          />
          <Bar
            dataKey="count"
            name="Count"
            fill="var(--color-accent-soft)"
            radius={[4, 4, 0, 0]}
            maxBarSize={28}
            isAnimationActive={false}
          />
          <Bar
            dataKey="totalAmount"
            name="Total"
            fill="var(--color-accent)"
            radius={[4, 4, 0, 0]}
            maxBarSize={28}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}