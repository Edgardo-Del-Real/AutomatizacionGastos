import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { MovementSummary } from "@rita/contracts";

import { momPercent } from "./calculations";
import { formatARS } from "../../infra/currency";

type Months = MovementSummary["mom"]["months"];

const TOOLTIP_STYLE = {
  backgroundColor: "var(--color-surface-raised)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  color: "var(--color-ink)",
} as const;

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
      <ResponsiveContainer
        width="100%"
        height={240}
        initialDimension={{ width: 600, height: 240 }}
        role="img"
        aria-label="Gráfico de balance mensual"
        className="mt-4"
      >
        <BarChart data={data} barCategoryGap="18%">
          <CartesianGrid
            stroke="var(--color-border)"
            strokeDasharray="3 3"
            vertical={false}
          />
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
          <Tooltip
            cursor={{ fill: "var(--color-accent-soft)" }}
            contentStyle={TOOLTIP_STYLE}
            labelFormatter={(_, payload) => {
              const entry = Array.isArray(payload) ? payload[0] : undefined;
              const datum = entry?.payload as
                | { month?: string; pct?: number | null }
                | undefined;
              const pctText =
                datum?.pct == null
                  ? "—"
                  : `${datum.pct > 0 ? "+" : ""}${datum.pct.toFixed(1)}%`;
              return `${datum?.month ?? ""} · ${pctText}`;
            }}
            formatter={(value) => [formatARS(Number(value)), "Balance"]}
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