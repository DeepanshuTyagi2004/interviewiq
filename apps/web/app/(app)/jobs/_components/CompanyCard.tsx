import Link from "next/link";
import { ArrowDown, ArrowRight } from "lucide-react";
import { HudCard, StatusDot } from "@/components/hud";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/constants/shared";
import { cn } from "@/lib/utils/cn";
import { CompanyTile } from "./CompanyTile";
import { DepthMeter } from "./DepthMeter";
import { cardCta, researchedCount, researchedLine, rolesLine, type CompanyEntry } from "./library";

export interface CompanyCardProps {
  entry: CompanyEntry;
  /** Show this company's roles in the list below the grid. */
  onShowRoles: (slug: string) => void;
}

function CardAction({ entry, onShowRoles }: CompanyCardProps) {
  const cta = cardCta(entry);
  const base = "mt-auto h-9 w-full text-[13px]";

  if (cta.kind === "none") {
    return (
      <p className={cn(base, "m-0 flex items-center justify-center rounded-full border border-dashed border-line-3 text-faint")}>
        Nothing to open yet
      </p>
    );
  }

  if (cta.kind === "open") {
    return (
      <Button asChild variant={cta.primary ? "default" : "outline"} className={base}>
        <Link href={`${ROUTES.jobs}/${cta.jd.id}`}>
          <span className="min-w-0 truncate">Open {cta.jd.title}</span>
          <ArrowRight aria-hidden />
        </Link>
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant={cta.primary ? "default" : "outline"}
      className={base}
      aria-controls="roles"
      onClick={() => onShowRoles(entry.slug)}
    >
      Choose from {cta.count} roles
      <ArrowDown aria-hidden />
    </Button>
  );
}

/** One company in the library grid: tile, name, role count, status dot, data depth and action. */
export function CompanyCard({ entry, onShowRoles }: CompanyCardProps) {
  const headingId = `company-${entry.slug}`;
  // "4 of 52 roles researched" only says something new when it differs from "52 roles · 4 live".
  const researched = entry.live && researchedCount(entry) === entry.liveJds.length ? null : researchedLine(entry);
  const templatesOnly = entry.jds.length > 0 && entry.jds.every((jd) => jd.practiceTemplate);
  return (
    <HudCard
      as="article"
      aria-labelledby={headingId}
      active={entry.live}
      className={cn(
        "rounded-[14px] border transition-shadow duration-300 ease-iq hover:shadow-lift",
        entry.live ? "border-line-4" : "border-line-2",
      )}
      bodyClassName="flex min-h-[176px] flex-col gap-3.5 p-5"
    >
      <div className="flex items-center gap-3">
        <CompanyTile name={entry.name} live={entry.live} />
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="m-0 truncate text-base font-normal tracking-[-0.01em]">
            {entry.name}
          </h2>
          <p className="m-0 text-xs text-faint">{rolesLine(entry)}</p>
        </div>
        <StatusDot
          state={entry.live ? "active" : "idle"}
          label={templatesOnly ? "Practice" : entry.live ? "Live" : "Researching"}
          className={cn("flex-none", !entry.live && "text-faint")}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        {templatesOnly ? <span className="text-xs text-muted-foreground">Practice template</span> : <DepthMeter availability={entry.availability} />}
        {researched ? <p className="m-0 text-xs text-muted-foreground">{researched}</p> : null}
      </div>

      <CardAction entry={entry} onShowRoles={onShowRoles} />
    </HudCard>
  );
}
