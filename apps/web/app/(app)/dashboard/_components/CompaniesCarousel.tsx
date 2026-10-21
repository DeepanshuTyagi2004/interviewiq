"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Carousel, CompanyArt, SectionHeader } from "@/components/ds";
import { useJds, useJobCompanies, type JdSummary, type JobCompany } from "@/features/jobs";
import { isLiveJd } from "../../jobs/_components/library";
import { ROUTES } from "@/lib/constants/shared";

export interface ResearchedCompany {
  slug: string;
  name: string;
  roles: number;
}

/**
 * Companies with at least one live (researched) role, in the order the API returned them, with
 * the number of live roles each. Nothing is ranked: we have no popularity data.
 */
export function researchedCompanies(
  companies: JobCompany[] | undefined,
  jds: JdSummary[] | undefined,
): ResearchedCompany[] {
  const live = new Map<string, number>();
  for (const jd of jds ?? []) if (isLiveJd(jd)) live.set(jd.company, (live.get(jd.company) ?? 0) + 1);
  return (companies ?? [])
    .filter((c) => live.has(c.slug))
    .map((c) => ({ slug: c.slug, name: c.name, roles: live.get(c.slug) ?? 0 }));
}

export function CompaniesCarousel() {
  const companies = useJobCompanies();
  const jds = useJds();
  const list = researchedCompanies(companies.data, jds.data);
  if (list.length === 0) return null;

  return (
    <section aria-label="Researched processes" className="mt-11">
      <Carousel
        label="researched processes"
        header={<SectionHeader title="Researched processes" href={ROUTES.jobs} className="mb-0" />}
      >
        {list.map((c) => (
          <li key={c.slug} className="w-[min(86vw,358px)]">
            <Link
              href={`${ROUTES.jobs}/c/${c.slug}`}
              className="group grid min-h-[200px] grid-cols-[44%_1fr] gap-4 rounded-card bg-surface p-2.5 shadow-ring outline-none transition-transform duration-[250ms] ease-iq hover:-translate-y-[3px] focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              <CompanyArt slug={c.slug} name={c.name} />
              <span className="flex min-w-0 flex-col py-2.5 pr-1.5">
                <span
                  title={c.name}
                  className="line-clamp-3 break-words font-display text-[22px] font-medium leading-[1.12] tracking-[-0.03em]"
                >
                  {c.name}
                </span>
                <span className="mt-1.5 text-[13px] text-ink-3">
                  {c.roles} {c.roles === 1 ? "role" : "roles"}
                </span>
                <span
                  aria-hidden
                  className="mt-auto grid h-[34px] w-[34px] flex-none place-items-center self-end rounded-full bg-ink text-background"
                >
                  <ArrowRight className="h-[15px] w-[15px]" strokeWidth={2} />
                </span>
              </span>
            </Link>
          </li>
        ))}
      </Carousel>
    </section>
  );
}
