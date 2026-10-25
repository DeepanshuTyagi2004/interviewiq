"use client";

import { useProfile } from "@/features/profile";
import { useCandidateProfile } from "@/features/onboarding";
import { cn } from "@/lib/utils/cn";
import { ConnectedSourcesCard } from "./ConnectedSourcesCard";
import { DetailsProvider } from "./details/DetailsProvider";
import {
  AchievementsSection,
  ContactSection,
  EducationSection,
  ExperienceSection,
  ProjectsSection,
  SkillsSection,
} from "./details/sections";
import { IdentityCard } from "./IdentityCard";
import { ProfileSkeleton } from "./ProfileSkeleton";
import { ResumeFileRow } from "./ResumeFileRow";
import { SourceSignalCards } from "./SourceSignalCards";
import { Chip, Orb } from "@/components/ds";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { levelLabel } from "@/lib/constants/engineering-levels";
import { ProfileScoreCard } from "@/features/profile-scoring";

/** A profile column. Below `lg` it dissolves (`contents`) so its cards join the single column in their `order`. */
function Column({ children }: { children: React.ReactNode }) {
  return <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-5">{children}</div>;
}

/** One card's slot. `order` is its place in the phone/tablet column; on desktop the column decides. */
function Cell({ order, children }: { order: string; children: React.ReactNode }) {
  return <div className={cn("min-w-0 lg:order-none", order)}>{children}</div>;
}

/**
 * The profile. A header with the orb, name, headline, level and the beta profile score, then two
 * columns of hairline cards: short facts on the left (identity, resume file, contact, education,
 * skills, achievements, sources), the long parts on the right (experience, projects, activity).
 * Phones and tablets get one column in reading order. Each resume section edits on its own.
 * Descriptive source sections remain separate from the provisional beta assessment card.
 */
export function ProfileView() {
  const { data, isLoading, isError } = useProfile();
  const candidate = useCandidateProfile();
  const { user } = useCurrentUser();

  if (isLoading) return <ProfileSkeleton />;

  if (isError || !data) {
    return (
      <div>
        <p className="m-0 text-[13px] text-ink-3">Profile</p>
        <p role="alert" className="m-0 mt-4 text-sm text-destructive">
          Could not load your profile. Please refresh the page.
        </p>
      </div>
    );
  }

  const details = candidate.data;
  const name = data.user.name ?? details?.fullName ?? null;
  const headline = data.user.headline ?? details?.headline ?? null;
  // Without a resume, uploading one is the most useful thing on this page: put it near the top.
  const noResume = candidate.isSuccess && !details?.resumeFilename;

  return (
    <div>
      <header className="flex flex-wrap items-center justify-between gap-x-8 gap-y-6">
        <div className="flex min-w-0 items-center gap-5">
          <Orb seed={user?.id ?? name ?? "profile"} size={72} className="flex-none" />
          <div className="min-w-0">
            <h1 className="m-0 break-words font-display text-[32px] font-light leading-[1.1] tracking-[-0.035em] sm:text-[40px]">
              {name ?? "Your profile"}
            </h1>
            <p className="m-0 mt-2 max-w-xl text-[14px] leading-[1.55] text-ink-2">
              {headline ?? "What your interviewer knows about you, from your resume and connected sources."}
            </p>
            {candidate.isSuccess ? (
              <div className="mt-3">
                <Chip tone="outline">{details?.level ? levelLabel(details.level) : "Level not set"}</Chip>
              </div>
            ) : (
              <div aria-hidden className="mt-3 h-[26px]" />
            )}
          </div>
        </div>
      </header>

      <DetailsProvider>
        <div className="mt-10 flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:items-start">
          <Column>
            <Cell order="order-1">
              <IdentityCard skills={data.mostUsedSkills} />
            </Cell>
            {noResume ? (
              <Cell order="order-1">
                <ResumeFileRow />
              </Cell>
            ) : null}
            <Cell order="order-2">
              <div id="profile-level"><ContactSection /></div>
            </Cell>
            <Cell order="order-5">
              <EducationSection />
            </Cell>
            <Cell order="order-6">
              <SkillsSection />
            </Cell>
            <Cell order="order-7">
              <AchievementsSection />
            </Cell>
            <Cell order="order-8">
              <ProfileScoreCard />
            </Cell>
            {noResume ? null : (
              <Cell order="order-11">
                <ResumeFileRow />
              </Cell>
            )}
            <Cell order="order-10">
              <ConnectedSourcesCard profile={data} />
            </Cell>
          </Column>

          <Column>
            <Cell order="order-3">
              <ExperienceSection />
            </Cell>
            <Cell order="order-4">
              <ProjectsSection />
            </Cell>
            <Cell order="order-9">
              <SourceSignalCards profile={data} />
            </Cell>
          </Column>
        </div>
      </DetailsProvider>
    </div>
  );
}
