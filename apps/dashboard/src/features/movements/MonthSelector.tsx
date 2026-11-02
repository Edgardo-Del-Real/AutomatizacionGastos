import { monthLabel, shiftMonth } from "../../infra/month";

type MonthSelectorProps = {
  /** Selected month key (`YYYY-MM`). */
  month: string;
  onChange: (month: string) => void;
};

const BUTTON_CLASS =
  "inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface text-ink-soft transition-colors hover:bg-surface-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft";
const INPUT_CLASS =
  "h-8 rounded-control border border-border bg-surface px-2 text-sm font-semibold text-ink shadow-sm transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft";

/**
 * monthly-dashboard: the single period control. It drives every data-bearing
 * section through the App, so the KPIs, the charts and the table can never
 * disagree about which month they are showing.
 *
 * The native `input[type=month]` is the direct picker; the arrows are the
 * one-tap path. The accessible name carries the Spanish label so a screen
 * reader announces "octubre 2026", not a raw key.
 */
export function MonthSelector({ month, onChange }: MonthSelectorProps) {
  const label = monthLabel(month);

  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Mes del dashboard">
      <button
        type="button"
        aria-label="Mes anterior"
        onClick={() => onChange(shiftMonth(month, -1))}
        className={BUTTON_CLASS}
      >
        <span aria-hidden="true">‹</span>
      </button>
      <input
        type="month"
        aria-label={`Mes seleccionado: ${label}`}
        value={month}
        onChange={(event) => onChange(event.target.value)}
        className={INPUT_CLASS}
      />
      <button
        type="button"
        aria-label="Mes siguiente"
        onClick={() => onChange(shiftMonth(month, 1))}
        className={BUTTON_CLASS}
      >
        <span aria-hidden="true">›</span>
      </button>
    </div>
  );
}
