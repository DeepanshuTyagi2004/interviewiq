/**
 * The design's score and rank tiles. The scoring contract doesn't exist yet (formulas are an open
 * product decision), so every value is an honest "—" with a note on what it will be based on.
 */
const TILES = [
  { label: "Profile score", note: "From your résumé and sources · coming soon" },
  { label: "Interview score", note: "From your interviews · coming soon" },
  { label: "College rank", note: "College leaderboards · coming soon" },
  { label: "Global rank", note: "Global leaderboard · coming soon" },
];

export function ScoreTiles() {
  return (
    <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 lg:grid-cols-4">
      {TILES.map((tile) => (
        <li key={tile.label} className="flex flex-col gap-1.5 rounded-[10px] border border-line-2 p-4 sm:p-5">
          <span className="text-[12.5px] text-faint">{tile.label}</span>
          <span className="text-[30px] leading-none tracking-[-0.045em] text-faint-2 sm:text-[34px]">
            <span aria-hidden>—</span>
            <span className="sr-only">Not available yet</span>
          </span>
          <span className="text-xs leading-[1.4] text-muted-foreground">{tile.note}</span>
        </li>
      ))}
    </ul>
  );
}
