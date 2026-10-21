import { PageHeader } from "@/components/ds";
import { ProfileLeaderboard } from "./_components/ProfileLeaderboard";

export default function LeaderboardPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Beta" title="Profile leaderboard" />
      <ProfileLeaderboard />
    </div>
  );
}
