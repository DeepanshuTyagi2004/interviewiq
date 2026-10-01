"use client";

import { useWatch, type Control } from "react-hook-form";
import { useProfile } from "@/features/profile";
import { initialsOf } from "@/lib/utils/format";
import type { CandidateFormValues } from "../form";
import { parseSkills } from "./SkillsInput";

const MAX_SKILLS = 6;

export interface ProfilePreviewProps {
  control: Control<CandidateFormValues>;
  /** The role picked on the Target step, e.g. "Meesho · SDE I Backend". */
  target: string | null;
}

/**
 * Live "what the interviewer will know about you" card beside the onboarding form. Descriptive
 * only — the profile score row stays empty until the scoring contract exists.
 */
export function ProfilePreview({ control, target }: ProfilePreviewProps) {
  const [fullName, education, experience, skillsText] = useWatch({
    control,
    name: ["fullName", "education", "experience", "skillsText"],
  });
  const profile = useProfile();

  const edu = education[0];
  const subtitle = edu?.institution
    ? [edu.institution, edu.endYear].filter(Boolean).join(" · ")
    : "Upload a résumé to fill this in";
  const roles = experience.filter((e) => e.company || e.title).length;
  const connected = profile.data?.sources.filter((s) => s.connected).length ?? 0;
  const skills = parseSkills(skillsText).slice(0, MAX_SKILLS);

  return (
    <aside
      aria-label="Profile preview"
      className="m-3 flex min-w-0 flex-[1_1_340px] flex-col gap-5 rounded-lg bg-panel p-5 sm:p-7"
    >
      <p className="iq-eyebrow m-0">Profile preview</p>
      <div className="flex flex-col gap-4 rounded-[10px] bg-card p-5 shadow-[0_20px_50px_-24px_rgba(0,0,0,.2)] sm:p-[22px]">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-primary text-base text-primary-foreground"
          >
            {initialsOf(fullName)}
          </span>
          <div className="min-w-0">
            <p className="m-0 truncate text-base">{fullName || "Your name"}</p>
            <p className="m-0 truncate text-[12.5px] text-faint">{subtitle}</p>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between text-[12.5px]">
            <span className="text-faint">Profile score</span>
            <span className="font-mono text-faint">Not scored yet</span>
          </div>
          <div aria-hidden className="h-1 rounded-sm bg-line-2" />
        </div>

        <dl className="m-0 flex flex-col gap-[9px] text-[13px]">
          <Row label="Experience" value={roles === 0 ? "Fresher" : `${roles} ${roles === 1 ? "role" : "roles"}`} />
          <Row label="Sources" value={connected ? `${connected} connected` : "—"} />
          <Row label="Target" value={target ?? "—"} />
        </dl>

        {skills.length > 0 ? (
          <ul className="m-0 flex list-none flex-wrap gap-[5px] p-0">
            {skills.map((s) => (
              <li key={s} className="rounded bg-panel px-2 py-[3px] text-[11.5px]">
                {s}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <p className="m-0 mt-auto text-[13px] leading-[1.5] text-muted-foreground">
        Your résumé and sources shape every question the interviewer asks. You can edit all of this later.
      </p>
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-faint">{label}</dt>
      <dd className="m-0 truncate text-right">{value}</dd>
    </div>
  );
}
