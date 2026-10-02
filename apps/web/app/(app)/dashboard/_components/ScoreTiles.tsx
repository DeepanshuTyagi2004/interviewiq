import { HudCard, Readout } from "@/components/hud";
import { cn } from "@/lib/utils/cn";

/**
 * The design's score and rank tiles. The scoring contract doesn't exist yet (formulas are an open
 * product decision), so every value is an honest "—" with a note on what it will be based on. No
 * status dot or "pending" label: nothing is being computed, so there is no state to show. There is
 * no profile score — sources shape the summary and the interviewer, never a number.
 */
const TILES = [
  { label: "Interview score", note: "From your interviews · coming soon" },
  { label: "College rank", note: "College leaderboards · coming soon" },
  { label: "Global rank", note: "Global leaderboard · coming soon" },
];

export function ScoreTiles() {
  return (
    <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 lg:grid-cols-3">
      {TILES.map((tile, i) => (
        // On phones the interview score spans the row, so the two ranks pair up below it.
        <li key={tile.label} className={cn("flex min-w-0", i === 0 && "col-span-2 lg:col-span-1")}>
          <HudCard notch as="div" className="flex-1" bodyClassName="p-4 sm:p-5">
            <Readout
              label={tile.label}
              value={
                <>
                  <span aria-hidden className="text-faint">—</span>
                  <span className="sr-only">Not available yet</span>
                </>
              }
              note={tile.note}
            />
          </HudCard>
        </li>
      ))}
    </ul>
  );
}
