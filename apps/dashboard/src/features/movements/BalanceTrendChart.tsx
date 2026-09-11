import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { MovementSummary } from "@rita/contracts";

import { formatARS } from "../../infra/currency";
import { accumulateBalances } from "./calculations";

type Daily = MovementSummary["daily"];

const TOOLTIP_STYLE = {
  backgroundColor: "var(--color-surface-raised)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  color: "var(--color-ink)",
} as const;

export function BalanceTrendChart({ daily }: { daily: Daily }) {
  const data = accumulateBalances(daily);
  const dipsNegative = data.some((point) => point.accumulated < 0);

  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-card sm:p-6">
      <h2 className="text-base font-semibold text-ink">
        Evolución del saldo acumulado
      </h2>
      <p className="mt-0.5 text-sm text-ink-soft">
        Acumulado de los últimos 30 días
      </p>
      {data.length === 0 ? (
        <p className="mt-4 rounded-card border border-dashed border-border bg-surface p-10 text-center text-sm text-ink-soft">
          Sin datos.
        </p>
      ) : (
        <ResponsiveContainer
          width="100%"
          height={240}
          initialDimension={{ width: 600, height: 240 }}
          role="img"
          aria-label="Gráfico del saldo acumulado"
          className="mt-4"
        >
          <AreaChart data={data}>
            <defs>
              <linearGradient id="balanceTrendFill" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="rgba(45, 212, 191, 0.25)"
                  stopOpacity={1}
                />
                <stop
                  offset="95%"
                  stopColor="rgba(45, 212, 191, 0)"
                  stopOpacity={0}
                />
              </linearGradient>
            </defs>
            <CartesianGrid
              stroke="var(--color-border)"
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis
              dataKey="day"
              interval="preserveStartEnd"
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
            {dipsNegative && (
              <ReferenceLine
                y={0}
                stroke="var(--color-border-strong)"
                strokeDasharray="4 4"
              />
            )}
            <Tooltip
              cursor={{ stroke: "var(--color-border-strong)", strokeDasharray: "4 4" }}
              contentStyle={TOOLTIP_STYLE}
              labelFormatter={(label) => String(label)}
              formatter={(value) => [formatARS(Number(value)), "Acumulado"]}
            />
            <Area
              type="monotone"
              dataKey="accumulated"
              name="Acumulado"
              stroke="var(--color-accent)"
              strokeWidth={2}
              fill="url(#balanceTrendFill)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}