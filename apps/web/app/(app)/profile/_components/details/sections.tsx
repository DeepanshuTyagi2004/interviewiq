"use client";

import { ArrowUpRight } from "lucide-react";
import { FormattedLines } from "@/components/patterns";
import {
  AchievementsField,
  EducationFields,
  ExperienceFields,
  PersonalFields,
  ProjectFields,
  SkillsField,
} from "@/features/onboarding";
import { displayLink, externalHref, yearRange } from "../identity";
import { EditableSection } from "./EditableSection";
import { useDetails } from "./DetailsProvider";
import { levelLabel } from "@/lib/constants/engineering-levels";

/**
 * The profile's resume sections. Each is an EditableSection: a compact read-only view plus the
 * matching onboarding fields for its edit mode. Descriptive only — they show what the resume says.
 */

const dash = (parts: (string | null | undefined)[], sep = " · ") =>
  parts.map((p) => p?.trim()).filter(Boolean).join(sep);

export function ContactSection({ className }: { className?: string }) {
  const { profile } = useDetails();
  const rows: [string, string | null | undefined][] = [
    ["Name", profile?.fullName],
    ["Level", profile?.level ? levelLabel(profile.level) : "Choose a level"],
    ["Headline", profile?.headline],
    ["Email", profile?.email],
    ["Phone", profile?.phone],
    ["Location", profile?.location],
    ["Target role", profile?.targetRole],
  ];
  const shown = rows.filter(([, v]) => Boolean(v?.trim()));

  return (
    <EditableSection
      section="contact"
      isEmpty={shown.length === 0}
      emptyHint="Add your name, email and where you're based."
      fields={<PersonalFields />}
      className={className}
    >
      <dl className="m-0 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-4 gap-y-2 px-4 py-4 text-[13px] sm:px-5">
        {shown.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-faint">{label}</dt>
            <dd className="m-0 min-w-0 break-words">{value}</dd>
          </div>
        ))}
      </dl>
      {profile?.portfolioWebsite ? (
        <div className="border-t border-line px-4 py-3.5 text-[13px] sm:px-5">
          <span className="mr-4 text-faint">Portfolio</span>
          {externalHref(profile.portfolioWebsite) ? (
            <a
              href={externalHref(profile.portfolioWebsite)!}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex max-w-full items-center gap-1 font-mono text-[11.5px] text-faint hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <span className="truncate">{displayLink(externalHref(profile.portfolioWebsite)!)}</span>
              <ArrowUpRight aria-hidden className="h-3 w-3 flex-none" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          ) : null}
        </div>
      ) : null}
    </EditableSection>
  );
}

export function EducationSection({ className }: { className?: string }) {
  const { profile } = useDetails();
  const education = profile?.education ?? [];

  return (
    <EditableSection
      section="education"
      count={education.length}
      isEmpty={education.length === 0}
      emptyHint="Add your college and school."
      fields={<EducationFields heading={false} />}
      className={className}
    >
      <ul className="m-0 list-none divide-y divide-line p-0">
        {education.map((e, i) => (
          <li key={i} className="px-4 py-3.5 sm:px-5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <p className="m-0 min-w-0 text-sm">{dash([e.degree, e.field], ", ") || e.institution || "—"}</p>
              {yearRange(e.startYear, e.endYear) ? (
                <p className="m-0 flex-none font-mono text-[11.5px] text-faint">{yearRange(e.startYear, e.endYear)}</p>
              ) : null}
            </div>
            {dash([e.degree || e.field ? e.institution : null, e.grade]) ? (
              <p className="m-0 mt-0.5 text-[12.5px] text-muted-foreground">
                {dash([e.degree || e.field ? e.institution : null, e.grade])}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </EditableSection>
  );
}

export function SkillsSection({ className }: { className?: string }) {
  const { profile } = useDetails();
  const skills = profile?.skills ?? [];

  return (
    <EditableSection
      section="skills"
      count={skills.length}
      isEmpty={skills.length === 0}
      emptyHint="Add the languages, frameworks and tools you use."
      fields={<SkillsField heading={false} />}
      className={className}
    >
      <ul className="m-0 flex list-none flex-wrap gap-[5px] px-4 py-4 sm:px-5">
        {skills.map((s) => (
          <li key={s} className="rounded-full border border-line-3 px-2.5 py-1 text-xs">
            {s}
          </li>
        ))}
      </ul>
    </EditableSection>
  );
}

export function AchievementsSection({ className }: { className?: string }) {
  const { profile } = useDetails();
  const achievements = profile?.achievements ?? [];

  return (
    <EditableSection
      section="achievements"
      count={achievements.length}
      isEmpty={achievements.length === 0}
      emptyHint="No achievements added"
      fields={<AchievementsField heading={false} />}
      className={className}
    >
      <FormattedLines lines={achievements} className="px-4 py-4 text-[13px] leading-[1.5] sm:px-5" />
    </EditableSection>
  );
}

export function ExperienceSection({ className }: { className?: string }) {
  const { profile } = useDetails();
  const experience = profile?.experience ?? [];

  return (
    <EditableSection
      section="experience"
      count={experience.length}
      isEmpty={experience.length === 0}
      emptyHint="Add internships and jobs — what you built and the impact it had."
      fields={<ExperienceFields heading={false} />}
      className={className}
    >
      <ol className="m-0 list-none divide-y divide-line p-0">
        {experience.map((x, i) => {
          const dates = dash([x.startDate, x.endDate], " – ");
          const sub = dash([x.title ? x.company : null, x.location]);
          return (
            <li key={i} className="px-4 py-4 sm:px-5 sm:py-5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                <h3 className="m-0 min-w-0 text-sm font-normal">{x.title || x.company || "Untitled role"}</h3>
                {dates ? <p className="m-0 flex-none font-mono text-[11.5px] text-faint">{dates}</p> : null}
              </div>
              {sub ? <p className="m-0 mt-0.5 text-[12.5px] text-muted-foreground">{sub}</p> : null}
              {externalHref(x.link ?? null) ? (
                <a
                  href={externalHref(x.link ?? null)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex max-w-full items-center gap-1 font-mono text-[11.5px] text-faint hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <span className="truncate">{displayLink(externalHref(x.link ?? null)!)}</span>
                  <ArrowUpRight aria-hidden className="h-3 w-3 flex-none" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              ) : x.link?.trim() ? <p className="m-0 mt-1 truncate font-mono text-[11.5px] text-faint">{x.link}</p> : null}
              <FormattedLines lines={x.bullets ?? []} className="mt-3 text-[13px] leading-[1.55]" />
            </li>
          );
        })}
      </ol>
    </EditableSection>
  );
}

export function ProjectsSection({ className }: { className?: string }) {
  const { profile } = useDetails();
  const projects = profile?.projects ?? [];

  return (
    <EditableSection
      section="projects"
      count={projects.length}
      isEmpty={projects.length === 0}
      emptyHint="Add side, academic or open-source projects."
      fields={<ProjectFields heading={false} />}
      className={className}
    >
      {/* Two tiles side by side wherever the column is wide enough for them. */}
      <ul className="m-0 grid list-none gap-3 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-1 xl:grid-cols-2">
        {projects.map((p, i) => {
          const href = externalHref(p.link);
          const tech = p.tech ?? [];
          return (
            <li key={i} className="flex min-w-0 flex-col rounded-lg border border-line-2 p-4">
              <h3 className="m-0 text-sm font-normal">{p.name || "Untitled project"}</h3>
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-0.5 inline-flex min-w-0 items-center gap-1 self-start font-mono text-[11.5px] text-faint transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <span className="truncate">{displayLink(href)}</span>
                  <ArrowUpRight aria-hidden className="h-3 w-3 flex-none" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              ) : p.link?.trim() ? (
                <p className="m-0 mt-0.5 truncate font-mono text-[11.5px] text-faint">{p.link}</p>
              ) : null}
              {p.description ? (
                <p className="m-0 mt-2 text-[13px] leading-[1.5] text-muted-foreground">{p.description}</p>
              ) : null}
              {tech.length ? (
                <ul aria-label="Tech" className="m-0 mt-2.5 flex list-none flex-wrap gap-1 p-0">
                  {tech.map((t) => (
                    <li key={t} className="rounded-full bg-panel px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                      {t}
                    </li>
                  ))}
                </ul>
              ) : null}
              <FormattedLines lines={p.bullets ?? []} className="mt-3 text-[13px] leading-[1.5]" />
            </li>
          );
        })}
      </ul>
    </EditableSection>
  );
}
