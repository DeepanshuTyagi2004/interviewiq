import type { SkillItem } from "@/features/profile";
import { Card, Chip, Stat } from "@/components/ds";
import { PROVIDERS } from "@/app/(app)/connections/_components/providers";
import { SourceIcon } from "@/app/(app)/connections/_components/SourceIcon";

const SOURCE_LABEL = new Map(PROVIDERS.map((p) => [p.source, p.label]));

export interface IdentityCardProps {
  skills: SkillItem[];
}

/**
 * The interview score tile and most-used skills when known. The name, headline and level live in
 * the page header. The interview aggregate isn't available, so this score stays an honest "—". The
 * provisional profile assessment lives in its own card and never populates this interview tile.
 */
export function IdentityCard({ skills }: IdentityCardProps) {
  return (
    <Card as="section" aria-label="About you" bodyClassName="flex flex-col gap-5">
      {/* The visible note repeats the sr-only text, so it's hidden from screen readers. */}
      <Stat
        label="Interview score"
        size="sm"
        value={
          <>
            <span aria-hidden className="text-ink-3">
              —
            </span>
            <span className="sr-only">Not scored yet</span>
          </>
        }
        note={<span aria-hidden>Not scored yet</span>}
      />

      {/* Skills the source summary picked out, each tagged with where it came from. The resume's own
          skills list has its own card, so nothing shows here until the summary has run. */}
      {skills.length ? (
        <div className="flex flex-col gap-2.5 border-t border-line pt-5">
          <p className="m-0 text-[13px] text-ink-3">Most-used skills</p>
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {skills.map((s, i) => {
              const from = SOURCE_LABEL.get(s.source) ?? s.source;
              return (
                <li key={`${s.source}-${s.skill}-${i}`} title={s.evidence ? `${s.skill}: ${s.evidence}` : `${s.skill} · from ${from}`}>
                  <Chip tone="outline">
                    {s.skill}
                    <SourceIcon source={s.source} className="h-3 w-3 text-ink-3" />
                    <span className="sr-only">(from {from})</span>
                  </Chip>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
