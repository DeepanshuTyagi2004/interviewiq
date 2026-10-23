import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, Chip, CompanyMark } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/constants/shared";
import { cn } from "@/lib/utils/cn";
import { DepthMeter } from "./DepthMeter";
import { cardCta, researchedCount, researchedLine, rolesLine, type CompanyEntry } from "./library";

export interface CompanyCardProps {
  entry: CompanyEntry;
  /** Show this company's roles in the list below the grid. */
  onShowRoles: (slug: string) => void;
}

/** Hidden until the card is hovered or holds focus, so a keyboard user sees the same actions. Always shown on touch. */
const REVEAL =
  "opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 motion-reduce:transition-none";

function CardActions({ entry, onShowRoles }: CompanyCardProps) {
  const cta = cardCta(entry);
  const base = "relative z-10 h-8 min-w-0 text-[13px]";

  if (cta.kind === "none") {
    return <p className="m-0 text-[13px] text-ink-3">Nothing to open yet</p>;
  }

  const primary = cta.primary ? "default" : "secondary";

  return (
    <div className={cn("flex min-w-0 items-center gap-2", REVEAL)}>
      {cta.kind === "open" ? (
        <>
          <Button asChild variant={primary} size="sm" className={cn(base, "flex-1")}>
            <Link href={`${ROUTES.jobs}/${cta.jd.id}`} title={cta.jd.title}>
              <span className="min-w-0 truncate">Open {cta.jd.title}</span>
              <ArrowRight aria-hidden />
            </Link>
          </Button>
          {entry.jds.length > 1 ? (
            <Button asChild variant="outline" size="sm" className={cn(base, "flex-none")}>
              <Link href={`${ROUTES.jobs}/c/${encodeURIComponent(entry.slug)}`}>View roles</Link>
            </Button>
          ) : null}
        </>
      ) : (
        <Button
          type="button"
          variant={primary}
          size="sm"
          className={cn(base, "flex-1")}
          aria-controls="roles"
          onClick={() => onShowRoles(entry.slug)}
        >
          Choose from {cta.count} roles
          <ArrowRight aria-hidden />
        </Button>
      )}
    </div>
  );
}

/** One company in the library grid: monogram, name, status chip, role count, data depth and actions on hover or focus. */
export function CompanyCard({ entry, onShowRoles }: CompanyCardProps) {
  const headingId = `company-${entry.slug}`;
  // "4 of 52 roles researched" only says something new when it differs from "52 roles · 4 live".
  const researched = entry.live && researchedCount(entry) === entry.liveJds.length ? null : researchedLine(entry);
  const templatesOnly = entry.jds.length > 0 && entry.jds.every((jd) => jd.practiceTemplate);
  const rolesHref = `${ROUTES.jobs}/c/${encodeURIComponent(entry.slug)}`;
  return (
    <Card
      as="article"
      tone="default"
      interactive
      aria-labelledby={headingId}
      className="group relative min-h-[176px] focus-within:ring-2 focus-within:ring-brand focus-within:ring-offset-2 focus-within:ring-offset-background"
      bodyClassName="flex h-full flex-col gap-3.5"
    >
      <div className="flex items-start gap-3">
        <CompanyMark seed={entry.slug} name={entry.name} size={44} />
        <div className="min-w-0 flex-1">
          <h2
            id={headingId}
            title={entry.name}
            className="m-0 truncate font-display text-[19px] font-normal leading-tight tracking-[-0.025em]"
          >
            {entry.jds.length > 0 ? (
              // The name link stretches over the whole card; the action buttons sit above it (z-10).
              <Link
                href={rolesHref}
                className="outline-none after:absolute after:inset-0 after:rounded-card after:content-['']"
              >
                {entry.name}
              </Link>
            ) : (
              entry.name
            )}
          </h2>
          <p className="m-0 mt-0.5 truncate text-[13px] text-ink-3">{rolesLine(entry)}</p>
        </div>
        <Chip tone={entry.live ? "ink" : "default"} dot={entry.live ? "live" : "hollow"} className="flex-none">
          {templatesOnly ? "Practice" : entry.live ? "Live" : "Researching"}
        </Chip>
      </div>

      <div className="flex flex-col gap-1.5">
        {templatesOnly ? <span className="text-[13px] text-ink-2">Practice template</span> : <DepthMeter availability={entry.availability} />}
        {researched ? <p className="m-0 text-[13px] text-ink-3">{researched}</p> : null}
      </div>

      <div className="mt-auto">
        <CardActions entry={entry} onShowRoles={onShowRoles} />
      </div>
    </Card>
  );
}
