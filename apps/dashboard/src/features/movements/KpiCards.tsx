import { useEffect, useState } from "react";
import type { MovementSummary } from "@rita/contracts";

import { formatARS } from "../../infra/currency";

type Kpis = MovementSummary["kpis"];

type Tone = "income" | "expense" | "balance" | "default";
type AnimatedValueProps = {
  value: number;
  format: (value: number) => string;
};

const CARD_CLASS =
  "group relative overflow-hidden rounded-card border p-4 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-float sm:p-5";

const TONE_CLASS: Record<Tone, string> = {
  income: "border-border bg-surface hover:border-border-strong",
  expense: "border-border bg-surface hover:border-border-strong",
  balance: "border-accent/30 bg-accent/10 hover:border-accent/50",
  default: "border-border bg-surface hover:border-border-strong",
};

const VALUE_CLASS: Record<Tone, string> = {
  income: "text-income",
  expense: "text-expense",
  balance: "text-ink",
  default: "text-ink",
};

function AnimatedValue({ value, format }: AnimatedValueProps) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    let frameId = 0;
    const startedAt = performance.now();
    const duration = 900;
    const reduceMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (reduceMotion) {
      setDisplayValue(value);
      return;
    }

    function animate() {
      const progress = Math.min((performance.now() - startedAt) / duration, 1);
      const easedProgress = 1 - (1 - progress) ** 3;
      setDisplayValue(value * easedProgress);
      if (progress < 1) {
        frameId = requestAnimationFrame(animate);
      }
    }

    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [value]);

  return <>{format(displayValue)}</>;
}

export function KpiCards({ kpis }: { kpis: Kpis }) {
  const cards: Array<{
    label: string;
    value: number;
    format: (value: number) => string;
    tone: Tone;
  }> = [
    { label: "Ingresos", value: kpis.income, format: formatARS, tone: "income" },
    { label: "Gastos", value: kpis.expenses, format: formatARS, tone: "expense" },
    { label: "Disponible", value: kpis.balance, format: formatARS, tone: "balance" },
    { label: "Ahorro", value: kpis.savings, format: formatARS, tone: "default" },
    {
      label: "Movimientos del mes",
      value: kpis.countThisMonth,
      format: (value) => String(Math.round(value)),
      tone: "default",
    },
  ];

  return (
    <ul aria-label="Indicadores" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.slice(0, 4).map((card) => (
        <li key={card.label} className={`${CARD_CLASS} ${TONE_CLASS[card.tone]}`}>
          <span
            aria-hidden="true"
            className={`mb-5 block h-1 w-10 rounded-full ${
              card.tone === "income"
                ? "bg-income"
                : card.tone === "expense"
                  ? "bg-expense"
                  : card.tone === "balance"
                    ? "bg-accent"
                    : "bg-border-strong"
            }`}
          />
          <h3 className="text-xs font-semibold tracking-wide text-ink-faint uppercase">
            {card.label}
          </h3>
          <p
            className={`mt-2 font-mono text-2xl font-bold tracking-tight tabular-nums sm:text-3xl ${VALUE_CLASS[card.tone]}`}
          >
            <AnimatedValue value={card.value} format={card.format} />
          </p>
        </li>
      ))}
      <li className={`${CARD_CLASS} col-span-full flex items-center justify-between bg-ink text-on-accent sm:col-span-2 xl:col-span-4`}>
        <div>
          <h3 className="text-xs font-semibold tracking-wide text-on-accent/70 uppercase">
            {cards[4]!.label}
          </h3>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums">
            <AnimatedValue
              value={cards[4]!.value}
              format={cards[4]!.format}
            />
          </p>
        </div>
        <span aria-hidden="true" className="text-3xl opacity-60">✦</span>
      </li>
    </ul>
  );
}