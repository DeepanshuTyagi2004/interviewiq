import { OTHER_PATTERN, type Share } from "./shares";

const fill = (s: Share) => ({ backgroundColor: s.color, ...(s.other ? { backgroundImage: OTHER_PATTERN } : {}) });

export interface ShareBarProps {
  shares: Share[];
  /** What the bar shows, e.g. "Languages by share of code". Prefixes the accessible summary. */
  label: string;
  /** The legend value for one share, e.g. "48%" or "268". */
  formatValue: (share: Share, total: number) => string;
}

/**
 * Part-to-whole as one thin stacked bar (2px surface gaps between segments, 4px rounded ends)
 * over a legend that names every segment and carries its value, so identity never rests on
 * colour alone. Each segment has a native hover tooltip; the legend doubles as the table view.
 */
export function ShareBar({ shares, label, formatValue }: ShareBarProps) {
  const total = shares.reduce((sum, s) => sum + s.value, 0);
  const summary = shares.map((s) => `${s.name} ${formatValue(s, total)}`).join(", ");

  return (
    <figure className="m-0 flex flex-col gap-3.5">
      <div role="img" aria-label={`${label}: ${summary}`} className="flex h-2.5 w-full gap-[2px]">
        {shares.map((s) => (
          <span
            key={s.name}
            title={`${s.name} · ${formatValue(s, total)}`}
            className="h-full min-w-[3px] first:rounded-l-[6px] last:rounded-r-[6px]"
            style={{ flexGrow: s.value, flexBasis: 0, ...fill(s) }}
          />
        ))}
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-2 p-0 text-[13px]">
        {shares.map((s) => (
          <li key={s.name} className="flex min-w-0 items-center gap-2">
            <span aria-hidden className="h-2 w-2 flex-none rounded-[2px]" style={fill(s)} />
            <span className="min-w-0 truncate">{s.name}</span>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">{formatValue(s, total)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
