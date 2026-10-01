import { ListCard, ListEmpty } from "./ListCard";

/** Leaderboard preview. Boards need interview scores, which don't exist yet — say so plainly. */
export function LeaderboardCard() {
  return (
    <ListCard title="Leaderboard">
      <ListEmpty
        title="Leaderboards aren't live yet"
        hint="Once interview scores ship, you'll see where you stand in your college and globally."
      />
    </ListCard>
  );
}
