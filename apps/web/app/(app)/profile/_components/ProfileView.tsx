"use client";

import { useProfile } from "@/features/profile";
import { useCandidateProfile } from "@/features/onboarding";
import { CandidateDetailsSection } from "@/features/onboarding/components/CandidateDetailsSection";
import { ConnectedSourcesCard } from "./ConnectedSourcesCard";
import { IdentityCard } from "./IdentityCard";
import { LogoutButton } from "./LogoutButton";
import { ProfileSkeleton } from "./ProfileSkeleton";
import { ResumeFileRow } from "./ResumeFileRow";
import { GithubActivity, LeetCodeActivity } from "./SourceActivity";
import { SummaryCard } from "./SummaryCard";
import { educationLine } from "./identity";

const SCAFFOLD = "mx-auto flex w-full max-w-[1600px] flex-col px-4 pb-14 pt-6 sm:px-8 sm:pt-9 lg:px-10";

/**
 * The profile, laid out like the design: identity + résumé on the left (sticky on wide screens),
 * connected sources and everything the sources tell us on the right. Descriptive throughout —
 * the only score slots are the identity card's two "—" tiles.
 */
export function ProfileView() {
  const { data, isLoading, isError } = useProfile();
  const candidate = useCandidateProfile();

  if (isLoading) return <ProfileSkeleton />;

  if (isError || !data) {
    return (
      <div className={SCAFFOLD}>
        <p className="iq-eyebrow m-0">Profile</p>
        <p role="alert" className="m-0 mt-4 text-sm text-destructive">
          Could not load your profile. Please refresh the page.
        </p>
      </div>
    );
  }

  const details = candidate.data;
  const name = data.user.name ?? details?.fullName ?? null;
  const headline = data.user.headline ?? details?.headline ?? null;

  return (
    <div className={SCAFFOLD}>
      <div className="min-w-0">
        <p className="iq-eyebrow m-0">Profile</p>
        <h1 className="m-0 mt-2.5 break-words text-[32px] font-normal leading-[1.1] tracking-[-0.045em] sm:text-[38px]">
          {name ?? "Your profile"}
        </h1>
        <p className="m-0 mt-2 text-[15px] leading-[1.5] text-muted-foreground">
          {headline ?? "What your interviewer knows about you, from your résumé and connected sources."}
        </p>
      </div>

      <div className="mt-7 grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-6">
          <IdentityCard name={name} subtitle={educationLine(details?.education) ?? headline} skills={data.mostUsedSkills} />
          <ResumeFileRow />
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <ConnectedSourcesCard profile={data} />
          <SummaryCard atAGlance={data.atAGlance} notable={data.notable} />
          <GithubActivity profile={data} />
          <LeetCodeActivity profile={data} />
          <CandidateDetailsSection />
          <div className="pt-2">
            <LogoutButton />
          </div>
        </div>
      </div>
    </div>
  );
}
