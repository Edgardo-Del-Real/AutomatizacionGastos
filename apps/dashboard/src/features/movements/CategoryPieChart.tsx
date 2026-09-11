import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import type { MovementSummary } from "@rita/contracts";

import { formatARS } from "../../infra/currency";
import { categoryPieSlices } from "./calculations";

type Kpis = MovementSummary["kpis"];
type Categories = MovementSummary["categories"];

const TOOLTIP_STYLE = {
  backgroundColor: "var(--color-surface-raised)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  color: "var(--color-ink)",
} as const;

type PieTooltipProps = {
  active?: boolean;
  payload?: ReadonlyArray<{
    name?: string;
    value?: number | string;
    payload?: { percent?: number };
  }>;
};

function PieTooltip({ active, payload }: PieTooltipProps) {
  const entry = payload?.[0];
  if (!active || !entry) return null;

  return (
    <div className="rounded-lg px-3 py-2 text-sm shadow-float" style={TOOLTIP_STYLE}>
      <p className="font-semibold text-ink">{entry.name}</p>
      <p className="tabular-nums text-ink">{formatARS(Number(entry.value))}</p>
      <p className="tabular-nums text-ink-soft">
        {entry.payload?.percent?.toFixed(1)}%
      </p>
    </div>
  );
}

export function CategoryPieChart({
  kpis,
  categories,
}: {
  kpis: Kpis;
  categories: Categories;
}) {
  const slices = categoryPieSlices(kpis, categories);

  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-card sm:p-6">
      <h2 className="text-base font-semibold text-ink">
        ¿Dónde está tu dinero?
      </h2>
      <p className="mt-0.5 text-sm text-ink-soft">
        Gastos por categoría y dinero disponible
      </p>
      {slices.length === 0 ? (
        <p className="mt-4 rounded-card border border-dashed border-border bg-surface p-10 text-center text-sm text-ink-soft">
          Sin datos.
        </p>
      ) : (
        <>
          <div className="relative mt-4">
            <ResponsiveContainer
              width="100%"
              height={260}
              initialDimension={{ width: 600, height: 260 }}
              role="img"
              aria-label="Gráfico de torta por categorías"
            >
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="62%"
                  outerRadius="88%"
                  paddingAngle={2}
                  stroke="var(--color-surface)"
                  isAnimationActive={false}
                >
                  {slices.map((slice) => (
                    <Cell key={slice.id} fill={slice.color} />
                  ))}
                </Pie>
                <Tooltip
                  cursor={{ fill: "var(--color-accent-soft)" }}
                  content={<PieTooltip />}
                />
              </PieChart>
            </ResponsiveContainer>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
            >
              <div className="text-center">
                <p className="text-xs font-medium tracking-wide text-ink-faint uppercase">
                  Total
                </p>
                <p className="mt-0.5 font-mono text-lg font-bold tabular-nums text-ink">
                  {formatARS(kpis.income)}
                </p>
              </div>
            </div>
          </div>
          <ul
            aria-label="Leyenda de categorías"
            className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2"
          >
            {slices.map((slice) => (
              <li
                key={slice.id}
                data-testid="pie-legend-item"
                data-value={slice.value}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: slice.color }}
                  />
                  <span className="truncate text-ink">{slice.name}</span>
                </span>
                <span className="shrink-0 tabular-nums text-ink-soft">
                  {formatARS(slice.value)}
                  <span className="text-ink-faint">
                    {" "}
                    · {slice.percent.toFixed(1)}%
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}