import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ProfileResponse } from "@/features/profile";
import { ROUTES } from "@/lib/constants/shared";
import { SourceList } from "@/app/(app)/connections/_components/SourceList";
import { ProfileCard } from "./ProfileCard";

/** The resume has its own file row on the left, so this card lists the account sources. */
const SOURCES = ["GITHUB", "LEETCODE", "TUF", "CODEFORCES", "CODECHEF", "ATCODER", "LINKEDIN"] as const;

/** "Connected sources": the same live rows as the Connections page, inside one card. */
export function ConnectedSourcesCard({ profile }: { profile: ProfileResponse }) {
  return (
    <ProfileCard
      title="Connected sources"
      action={
        <Link
          href={ROUTES.connections}
          className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          Manage
          <ArrowRight aria-hidden className="h-3.5 w-3.5" />
        </Link>
      }
    >
      <SourceList profile={profile} variant="divided" sources={[...SOURCES]} />
    </ProfileCard>
  );
}
