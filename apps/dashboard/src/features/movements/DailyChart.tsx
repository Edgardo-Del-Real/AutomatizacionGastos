import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis } from "recharts";

import type { MovementSummary } from "@rita/contracts";

import { dailyAverage } from "./calculations";
import { formatARS } from "../../infra/currency";

type Daily = MovementSummary["daily"];

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
          <Area
            type="monotone"
            dataKey="balance"
            name="Balance"
            stroke="var(--color-accent)"
            fill="var(--color-accent-soft)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
