"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Search, X } from "lucide-react";
import { EmptyState, Panel } from "@/components/patterns";
import { Button } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/custom-select";
import { Skeleton } from "@/components/ui/skeleton";
import { PAGE_SCAFFOLD } from "@/components/layout/page";
import { useJdFitList, useJds, useJobCompanies } from "@/features/jobs";
import { ROUTES } from "@/lib/constants/shared";
import { cn } from "@/lib/utils/cn";
import { CompanyTile } from "./CompanyTile";
import { RoleCard } from "./RoleCard";
import { groupByLevel, isLiveJd, levelLabel, plural, specializationLabel, specializationsOf } from "./library";
import {
  activeFilterCount, EMPTY_FILTERS, levelsOf, matchesFilters, parseFilters, PAY_STEPS, sortRoles, SORTS,
   stackCounts, toSearchParams, YOE_STEPS, type RoleFilters,
} from "./roleFilters";

const chip = "inline-flex h-8 items-center gap-1.5 rounded-full border px-3.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const chipOff = "border-line-3 bg-card text-foreground hover:border-faint-2";
const chipOn = "border-foreground bg-primary text-primary-foreground";
const select = "h-8 w-auto rounded-full border border-line-4 bg-card px-3 text-[13px] text-foreground transition-colors hover:border-faint-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const STACK_COLLAPSED = 14;

function toggle(list: string[], value: string): string[] {
  return list.some((v) => v.toLowerCase() === value.toLowerCase()) ? list.filter((v) => v.toLowerCase() !== value.toLowerCase()) : [...list, value];
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="iq-eyebrow m-0">{label}</p>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

/** `/jobs/c/[slug]`: one company's roles with search, filters and sorting kept in the URL. */
export function CompanyRoles({ slug }: { slug: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const companies = useJobCompanies();
  const jds = useJds({ company: slug });
  const fit = useJdFitList({ company: slug });
  const [showAllStack, setShowAllStack] = useState(false);
  const [moreFilters, setMoreFilters] = useState<boolean | null>(null);

  const filters = useMemo(() => parseFilters(new URLSearchParams(sp.toString())), [sp]);
  const all = useMemo(() => jds.data ?? [], [jds.data]);
  const company = companies.data?.find((c) => c.slug === slug);
  const name = company?.name ?? all[0]?.companyName ?? slug;

  // Specialization, tech stack, pay and experience tuck behind one toggle (they filled 300px of a laptop screen before the
  // first role); the experience-level chips stay visible. Open by default only when one of them is already applied.
  const secondaryActive = filters.specs.length + filters.stack.length + (filters.minPay !== null ? 1 : 0)
    + (filters.maxYoe !== null ? 1 : 0) + (filters.researchedOnly ? 1 : 0);
  const showMore = moreFilters ?? secondaryActive > 0;

  function update(patch: Partial<RoleFilters>) {
    const qs = toSearchParams({ ...filters, ...patch }).toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const levels = useMemo(() => levelsOf(all), [all]);
  const specs = useMemo(() => specializationsOf(all), [all]);
  const stacks = useMemo(() => stackCounts(all), [all]);
  const fitById = useMemo(() => new Map((fit.data?.results ?? []).map((r) => [r.jdId, r])), [fit.data]);
  const scores = useMemo(() => new Map([...fitById].map(([id, r]) => [id, r.score])), [fitById]);
  const matched = useMemo(() => sortRoles(all.filter((j) => matchesFilters(j, filters)), filters.sort, scores), [all, filters, scores]);
  const groups = useMemo(() => (filters.sort === "recommended" ? groupByLevel(matched) : [{ level: "all", label: "Matching roles", jds: matched }]), [matched, filters.sort]);
  const active = activeFilterCount(filters);
  const [searchText, setSearchText] = useState(filters.q);
  const visibleStack = showAllStack ? stacks : stacks.slice(0, STACK_COLLAPSED);

  return (
    <div className={PAGE_SCAFFOLD}>
      <nav aria-label="Breadcrumb">
        <ol className="m-0 flex list-none flex-wrap items-center gap-x-2 p-0 text-[13px] text-faint">
          <li className="flex items-center gap-2">
            <Link href={ROUTES.jobs} className="rounded-sm hover:text-foreground">Companies</Link>
            <span aria-hidden>›</span>
          </li>
          <li aria-current="page" className="text-foreground">{name}</li>
        </ol>
      </nav>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <CompanyTile name={name} live={all.some(isLiveJd)} size="lg" />
        <div className="min-w-0">
          <h1 className="m-0 text-[26px] font-normal leading-[1.1] tracking-[-0.04em] sm:text-[30px]">Roles at {name}</h1>
          <p className="m-0 mt-1.5 text-sm text-muted-foreground">
            {[company?.headquarterLocation, company?.companySize, jds.isSuccess ? plural(all.length, "role") : null].filter(Boolean).join(" · ")}
            <span className="block">Open a role to see its full description and interview flow.</span>
          </p>
        </div>
      </div>

      <form
        role="search"
        className="mt-5 flex flex-wrap items-center gap-2.5"
        onSubmit={(e) => { e.preventDefault(); update({ q: searchText }); }}
      >
        {/* Icon and input share one flex row inside the pill, so the icon can never sit on the text. */}
        <label className="flex h-[42px] min-w-0 flex-[1_1_280px] items-center gap-2.5 rounded-full border border-line-3 bg-card px-3.5 transition-colors focus-within:border-faint">
          <Search aria-hidden className="h-4 w-4 flex-none text-faint" />
          <input
            type="search"
            aria-label="Search roles"
            placeholder="Search by title, technology, level or specialization"
            value={searchText}
            onChange={(e) => { setSearchText(e.target.value); update({ q: e.target.value }); }}
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
          />
        </label>
        <label className="flex flex-none items-center gap-2 text-[13px] text-muted-foreground">
          Sort
          <CustomSelect label="Sort roles" className={select} value={filters.sort} options={SORTS} onValueChange={(value) => { const sort = SORTS.find((item) => item.value === value)?.value; if (sort) update({ sort }); }} />
        </label>
      </form>

      <div className="mt-4 flex flex-col gap-4 rounded-[14px] border border-line-2 p-4 sm:p-5">
        {levels.length > 1 ? (
          <FilterGroup label="Experience level">
            {groupByLevel(all.filter((j) => j.level !== null && levels.includes(j.level))).map((g) => {
              const on = filters.levels.includes(g.level);
              return (
                <button key={g.level} type="button" aria-pressed={on} onClick={() => update({ levels: toggle(filters.levels, g.level) })} className={cn(chip, on ? chipOn : chipOff)}>
                  {levelLabel(g.level)} <span className="opacity-60">{g.jds.length}</span>
                </button>
              );
            })}
          </FilterGroup>
        ) : null}
        <button
          type="button"
          aria-expanded={showMore}
          onClick={() => setMoreFilters(!showMore)}
          className="-mt-1 inline-flex w-fit items-center gap-1.5 rounded-full text-[13px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {showMore ? "Fewer filters" : "More filters"}
          {!showMore && secondaryActive > 0 ? <span className="rounded-full bg-foreground px-1.5 text-[11px] text-background">{secondaryActive}</span> : null}
          <ChevronDown aria-hidden className={cn("h-3.5 w-3.5 transition-transform", showMore && "rotate-180")} />
        </button>
        {showMore && specs.length > 1 ? (
          <FilterGroup label="Specialization">
            {specs.map((s) => {
              const on = filters.specs.some((x) => x.toLowerCase() === s.toLowerCase());
              return (
                <button key={s} type="button" aria-pressed={on} onClick={() => update({ specs: toggle(filters.specs, s) })} className={cn(chip, on ? chipOn : chipOff)}>
                  {specializationLabel(s)}
                </button>
              );
            })}
          </FilterGroup>
        ) : null}
        {showMore && stacks.length > 0 ? (
          <FilterGroup label="Tech stack (role must use all selected)">
            {visibleStack.map(({ tech, count }) => {
              const on = filters.stack.some((x) => x.toLowerCase() === tech.toLowerCase());
              return (
                <button key={tech} type="button" aria-pressed={on} onClick={() => update({ stack: toggle(filters.stack, tech) })} className={cn(chip, "h-7 px-3 text-[12.5px]", on ? chipOn : chipOff)}>
                  {tech} <span className="opacity-60">{count}</span>
                </button>
              );
            })}
            {stacks.length > STACK_COLLAPSED ? (
              <button type="button" onClick={() => setShowAllStack((v) => !v)} className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-[12.5px] text-muted-foreground hover:text-foreground">
                {showAllStack ? "Show less" : `Show all ${stacks.length}`}
                <ChevronDown aria-hidden className={cn("h-3.5 w-3.5 transition-transform", showAllStack && "rotate-180")} />
              </button>
            ) : null}
          </FilterGroup>
        ) : null}
        <div className={cn("flex flex-wrap items-end gap-x-6 gap-y-3", !showMore && active === 0 && "hidden")}>
          <label className={cn("flex flex-col gap-2", !showMore && "hidden")}>
            <span className="iq-eyebrow">Minimum pay</span>
            <CustomSelect label="Minimum pay" className={select} value={filters.minPay === null ? "" : String(filters.minPay)} options={[{ value: "", label: "Any" }, ...PAY_STEPS.map((pay) => ({ value: String(pay), label: `₹${pay}+ LPA` }))]} onValueChange={(value) => update({ minPay: value === "" ? null : Number(value) })} />
          </label>
          <label className={cn("flex flex-col gap-2", !showMore && "hidden")}>
            <span className="iq-eyebrow">Experience asked</span>
            <CustomSelect label="Maximum experience" className={select} value={filters.maxYoe === null ? "" : String(filters.maxYoe)} options={[{ value: "", label: "Any" }, ...YOE_STEPS.map((years) => ({ value: String(years), label: `Up to ${years} ${years === 1 ? "yr" : "yrs"}` }))]} onValueChange={(value) => update({ maxYoe: value === "" ? null : Number(value) })} />
          </label>
          <button type="button" aria-pressed={filters.researchedOnly} onClick={() => update({ researchedOnly: !filters.researchedOnly })} className={cn(chip, filters.researchedOnly ? chipOn : chipOff, !showMore && "hidden")}>
            Researched processes only
          </button>
          {active > 0 ? (
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => { setSearchText(""); update({ ...EMPTY_FILTERS, sort: filters.sort }); }}>
              <X aria-hidden className="h-3.5 w-3.5" /> Clear {plural(active, "filter")}
            </Button>
          ) : null}
        </div>
      </div>

      <p aria-live="polite" className="m-0 mt-4 text-sm text-muted-foreground">
        {jds.isLoading ? "Loading roles…" : `${plural(matched.length, "role")}${active > 0 ? ` of ${all.length}` : ""}`}
      </p>
      {fit.data && fit.data.userLevel === null && all.length > 0 ? (
        <p className="m-0 mt-1 text-[13px] text-faint">
          <Link href={ROUTES.profile} className="rounded-sm underline-offset-[3px] hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
            Set your level
          </Link>{" "}
          for a fairer match score.
        </p>
      ) : null}

      {jds.isLoading ? (
        <div className="mt-3 grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,400px),1fr))]">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[150px] rounded-[14px]" />)}
        </div>
      ) : jds.isError ? (
        <EmptyState className="mt-3" title="Couldn't load roles" hint="Check your connection and try again." action={<Button variant="outline" size="sm" onClick={() => void jds.refetch()}>Try again</Button>} />
      ) : all.length === 0 ? (
        <EmptyState className="mt-3" title="No roles yet" hint="This company has no published roles yet." action={<Button asChild variant="outline" size="sm"><Link href={ROUTES.jobs}>Back to companies</Link></Button>} />
      ) : matched.length === 0 ? (
        <EmptyState className="mt-3" title="No roles match" hint="Try removing a filter or searching for something broader." action={<Button variant="outline" size="sm" onClick={() => { setSearchText(""); update({ ...EMPTY_FILTERS, sort: filters.sort }); }}>Clear filters</Button>} />
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {groups.map((g) => (
            <Panel key={g.level} eyebrow={`${g.label} · ${plural(g.jds.length, "role")}`}>
              <ul className="m-0 grid list-none gap-2.5 p-0 [grid-template-columns:repeat(auto-fill,minmax(min(100%,400px),1fr))]">
                {g.jds.map((jd) => <RoleCard key={jd.id} jd={jd} fit={fitById.get(jd.id) ?? null} fitLoading={fit.isLoading} />)}
              </ul>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
