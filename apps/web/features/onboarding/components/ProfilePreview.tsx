"use client";

import { useWatch, type Control } from "react-hook-form";
import { GraduationCap, MapPin } from "lucide-react";
import { useProfile } from "@/features/profile";
import { PROVIDERS } from "@/app/(app)/connections/_components/providers";
import { cn } from "@/lib/utils/cn";
import { initialsOf } from "@/lib/utils/format";
import { educationLine } from "../education";
import type { CandidateFormValues } from "../form";
import { parseSkills } from "./SkillsInput";

const MAX_ROLES = 3;
const MAX_PROJECTS = 4;
const MAX_SKILLS = 12;
/** Account sources shown here — the resume is the form itself. */
const ACCOUNT_SOURCES = PROVIDERS.filter((p) => p.source !== "RESUME");

export interface ProfilePreviewProps {
  control: Control<CandidateFormValues>;
  /** The role picked on the Target step, e.g. "Meesho · SDE I Backend". */
  target: string | null;
  /** Placement/visibility from the wizard (side column on desktop, inline on phones). */
  className?: string;
}

const join = (parts: (string | undefined)[], sep = " · ") =>
  parts.map((p) => p?.trim()).filter(Boolean).join(sep);

/**
 * Live "what the interviewer will know about you" card beside the onboarding form, laid out like
 * the profile page. Updates as you type. Descriptive only — the interview score tile stays "—" until
 * the scoring contract exists, and "Still missing" lists gaps, never a percentage.
 */
export function ProfilePreview({ control, target, className }: ProfilePreviewProps) {
  const [fullName, headline, location, education, experience, projects, skillsText] = useWatch({
    control,
    name: ["fullName", "headline", "location", "education", "experience", "projects", "skillsText"],
  });
  const profile = useProfile();

  const roles = experience.filter((e) => e.company.trim() || e.title.trim());
  const named = projects.filter((p) => p.name.trim());
  const skills = parseSkills(skillsText);
  const eduLine = educationLine(
    education.map((e) => ({ ...e, startYear: e.startYear || null, endYear: e.endYear || null })),
  );
  const sources = ACCOUNT_SOURCES.flatMap((p) => {
    const src = profile.data?.sources.find((s) => s.source === p.source && s.connected);
    if (!src) return [];
    const handle =
      p.source === "GITHUB" ? profile.data?.fragments.github?.login : p.source === "LEETCODE" ? profile.data?.fragments.leetcode?.username : undefined;
    return [{ ...p, handle: handle ? `@${handle}` : null }];
  });

  const missing = [
    !fullName.trim() && "name",
    !headline.trim() && "headline",
    education.every((e) => !e.institution.trim() && !e.degree.trim()) && "education",
    roles.length === 0 && named.length === 0 && "experience or projects",
    skills.length === 0 && "skills",
  ].filter((m): m is string => Boolean(m));

  return (
    <aside aria-label="Profile preview" className={cn("min-w-0 flex-col gap-4 rounded-lg bg-panel p-5 sm:p-6", className)}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="iq-eyebrow m-0 font-normal">Profile preview</h2>
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-faint">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand" />
          Live
        </span>
      </div>

      <div className="flex flex-none flex-col overflow-hidden rounded-[14px] bg-card shadow-[0_20px_50px_-24px_rgba(0,0,0,.2)]">
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-primary text-base text-primary-foreground"
            >
              {initialsOf(fullName)}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="m-0 truncate text-base tracking-[-0.01em]">{fullName.trim() || "Your name"}</p>
              <p className="m-0 mt-0.5 line-clamp-2 text-[13px] leading-[1.45] text-muted-foreground">
                {headline.trim() || <span className="text-faint">Add a one-line headline</span>}
              </p>
            </div>
          </div>

          {eduLine || location.trim() ? (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[12.5px] text-muted-foreground">
              {eduLine ? (
                <li className="flex min-w-0 items-center gap-2">
                  <GraduationCap aria-hidden className="h-3.5 w-3.5 flex-none text-faint" />
                  <span className="truncate">{eduLine}</span>
                </li>
              ) : null}
              {location.trim() ? (
                <li className="flex min-w-0 items-center gap-2">
                  <MapPin aria-hidden className="h-3.5 w-3.5 flex-none text-faint" />
                  <span className="truncate">{location}</span>
                </li>
              ) : null}
            </ul>
          ) : null}

          <div className="flex min-w-0 flex-col gap-1 rounded-lg bg-panel px-3 py-2.5">
            <span className="text-[11.5px] text-faint">Interview score</span>
            <span className="text-lg leading-none tracking-[-0.04em] text-faint-2">
              <span aria-hidden>—</span>
              <span className="sr-only">Not scored yet</span>
            </span>
          </div>
        </div>

        <Section label="Experience" count={roles.length}>
          {roles.length ? (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {roles.slice(0, MAX_ROLES).map((r, i) => (
                <li key={i} className="flex min-w-0 items-baseline justify-between gap-3 text-[13px]">
                  <span className="min-w-0 truncate">{join([r.title, r.company])}</span>
                  {join([r.startDate, r.endDate], " – ") ? (
                    <span className="flex-none font-mono text-[10.5px] text-faint">{join([r.startDate, r.endDate], " – ")}</span>
                  ) : null}
                </li>
              ))}
              <More count={roles.length - MAX_ROLES} />
            </ul>
          ) : (
            <Empty>No roles yet — fine if you&apos;re a fresher.</Empty>
          )}
        </Section>

        <Section label="Projects" count={named.length}>
          {named.length ? (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {named.slice(0, MAX_PROJECTS).map((p, i) => {
                const tech = p.techText.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 3);
                return (
                  <li key={i} className="flex min-w-0 items-baseline justify-between gap-3 text-[13px]">
                    <span className="min-w-0 truncate">{p.name}</span>
                    {tech.length ? (
                      <span className="min-w-0 truncate font-mono text-[10.5px] text-faint">{tech.join(" · ")}</span>
                    ) : null}
                  </li>
                );
              })}
              <More count={named.length - MAX_PROJECTS} />
            </ul>
          ) : (
            <Empty>No projects yet.</Empty>
          )}
        </Section>

        <Section label="Skills" count={skills.length}>
          {skills.length ? (
            <ul className="m-0 flex list-none flex-wrap gap-[5px] p-0">
              {skills.slice(0, MAX_SKILLS).map((s) => (
                <li key={s} className="rounded-full bg-panel px-2.5 py-[3px] text-[11.5px]">
                  {s}
                </li>
              ))}
              {skills.length > MAX_SKILLS ? (
                <li className="px-1 py-[3px] font-mono text-[11px] text-faint">+{skills.length - MAX_SKILLS} more</li>
              ) : null}
            </ul>
          ) : (
            <Empty>No skills yet.</Empty>
          )}
        </Section>

        <Section label="Sources" count={sources.length}>
          {sources.length ? (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {sources.map((s) => (
                <li key={s.source} className="flex min-w-0 items-center gap-2.5 text-[13px]">
                  <span
                    aria-hidden
                    className="flex h-6 w-6 flex-none items-center justify-center rounded-[8px] bg-primary font-mono text-[9.5px] text-primary-foreground"
                  >
                    {s.code}
                  </span>
                  <span>{s.label}</span>
                  {s.handle ? <span className="min-w-0 truncate font-mono text-[11px] text-faint">{s.handle}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <Empty>None connected yet.</Empty>
          )}
        </Section>

        <Section label="Target">
          {target ? <p className="m-0 truncate text-[13px]">{target}</p> : <Empty>Not picked yet.</Empty>}
        </Section>
      </div>

      {missing.length ? (
        <p className="m-0 text-[12.5px] leading-[1.5] text-muted-foreground">
          <span className="text-faint">Still missing: </span>
          {missing.join(", ")}
        </p>
      ) : null}

      <p className="m-0 mt-auto text-[12.5px] leading-[1.5] text-faint">
        Your resume and sources shape every question the interviewer asks. You can edit all of this later.
      </p>
    </aside>
  );
}

function Section({ label, count, children }: { label: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 border-t border-line px-5 py-3.5">
      <h3 className="iq-eyebrow m-0 flex items-center gap-2 font-normal">
        {label}
        {count ? <span className="text-faint-2">{count}</span> : null}
      </h3>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="m-0 text-[12.5px] text-faint">{children}</p>;
}

function More({ count }: { count: number }) {
  return count > 0 ? <li className="font-mono text-[11px] text-faint">+{count} more</li> : null;
}
