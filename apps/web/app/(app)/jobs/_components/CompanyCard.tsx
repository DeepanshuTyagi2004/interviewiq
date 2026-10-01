import Link from "next/link";
import { ArrowDown, ArrowRight } from "lucide-react";
import { MonoPill } from "@/components/patterns";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/constants/shared";
import { cn } from "@/lib/utils/cn";
import { CompanyTile } from "./CompanyTile";
import { DepthMeter } from "./DepthMeter";
import { cardCta, researchedLine, rolesLine, type CompanyEntry } from "./library";

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
      <p className={cn(base, "m-0 flex items-center justify-center rounded-md border border-dashed border-line-3 text-faint")}>
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

/** One company in the library grid: tile, name, role count, status pill, data depth and action. */
export function CompanyCard({ entry, onShowRoles }: CompanyCardProps) {
  const headingId = `company-${entry.slug}`;
  const researched = researchedLine(entry);
  return (
    <article
      aria-labelledby={headingId}
      className={cn(
        "flex min-h-[200px] min-w-0 flex-col gap-3.5 rounded-[10px] border bg-card p-5 transition-shadow duration-300 ease-iq hover:shadow-lift",
        entry.live ? "border-foreground" : "border-line-2",
      )}
    >
      <div className="flex items-center gap-3">
        <CompanyTile name={entry.name} live={entry.live} />
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="m-0 truncate text-base font-normal tracking-[-0.01em]">
            {entry.name}
          </h2>
          <p className="m-0 text-xs text-faint">{rolesLine(entry)}</p>
        </div>
        {entry.live ? (
          <MonoPill tone="brand">Live</MonoPill>
        ) : (
          <MonoPill className="bg-panel text-faint">Researching</MonoPill>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <DepthMeter availability={entry.availability} />
        {researched ? <p className="m-0 text-xs text-muted-foreground">{researched}</p> : null}
      </div>

      <CardAction entry={entry} onShowRoles={onShowRoles} />
    </article>
  );
}
