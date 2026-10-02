"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { MonoPill } from "@/components/patterns";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils/cn";
import { useJds, useJobCompanies, type JdSummary } from "@/features/jobs";

/** A company is "live" once at least one of its roles has researched interview data. */
function isLive(jds: JdSummary[]): boolean {
  return jds.some((jd) => jd.dataAvailability === "rich" || jd.dataAvailability === "available");
}

const LEVEL_LABEL: Record<string, string> = { fresher: "Fresher", sde1: "SDE I", sde2: "SDE II", sde3: "SDE III" };

export function targetLabel(jd: JdSummary): string {
  return `${jd.companyName} · ${jd.title}`;
}

export interface TargetPickerProps {
  /** The chosen JD's id (stored on the profile as `targetJdId`), or null. */
  valueId: string | null;
  onChange: (jd: JdSummary | null) => void;
}

/**
 * Onboarding's optional last step: search the real company catalogue, pick a company, then one of
 * its roles. Companies still being researched are listed but can't be picked yet.
 */
export function TargetPicker({ valueId, onChange }: TargetPickerProps) {
  const companies = useJobCompanies();
  const jds = useJds();
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const value = valueId ? (jds.data ?? []).find((jd) => jd.id === valueId) ?? null : null;

  const jdsByCompany = useMemo(() => {
    const map = new Map<string, JdSummary[]>();
    for (const jd of jds.data ?? []) map.set(jd.company, [...(map.get(jd.company) ?? []), jd]);
    return map;
  }, [jds.data]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (companies.data ?? [])
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.slug.includes(q))
      .map((c) => {
        const roles = jdsByCompany.get(c.slug) ?? [];
        return { ...c, roles, live: isLive(roles) };
      })
      .sort((a, b) => Number(b.live) - Number(a.live) || b.roles.length - a.roles.length);
  }, [companies.data, jdsByCompany, search]);

  // Default to the chosen JD's company, else the first live one, so the role list isn't empty.
  const selectedSlug = picked ?? value?.company ?? rows.find((r) => r.live)?.slug ?? null;
  const selected = rows.find((r) => r.slug === selectedSlug) ?? null;

  if (companies.isLoading || jds.isLoading) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading companies">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    );
  }

  if (companies.isError || jds.isError) {
    return (
      <p role="alert" className="m-0 text-sm text-destructive">
        Couldn&apos;t load companies. You can skip this and pick a role later from Companies.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search companies"
        aria-label="Search companies"
        className="h-11 text-[14.5px]"
      />

      <div role="group" aria-label="Company" className="flex max-h-[320px] flex-col overflow-y-auto rounded-lg border border-line-2">
        {rows.length === 0 ? (
          <p className="m-0 px-4 py-6 text-sm text-muted-foreground">No companies match “{search}”.</p>
        ) : (
          rows.map((c) => {
            const isSelected = c.slug === selectedSlug;
            return (
              <button
                key={c.slug}
                type="button"
                aria-pressed={isSelected}
                disabled={c.roles.length === 0}
                onClick={() => {
                  setPicked(c.slug);
                  if (value && value.company !== c.slug) onChange(null);
                }}
                className={cn(
                  "flex items-center gap-3.5 border-b border-line px-4 py-3 text-left transition-colors last:border-b-0 focus-visible:bg-accent focus-visible:outline-none disabled:cursor-not-allowed",
                  isSelected ? "bg-panel" : "bg-card hover:bg-accent",
                )}
              >
                <span
                  aria-hidden
                  className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[7px] border border-line-3 text-sm font-semibold"
                >
                  {c.name.charAt(0)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-[14.5px]", c.live ? "text-foreground" : "text-muted-foreground")}>
                    {c.name}
                  </span>
                  <span className="block truncate text-xs text-faint">
                    {c.roles.length === 0
                      ? "Researching · no roles yet"
                      : `${c.roles.length} ${c.roles.length === 1 ? "role" : "roles"}${c.live ? " · official processes" : " · limited data so far"}`}
                  </span>
                </span>
                <MonoPill tone={c.live ? "brand" : "soft"}>{c.live ? "LIVE" : "RESEARCHING"}</MonoPill>
              </button>
            );
          })
        )}
      </div>

      {selected && selected.roles.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-[13px] text-muted-foreground">Role at {selected.name}</p>
          <div role="group" aria-label={`Role at ${selected.name}`} className="flex flex-wrap gap-2">
            {selected.roles.map((jd) => {
              const isSelected = value?.id === jd.id;
              return (
                <button
                  key={jd.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => onChange(isSelected ? null : jd)}
                  className={cn(
                    "rounded-md border px-3.5 py-2.5 text-left text-[13.5px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    isSelected
                      ? "border-foreground bg-primary text-primary-foreground"
                      : "border-line-3 bg-card text-foreground hover:border-foreground",
                  )}
                >
                  <span className="block">{jd.title}</span>
                  <span className="mt-0.5 block text-[11.5px] opacity-65">
                    {[LEVEL_LABEL[jd.level] ?? jd.level, jd.specialization].filter(Boolean).join(" · ")}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
