import { useCallback, useEffect, useState } from "react";

import { currentBaMonth, isMonthKey } from "../../infra/month";

/** Query-string key for the selected month. Kept short: it is user-visible. */
const MONTH_PARAM = "mes";

function readMonth(search: string): string {
  const value = new URLSearchParams(search).get(MONTH_PARAM);
  // An absent or malformed value falls back to the current Buenos Aires month,
  // so a shared link never leaves the dashboard on an impossible period.
  return isMonthKey(value) ? value : currentBaMonth();
}

export type SelectedMonth = {
  month: string;
  setMonth: (next: string) => void;
};

/**
 * monthly-dashboard: the ONE period for every data-bearing section, stored in
 * the URL (`?mes=YYYY-MM`) so it survives a reload, browser back/forward and a
 * shared link. The hook owns the URL; the components stay declarative.
 */
export function useSelectedMonth(): SelectedMonth {
  const [month, setMonthState] = useState(() => readMonth(window.location.search));

  useEffect(() => {
    const syncFromUrl = () => setMonthState(readMonth(window.location.search));
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  const setMonth = useCallback((next: string) => {
    const normalized = isMonthKey(next) ? next : currentBaMonth();
    const params = new URLSearchParams(window.location.search);
    params.set(MONTH_PARAM, normalized);
    window.history.pushState({ [MONTH_PARAM]: normalized }, "", `?${params.toString()}`);
    setMonthState(normalized);
  }, []);

  return { month, setMonth };
}
