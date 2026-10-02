import { HudCard, HudEmpty } from "@/components/hud";

/** Leaderboard preview. Boards need interview scores, which don't exist yet — say so plainly. */
export function LeaderboardCard({ className }: { className?: string }) {
  return (
    <HudCard title="Leaderboard" glow="tl" className={className}>
      <HudEmpty
        title="Leaderboards aren't live yet"
        hint="Once interview scores ship, you'll see where you stand in your college and globally."
      />
    </HudCard>
  );
}
