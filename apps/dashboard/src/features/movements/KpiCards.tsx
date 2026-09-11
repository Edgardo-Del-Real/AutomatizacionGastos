import type { MovementSummary } from "@rita/contracts";

import { formatARS } from "../../infra/currency";

type Kpis = MovementSummary["kpis"];

type Tone = "income" | "expense" | "balance" | "default";

const CARD_CLASS = "rounded-card border p-4 shadow-card transition-colors sm:p-6";

const TONE_CLASS: Record<Tone, string> = {
  income: "border-border bg-surface hover:border-border-strong",
  expense: "border-border bg-surface hover:border-border-strong",
  balance: "border-accent/30 bg-accent/10 hover:border-accent/50",
  default: "border-border bg-surface hover:border-border-strong",
};

const SPAN_CLASS: Record<Tone, string> = {
  income: "",
  expense: "",
  balance: "lg:col-span-2",
  default: "",
};

const VALUE_CLASS: Record<Tone, string> = {
  income: "text-income",
  expense: "text-expense",
  balance: "text-ink",
  default: "text-ink",
};

export function KpiCards({ kpis }: { kpis: Kpis }) {
  const cards: Array<{ label: string; value: string; tone: Tone }> = [
    { label: "Ingresos", value: formatARS(kpis.income), tone: "income" },
    { label: "Gastos", value: formatARS(kpis.expenses), tone: "expense" },
    { label: "Balance", value: formatARS(kpis.balance), tone: "balance" },
    { label: "Promedio mes", value: formatARS(kpis.avgPerMonth), tone: "default" },
    {
      label: "Promedio por movimiento",
      value: formatARS(kpis.avgPerMovement),
      tone: "default",
    },
    { label: "Máximo", value: formatARS(kpis.maxAmount), tone: "default" },
    { label: "Cantidad", value: String(kpis.count), tone: "default" },
  ];

  return (
    <ul
      aria-label="Indicadores"
      className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
    >
      {cards.map((card) => (
        <li
          key={card.label}
          className={`${CARD_CLASS} ${SPAN_CLASS[card.tone]} ${TONE_CLASS[card.tone]}`}
        >
          <h3 className="text-xs font-semibold tracking-wide text-ink-faint uppercase">
            {card.label}
          </h3>
          <p
            className={`mt-2 font-mono text-2xl font-bold tabular-nums ${VALUE_CLASS[card.tone]}`}
          >
            {card.value}
          </p>
        </li>
      ))}
    </ul>
  );
}