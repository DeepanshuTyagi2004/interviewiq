import type { SkillItem } from "@/features/profile";
import { HudCard, Readout } from "@/components/hud";
import { initialsOf } from "@/lib/utils/format";
import { PROVIDERS } from "@/app/(app)/connections/_components/providers";
import { SourceIcon } from "@/app/(app)/connections/_components/SourceIcon";

const SOURCE_LABEL = new Map(PROVIDERS.map((p) => [p.source, p.label]));

export interface IdentityCardProps {
  name: string | null;
  subtitle: string | null;
  skills: SkillItem[];
}

/**
 * Avatar, name and education line, the interview score tile, and most-used skills when known. The
 * interview aggregate isn't available, so this score stays an honest "—". The provisional
 * profile assessment lives in its own card and never populates this interview tile.
 */
export function IdentityCard({ name, subtitle, skills }: IdentityCardProps) {
  return (
    <HudCard
      notch
      as="section"
      aria-label="About you"
      className="rounded-[14px] border border-line-2 bg-card p-5 sm:p-[22px]"
      bodyClassName="flex flex-col gap-4"
    >
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

      <div className="min-w-0 rounded-lg bg-panel p-3.5">
        {/* The visible note repeats the sr-only text, so it's hidden from screen readers. */}
        <Readout
          label="Interview score"
          value={
            <>
              <span aria-hidden className="text-faint">
                —
              </span>
              <span className="sr-only">Not scored yet</span>
            </>
          }
          note={<span aria-hidden>Not scored yet</span>}
        />
      </div>

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
    </HudCard>
  );
}
