import { HudCard, HudEmpty, SegmentMeter } from "@/components/hud";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { JdFitBreakdown, JdFitEvidence, JdFitPart } from "@/features/jobs";
import { levelGapText } from "@/app/(app)/jobs/_components/MatchPill";
import { cn } from "@/lib/utils/cn";

const PART_LABEL: Record<JdFitPart["key"], string> = {
  skills: "Skills",
  domain: "Domain",
  role: "Role",
  experience: "Experience",
  round_topics: "Round topics",
};

const SOURCE_LABEL: Record<JdFitEvidence["source"], string> = {
  resume: "resume",
  github: "GitHub",
  leetcode: "LeetCode",
  codeforces: "Codeforces",
  tuf: "TUF",
};

const FOOTER = "How closely your resume, GitHub and coding profiles match this role's listing. A mock-prep guide, not a hiring decision.";

/** One line saying what the part found, in words. */
export function partSummary(part: JdFitPart): string {
  if (part.status === "dropped") return part.reason ?? "Not scored for this role.";
  if (part.status === "missing") return part.hint ?? "Nothing to match yet.";
  const total = part.evidence.length + part.uncovered.length;
  switch (part.key) {
    case "skills":
      return `${part.evidence.length} of ${total} in this role's stack`;
    case "domain":
    case "role":
      return part.evidence[0] ? `${part.evidence[0].tag} work found` : `No ${part.uncovered[0] ?? ""} work found yet`;
    case "experience":
      return part.evidence[0] ? `${part.evidence[0].matched} full-time vs ${part.evidence[0].tag}` : "";
    case "round_topics":
      return `${part.evidence.length} of ${total} topics practised`;
  }
}

function evidenceText(part: JdFitPart, e: JdFitEvidence): string {
  if (part.key === "skills") return `${e.tag} · ${e.item} (${SOURCE_LABEL[e.source]})`;
  if (part.key === "round_topics") return `${e.tag} · ${e.matched} on ${SOURCE_LABEL[e.source]}`;
  if (part.key === "experience") return "";
  return `"${e.matched}" in ${e.item} (${SOURCE_LABEL[e.source]})`;
}

function PartRow({ part }: { part: JdFitPart }) {
  const dropped = part.status === "dropped";
  const details = part.evidence.map((e) => evidenceText(part, e)).filter(Boolean);
  return (
    <li className={cn("flex flex-col gap-2 py-3.5 first:pt-0 last:pb-0", dropped && "opacity-60")}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-sm">{PART_LABEL[part.key]}</span>
        <span className="font-mono text-xs tabular-nums text-faint">
          {dropped ? "not scored" : `${Math.round(part.value * 100)}% · weight ${part.weight}`}
        </span>
      </div>
      {dropped ? null : <SegmentMeter segments={10} filled={Math.round(part.value * 10)} label={`${PART_LABEL[part.key]}: ${Math.round(part.value * 100)}%`} />}
      <p className={cn("m-0 text-[13px]", part.status === "missing" ? "text-foreground" : "text-muted-foreground")}>{partSummary(part)}</p>
      {details.length > 0 || part.uncovered.length > 0 ? (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {details.map((d) => (
            <li key={d} className="rounded-full border border-line-3 px-2.5 py-1 text-[11.5px] leading-none text-muted-foreground">
              ✓ {d}
            </li>
          ))}
          {part.status === "scored"
            ? part.uncovered.map((u) => (
                <li key={u} className="rounded-full border border-dashed border-line-3 px-2.5 py-1 text-[11.5px] leading-none text-faint">
                  ✗ {u}
                </li>
              ))
            : null}
        </ul>
      ) : null}
    </li>
  );
}

/** "Your match": the JD fit score, part by part, with the evidence behind each part. */
export function MatchTab({ fit, isLoading, isError, onRetry }: { fit: JdFitBreakdown | undefined; isLoading: boolean; isError: boolean; onRetry: () => void }) {
  if (isLoading) {
    return (
      <div aria-busy="true" aria-label="Loading your match" className="flex flex-col gap-2.5">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[76px] rounded-[14px]" />)}
      </div>
    );
  }
  if (isError || !fit) {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-line-2 px-5 py-4">
        <p className="m-0 text-sm text-destructive">Couldn&apos;t load your match for this role.</p>
        <Button variant="outline" size="sm" onClick={onRetry}>Try again</Button>
      </div>
    );
  }
  if (fit.score === null) {
    return (
      <HudCard as="div">
        <HudEmpty title="No match score yet" hint="This role doesn't list a stack, domain, experience range or interview topics to match against yet." />
      </HudCard>
    );
  }
  const gap = levelGapText(fit.levelGap, fit.jdLevel);
  return (
    <HudCard
      title="Your match"
      titleAs="h3"
      meta={<span className="font-mono tabular-nums">{fit.score}%</span>}
      bodyClassName="flex flex-col gap-4 p-4 sm:p-5"
    >
      {gap || fit.levelFactor !== null ? (
        <p className="m-0 text-[13px] text-muted-foreground">
          {gap ?? "One level below your level"}
          {fit.cap !== null ? ` · capped at ${fit.cap}% because this role is two or more levels above yours` : ""}
          {fit.levelFactor !== null ? ` · scored ×${fit.levelFactor} for the level gap` : ""}
        </p>
      ) : null}
      <ul className="m-0 list-none divide-y divide-line-2 p-0">
        {fit.parts.map((part) => <PartRow key={part.key} part={part} />)}
      </ul>
      <p className="m-0 border-t border-line-2 pt-3 text-xs text-faint">{FOOTER}</p>
    </HudCard>
  );
}
