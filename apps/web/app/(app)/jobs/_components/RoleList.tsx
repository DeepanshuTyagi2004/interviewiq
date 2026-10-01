import { forwardRef } from "react";
import Link from "next/link";
import { ArrowRight, X } from "lucide-react";
import { Panel } from "@/components/patterns";
import type { JdSummary } from "@/features/jobs";
import { ROUTES } from "@/lib/constants/shared";
import { cn } from "@/lib/utils/cn";
import { CompanyTile } from "./CompanyTile";
import { DepthMeter } from "./DepthMeter";
import { depthOf, isLiveJd, plural, specializationLabel, type LevelGroup } from "./library";

const chip =
  "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const chipOff = "border-line-3 bg-card text-foreground hover:border-foreground";
const chipOn = "border-foreground bg-primary text-primary-foreground";

function RoleRow({ jd }: { jd: JdSummary }) {
  const sub = [jd.companyName, jd.specialization ? specializationLabel(jd.specialization) : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="min-w-0">
      <Link
        href={`${ROUTES.jobs}/${jd.id}`}
        className="iq-float flex h-full items-center gap-3.5 border border-transparent px-4 py-3.5 transition-colors hover:border-foreground focus-visible:border-foreground focus-visible:outline-none"
      >
        <CompanyTile name={jd.companyName} live={isLiveJd(jd)} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px]">{jd.title}</span>
          <span className="block truncate text-xs text-faint">{sub}</span>
          {/* Phones: depth as its own line so the title keeps the width. */}
          <span className="block text-xs text-muted-foreground min-[420px]:hidden">
            Data depth · {depthOf(jd.dataAvailability).label}
          </span>
        </span>
        <DepthMeter availability={jd.dataAvailability} compact className="hidden min-[420px]:flex" />
        <ArrowRight aria-hidden className="h-4 w-4 flex-none text-faint" />
      </Link>
    </li>
  );
}

export interface RoleListProps {
  groups: LevelGroup[];
  /** The company the list is narrowed to, if any. */
  company: { slug: string; name: string } | null;
  onClearCompany: () => void;
  specializations: string[];
  specialization: string | null;
  onSpecialization: (value: string | null) => void;
}

/**
 * Every visible role, grouped by experience level, each linking to its roadmap. Narrow it to one
 * company (from a card) and, when the roles differ, to a specialization.
 */
export const RoleList = forwardRef<HTMLHeadingElement, RoleListProps>(function RoleList(
  { groups, company, onClearCompany, specializations, specialization, onSpecialization },
  headingRef,
) {
  const total = groups.reduce((n, g) => n + g.jds.length, 0);
  const showSpecs = specializations.length > 1;

  return (
    <section id="roles" aria-labelledby="roles-heading" className="mt-12 scroll-mt-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h2
            id="roles-heading"
            ref={headingRef}
            tabIndex={-1}
            className="m-0 text-[22px] font-normal leading-[1.15] tracking-[-0.03em] focus:outline-none"
          >
            {company ? `Roles at ${company.name}` : "All roles"}
          </h2>
          <p className="m-0 mt-1.5 text-sm text-muted-foreground">
            {plural(total, "role")}, by experience level. Open one to see its interview process.
          </p>
        </div>

        {company || showSpecs ? (
          <div role="group" aria-label="Filter roles" className="flex flex-wrap gap-1.5">
            {company ? (
              <button
                type="button"
                onClick={onClearCompany}
                aria-label={`Show roles from every company, not just ${company.name}`}
                className={cn(chip, chipOn)}
              >
                {company.name}
                <X aria-hidden className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {showSpecs ? (
              <>
                <button
                  type="button"
                  aria-pressed={specialization === null}
                  onClick={() => onSpecialization(null)}
                  className={cn(chip, specialization === null ? chipOn : chipOff)}
                >
                  Any specialization
                </button>
                {specializations.map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={specialization === s}
                    onClick={() => onSpecialization(specialization === s ? null : s)}
                    className={cn(chip, specialization === s ? chipOn : chipOff)}
                  >
                    {specializationLabel(s)}
                  </button>
                ))}
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {groups.length === 0 ? (
        <p className="m-0 mt-5 rounded-[10px] border border-dashed border-line-4 px-5 py-8 text-sm text-muted-foreground">
          No roles match these filters.
        </p>
      ) : (
        <div className="mt-5 flex flex-col gap-3">
          {groups.map((g) => (
            <Panel key={g.level} eyebrow={`${g.label} · ${plural(g.jds.length, "role")}`}>
              <ul className="m-0 grid list-none gap-2.5 p-0 [grid-template-columns:repeat(auto-fill,minmax(min(100%,320px),1fr))]">
                {g.jds.map((jd) => (
                  <RoleRow key={jd.id} jd={jd} />
                ))}
              </ul>
            </Panel>
          ))}
        </div>
      )}
    </section>
  );
});
