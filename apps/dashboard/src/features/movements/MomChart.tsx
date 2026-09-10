import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from "recharts";

import type { MovementSummary } from "@rita/contracts";

import { momPercent } from "./calculations";

type Months = MovementSummary["mom"]["months"];

export function MomChart({ months }: { months: Months }) {
  const data = months.map((month, index) => {
    const previous = index > 0 ? months[index - 1]!.balance : undefined;
    const pct = previous === undefined ? null : momPercent(previous, month.balance);
    return { month: month.month, balance: month.balance, pct };
  });

  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-card sm:p-6">
      <h2 className="text-base font-semibold text-ink">
        Comparación mes a mes
      </h2>
      <p className="mt-0.5 text-sm text-ink-soft">
        Variación del balance entre meses consecutivos
      </p>
      <ul aria-label="Variación mes a mes" className="mt-4 space-y-1">
        {data.slice(1).map((point) => (
          <li key={point.month} className="text-sm text-ink-soft">
            {point.month}:{" "}
            <span className="font-semibold text-ink tabular-nums">
              {point.pct !== null && point.pct > 0 ? "+" : ""}
              {point.pct?.toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
      <ResponsiveContainer
        width="100%"
        height={240}
        initialDimension={{ width: 600, height: 240 }}
        role="img"
        aria-label="Gráfico de balance mensual"
        className="mt-4"
      >
        <BarChart data={data} barCategoryGap="18%">
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
            width={52}
          />
          <Bar
            dataKey="balance"
            name="Balance"
            fill="var(--color-accent)"
            radius={[4, 4, 0, 0]}
            maxBarSize={40}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
