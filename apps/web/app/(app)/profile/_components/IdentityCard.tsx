import type { SkillItem } from "@/features/profile";
import { initialsOf } from "@/lib/utils/format";
import { PROVIDERS } from "@/app/(app)/connections/_components/providers";
import { SourceIcon } from "@/app/(app)/connections/_components/SourceIcon";

const SOURCE_LABEL = new Map(PROVIDERS.map((p) => [p.source, p.label]));

/**
 * The design's score tiles. The scoring contract doesn't exist yet (formulas are an open product
 * decision), so both are an honest "—".
 */
const SCORES = ["Profile score", "Interview score"];

export interface IdentityCardProps {
  name: string | null;
  subtitle: string | null;
  skills: SkillItem[];
}

/** Avatar, name and education line, the two (not yet scored) score tiles, and most-used skills when known. */
export function IdentityCard({ name, subtitle, skills }: IdentityCardProps) {
  return (
    <section aria-label="About you" className="flex flex-col gap-4 rounded-[14px] border border-line-2 bg-card p-5 sm:p-[22px]">
      <div className="flex items-center gap-3.5">
        <span
          aria-hidden
          className="flex h-[52px] w-[52px] flex-none items-center justify-center rounded-full bg-primary text-lg text-primary-foreground"
        >
          {initialsOf(name)}
        </span>
        <div className="min-w-0">
          <p className="m-0 truncate text-base tracking-[-0.01em]">{name ?? "Your name"}</p>
          <p className="m-0 truncate text-[12.5px] text-faint">{subtitle ?? "Add your education below"}</p>
        </div>
      </div>

      <ul className="m-0 grid list-none grid-cols-2 gap-2.5 p-0">
        {SCORES.map((label) => (
          <li key={label} className="flex min-w-0 flex-col gap-1 rounded-lg bg-panel p-3.5">
            <span className="text-xs text-faint">{label}</span>
            <span className="text-[26px] leading-none tracking-[-0.04em] text-faint-2">
              <span aria-hidden>—</span>
              <span className="sr-only">Not scored yet</span>
            </span>
            <span aria-hidden className="text-[11.5px] text-muted-foreground">
              Not scored yet
            </span>
          </li>
        ))}
      </ul>

      {/* Skills the source summary picked out, each tagged with where it came from. The resume's own
          skills list has its own card, so nothing shows here until the summary has run. */}
      {skills.length ? (
        <div className="flex flex-col gap-2">
          <p className="iq-eyebrow m-0">Most-used skills</p>
          <ul className="m-0 flex list-none flex-wrap gap-[5px] p-0">
            {skills.map((s, i) => {
              const from = SOURCE_LABEL.get(s.source) ?? s.source;
              return (
                <li
                  key={`${s.source}-${s.skill}-${i}`}
                  title={s.evidence ? `${s.skill}: ${s.evidence}` : `${s.skill} · from ${from}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line-3 px-2.5 py-1 text-xs"
                >
                  {s.skill}
                  <SourceIcon source={s.source} className="h-3 w-3 text-faint" />
                  <span className="sr-only">(from {from})</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
