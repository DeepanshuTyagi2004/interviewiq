"use client";

import { useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/patterns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useJds, useJobCompanies } from "@/features/jobs";
import { cn } from "@/lib/utils/cn";
import { CompanyCard } from "./CompanyCard";
import {
  buildCompanyEntries,
  filterLibrary,
  groupByLevel,
  specializationsOf,
  type StatusFilter,
} from "./library";
import { RoleList } from "./RoleList";
import { PAGE_SCAFFOLD } from "@/components/layout/page";

const STATUS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "live", label: "Live" },
  { value: "researching", label: "Researching" },
];

const grid =
  "grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr))]";

function StatusSegments({
  value,
  onChange,
}: {
  value: StatusFilter;
  onChange: (v: StatusFilter) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Research status"
      className="flex flex-none gap-0.5 rounded-full border border-line-3 p-[3px]"
    >
      {STATUS.map((s) => (
        <button
          key={s.value}
          type="button"
          aria-pressed={value === s.value}
          onClick={() => onChange(s.value)}
          className={cn(
            "rounded-full px-3.5 py-2 text-[13px] leading-none transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            value === s.value
              ? "bg-primary text-primary-foreground"
              : "text-foreground hover:bg-accent",
          )}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

function LibrarySkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading companies"
      className="mt-5 flex flex-col gap-12"
    >
      <div className={grid}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[200px] rounded-[14px]" />
        ))}
      </div>
      <Skeleton className="h-40 rounded-[14px]" />
    </div>
  );
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

export interface CompanyLibraryProps {
  /** Company slug to narrow the role list to on arrival (`/jobs?company=meesho`). */
  initialCompany?: string | null;
}

/** `/jobs`: search + status filter, the company grid, then every role grouped by level. */
export function CompanyLibrary({ initialCompany = null }: CompanyLibraryProps) {
  const companies = useJobCompanies();
  const jds = useJds();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [company, setCompany] = useState<string | null>(initialCompany);
  const [specialization, setSpecialization] = useState<string | null>(null);
  const rolesHeading = useRef<HTMLHeadingElement>(null);

  const entries = useMemo(
    () => buildCompanyEntries(companies.data, jds.data),
    [companies.data, jds.data],
  );
  const matches = useMemo(
    () => filterLibrary(entries, { query, status }),
    [entries, query, status],
  );

  const selected = company
    ? (entries.find((e) => e.slug === company) ?? null)
    : null;
  const visibleRoles = matches
    .filter((m) => !selected || m.entry.slug === selected.slug)
    .flatMap((m) => m.jds);
  const specializations = specializationsOf(visibleRoles);
  const activeSpec =
    specialization && specializations.includes(specialization)
      ? specialization
      : null;
  const groups = groupByLevel(
    activeSpec
      ? visibleRoles.filter((jd) => jd.specialization === activeSpec)
      : visibleRoles,
  );

  function showRoles(slug: string) {
    setCompany(slug);
    setSpecialization(null);
    requestAnimationFrame(() => {
      const heading = rolesHeading.current;
      if (!heading) return;
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "start",
      });
    });
  }

  function clearFilters() {
    setQuery("");
    setStatus("all");
    setCompany(null);
    setSpecialization(null);
  }

  const isLoading = jds.isLoading || companies.isLoading;
  // Search and filters only earn their place once there's a catalogue to narrow.
  const showControls = isLoading || (!jds.isError && entries.length > 0);

  return (
    <div className={PAGE_SCAFFOLD}>
      <div className="min-w-0">
        <p className="iq-eyebrow m-0">Company library</p>
        <h1 className="m-0 mt-1.5 text-[26px] font-normal leading-[1.1] tracking-[-0.04em] sm:text-[30px]">
          Companies
        </h1>
        <p className="m-0 mt-1.5 max-w-[560px] text-[14px] leading-[1.5] text-muted-foreground">
          Real interview processes, researched from experiences candidates
          share. Each page is honest about how much data is behind it.
        </p>
      </div>

      {showControls ? (
        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search companies or roles"
            aria-label="Search companies or roles"
            className="h-[42px] min-w-0 flex-[1_1_280px] border-line-3 px-3.5 text-sm md:text-sm"
          />
          <StatusSegments value={status} onChange={setStatus} />
        </div>
      ) : null}

      {isLoading ? (
        <LibrarySkeleton />
      ) : jds.isError ? (
        <div
          role="alert"
          className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-line-2 px-5 py-4"
        >
          <p className="m-0 text-sm text-destructive">
            Couldn&apos;t load the company library.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void jds.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          className="mt-5"
          title="No companies yet"
          hint="Companies appear here once their interview processes are being researched. Check back soon."
        />
      ) : matches.length === 0 ? (
        <EmptyState
          className="mt-5"
          title="No companies match"
          hint={
            query.trim()
              ? `Nothing matches “${query.trim()}” with this filter.`
              : "No companies have this status yet."
          }
          action={
            <Button variant="outline" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <>
          <div className={cn(grid, "mt-5")}>
            {matches.map((m) => (
              <CompanyCard
                key={m.entry.slug}
                entry={m.entry}
                onShowRoles={showRoles}
              />
            ))}
          </div>

          <RoleList
            ref={rolesHeading}
            groups={groups}
            company={
              selected ? { slug: selected.slug, name: selected.name } : null
            }
            onClearCompany={() => setCompany(null)}
            specializations={specializations}
            specialization={activeSpec}
            onSpecialization={setSpecialization}
          />
        </>
      )}
    </div>
  );
}
