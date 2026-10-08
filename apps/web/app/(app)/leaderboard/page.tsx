import { PAGE_SCAFFOLD } from "@/components/layout/page";
import { ProfileLeaderboard } from "./_components/ProfileLeaderboard";

export default function LeaderboardPage() {
  return <div className={PAGE_SCAFFOLD}>
    <p className="iq-eyebrow m-0">Beta</p>
    <h1 className="m-0 mt-1.5 text-[26px] font-normal leading-[1.1] tracking-[-0.04em] sm:text-[30px]">Profile leaderboard</h1>
    <ProfileLeaderboard />
  </div>;
}
