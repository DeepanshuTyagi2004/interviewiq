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
import { ActivityCard } from "./SourceActivity";
import { SummaryCard } from "./SummaryCard";
import { educationLine } from "./identity";

const SCAFFOLD = "mx-auto flex w-full max-w-[1600px] flex-col px-4 pb-14 pt-6 sm:px-8 sm:pt-9 lg:px-10";

/** A desktop column; below `lg` it dissolves so its cards join the single column in `order`. */
const COLUMN = "contents lg:flex lg:min-w-0 lg:flex-col lg:gap-3";

/** One card's slot. `order` is its place in the phone/tablet column; on desktop the column decides. */
function Cell({ order, children }: { order: string; children: React.ReactNode }) {
  return <div className={cn("min-w-0 lg:order-none", order)}>{children}</div>;
}

/**
 * The profile. Desktop: short facts on the left (identity, resume file, contact, education, skills,
 * achievements, sources), the long parts on the right (summary, experience, projects, activity).
 * Phones and tablets get one column in reading order. Each resume section edits on its own.
 * Descriptive throughout — the only score slots are the identity card's two "—" tiles.
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
          {headline ?? "What your interviewer knows about you, from your resume and connected sources."}
        </p>
      </div>

      <DetailsProvider>
        <div className="mt-7 flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:items-start">
          <div className={COLUMN}>
            <Cell order="order-1">
              <IdentityCard
                name={name}
                subtitle={educationLine(details?.education) ?? headline}
                skills={data.mostUsedSkills}
              />
            </Cell>
            <Cell order="order-11">
              <ResumeFileRow />
            </Cell>
            <Cell order="order-2">
              <ContactSection />
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
            <Cell order="order-10">
              <ConnectedSourcesCard profile={data} />
            </Cell>
          </div>

          <div className={COLUMN}>
            <Cell order="order-8">
              <SummaryCard atAGlance={data.atAGlance} notable={data.notable} />
            </Cell>
            <Cell order="order-3">
              <ExperienceSection />
            </Cell>
            <Cell order="order-4">
              <ProjectsSection />
            </Cell>
            <Cell order="order-9">
              <ActivityCard profile={data} />
            </Cell>
            <Cell order="order-12">
              <div className="pt-2">
                <LogoutButton />
              </div>
            </Cell>
          </div>
        </div>
      </DetailsProvider>
    </div>
  );
}
