import { useViewer } from "./ViewerContext";

const CONTROL_CLASS =
  "h-9 rounded-control border border-border bg-surface px-3 text-sm text-ink shadow-sm transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft";
const LABEL_CLASS = "text-xs font-semibold tracking-wide text-ink-faint uppercase";

/**
 * Viewer identity selector. Rendered ONLY when the household has more than one
 * member (spec: single-user households get no selector and fall back to
 * `VITE_OWNER_ID`). The label is wired to the select via `htmlFor`/`id` so the
 * control is discoverable by assistive tech.
 */
export function ViewerSelector() {
  const { viewerId, members, setViewerId, selectorVisible } = useViewer();

  if (!selectorVisible) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="viewer-select" className={LABEL_CLASS}>
        Ver como
      </label>
      <select
        id="viewer-select"
        value={viewerId}
        onChange={(event) => setViewerId(event.target.value)}
        className={CONTROL_CLASS}
      >
        {members.map((member) => (
          <option key={member.ownerId} value={member.ownerId}>
            {member.name}
          </option>
        ))}
      </select>
    </div>
  );
}