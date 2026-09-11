import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { MovementSummary } from "@rita/contracts";

import { dailyAverage } from "./calculations";
import { formatARS } from "../../infra/currency";

type Daily = MovementSummary["daily"];

const TOOLTIP_STYLE = {
  backgroundColor: "var(--color-surface-raised)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  color: "var(--color-ink)",
} as const;

export function DailyChart({ daily }: { daily: Daily }) {
  const average = dailyAverage(daily);

  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-card sm:p-6">
      <h2 className="text-base font-semibold text-ink">Actividad diaria</h2>
      <p className="mt-0.5 text-sm text-ink-soft">
        Últimos 30 días · Promedio diario:{" "}
        <span className="font-semibold text-ink tabular-nums">
          {formatARS(average)}
        </span>
      </p>
      <ResponsiveContainer
        width="100%"
        height={240}
        initialDimension={{ width: 600, height: 240 }}
        role="img"
        aria-label="Gráfico de actividad diaria"
        className="mt-4"
      >
        <AreaChart data={daily}>
          <defs>
            <linearGradient id="dailyBalanceFill" x1="0" y1="0" x2="0" y2="1">
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
          <Tooltip
            cursor={{ stroke: "var(--color-border-strong)", strokeDasharray: "4 4" }}
            contentStyle={TOOLTIP_STYLE}
            formatter={(value) => [formatARS(Number(value)), "Balance"]}
          />
          <Area
            type="monotone"
            dataKey="balance"
            name="Balance"
            stroke="var(--color-accent)"
            strokeWidth={2}
            fill="url(#dailyBalanceFill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}