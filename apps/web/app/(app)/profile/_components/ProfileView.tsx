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
import { LogoutButton } from "./LogoutButton";
import { ProfileSkeleton } from "./ProfileSkeleton";
import { ResumeFileRow } from "./ResumeFileRow";
import { ScrollColumn } from "./ScrollColumn";
import { SourceSignalCards } from "./SourceSignalCards";
import { educationLine } from "./identity";
import { PAGE_SCAFFOLD } from "@/components/layout/page";
import { ProfileScoreCard, ProfileScoreReadout } from "@/features/profile-scoring";

const SCAFFOLD = PAGE_SCAFFOLD;
/** Desktop: the page fills the card and stops scrolling; the header stays put and each column scrolls. */
const FILL = "lg:min-h-0 lg:flex-1 lg:pb-0";

/** One card's slot. `order` is its place in the phone/tablet column; on desktop the column decides. */
function Cell({ order, children }: { order: string; children: React.ReactNode }) {
  return <div className={cn("min-w-0 lg:order-none", order)}>{children}</div>;
}

/**
 * The profile. Desktop: short facts on the left (identity, resume file, contact, education, skills,
 * achievements, sources), the long parts on the right (experience, projects, activity),
 * each column scrolling on its own under a fixed header. Phones and tablets get one column in
 * reading order, scrolling with the page. Each resume section edits on its own.
 * Descriptive source sections remain separate from the provisional beta assessment card.
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
    <div className={cn(SCAFFOLD, FILL)}>
      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <p className="iq-eyebrow m-0">Profile</p>
          <h1 className="m-0 mt-1.5 break-words text-[26px] font-normal leading-[1.1] tracking-[-0.04em] sm:text-[30px]">
            {name ?? "Your profile"}
          </h1>
          <p className="m-0 mt-1.5 text-[14px] leading-[1.5] text-muted-foreground">
            {headline ?? "What your interviewer knows about you, from your resume and connected sources."}
          </p>
        </div>
        <ProfileScoreReadout />
      </div>

      <DetailsProvider>
        <div className="mt-5 flex flex-col gap-3 lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:grid-rows-[minmax(0,1fr)]">
          <ScrollColumn>
            <Cell order="order-1">
              <IdentityCard
                name={name}
                subtitle={educationLine(details?.education) ?? headline}
                skills={data.mostUsedSkills}
              />
            </Cell>
            <Cell order="order-2">
              <ProfileScoreCard />
            </Cell>
            <Cell order="order-3">
              <AchievementsSection />
            </Cell>
            <Cell order="order-11">
              <ResumeFileRow />
            </Cell>
            <Cell order="order-2">
              <div id="profile-level"><ContactSection /></div>
            </Cell>
            <Cell order="order-5">
              <EducationSection />
            </Cell>
            <Cell order="order-6">
              <SkillsSection />
            </Cell>
            <Cell order="order-10">
              <ConnectedSourcesCard profile={data} />
            </Cell>
          </ScrollColumn>

          <ScrollColumn>
            <Cell order="order-3">
              <ExperienceSection />
            </Cell>
            <Cell order="order-4">
              <ProjectsSection />
            </Cell>
            <Cell order="order-9">
              <SourceSignalCards profile={data} />
            </Cell>
            <Cell order="order-12">
              <div className="pt-2">
                <LogoutButton />
              </div>
            </Cell>
          </ScrollColumn>
        </div>
      </DetailsProvider>
    </div>
  );
}
