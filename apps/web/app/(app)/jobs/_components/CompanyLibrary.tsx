"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useJds, useJobCompanies } from "@/features/jobs";
import { ROUTES } from "@/lib/constants/shared";
import { cn } from "@/lib/utils/cn";
import { CompanyCard } from "./CompanyCard";
import {
  buildCompanyEntries,
  filterLibrary,
  type StatusFilter,
} from "./library";

const STATUS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "live", label: "Live" },
  { value: "researching", label: "Researching" },
];

const grid = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

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
      className="flex flex-none gap-0.5 rounded-full bg-surface-2 p-1"
    >
      {STATUS.map((s) => (
        <button
          key={s.value}
          type="button"
          aria-pressed={value === s.value}
          onClick={() => onChange(s.value)}
          className={cn(
            "h-8 rounded-full px-3.5 text-[13px] font-medium leading-none transition-colors duration-150 ease-iq focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            value === s.value
              ? "bg-background text-foreground shadow-ring"
              : "text-ink-2 hover:text-foreground",
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
      className={cn(grid, "mt-8")}
    >
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <Skeleton key={i} className="h-[176px] rounded-card" />
      ))}
    </div>
  );
}

/** `/jobs`: search + status filter and the company grid. A card opens that company's roles page. */
export function CompanyLibrary() {
  const router = useRouter();
  const companies = useJobCompanies();
  const jds = useJds();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const entries = useMemo(
    () => buildCompanyEntries(companies.data, jds.data),
    [companies.data, jds.data],
  );
  const matches = useMemo(
    () => filterLibrary(entries, { query, status }),
    [entries, query, status],
  );

  function showRoles(slug: string) {
    router.push(`${ROUTES.jobs}/c/${encodeURIComponent(slug)}`);
  }

  function clearFilters() {
    setQuery("");
    setStatus("all");
  }

  const isLoading = jds.isLoading || companies.isLoading;
  // Search and filters only earn their place once there's a catalogue to narrow.
  const showControls = isLoading || (!jds.isError && entries.length > 0);

  return (
    <div>
      <PageHeader
        title="Companies"
        description="Real interview processes, researched from experiences candidates share. Each page is honest about how much data is behind it."
      />

      {showControls ? (
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-[1_1_260px] sm:max-w-[420px]">
            <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search companies or roles"
              aria-label="Search companies or roles"
              className="h-11 pl-10 pr-4 text-sm md:text-sm"
            />
          </div>
          <StatusSegments value={status} onChange={setStatus} />
        </div>
      ) : null}

      {isLoading ? (
        <LibrarySkeleton />
      ) : jds.isError ? (
        <div
          role="alert"
          className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-card bg-surface px-5 py-4 shadow-ring"
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
          className="mt-6"
          title="No companies yet"
          hint="Companies appear here once their interview processes are being researched. Check back soon."
        />
      ) : matches.length === 0 ? (
        <EmptyState
          className="mt-6"
          title="No companies match"
          hint={
            query.trim()
              ? `Nothing matches “${query.trim()}” with this filter.`
              : "No companies have this status yet."
          }
        >
          <Button variant="outline" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        </EmptyState>
      ) : (
        <>
          <div className={cn(grid, "mt-8")}>
            {matches.map((m) => (
              <CompanyCard
                key={m.entry.slug}
                entry={m.entry}
                onShowRoles={showRoles}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
