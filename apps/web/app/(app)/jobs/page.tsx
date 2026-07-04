"use client";

import { useState } from "react";
import Link from "next/link";
import { PageHeader, EmptyState, SectionLabel } from "@/components/patterns";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useJds, useJobCompanies, type DataAvailability, type JdSummary } from "@/features/jobs";

const SPECIALIZATIONS = ["", "general", "backend", "frontend", "fullstack", "ml", "mobile", "platform"];
// Render order for the level-wise grouping.
const LEVEL_ORDER = ["fresher", "sde1", "sde2", "sde3"];
const LEVEL_LABEL: Record<string, string> = {
  fresher: "Fresher", sde1: "SDE-1", sde2: "SDE-2", sde3: "SDE-3",
};

const selectClass =
  "h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const AVAILABILITY: Record<DataAvailability, { label: string; variant: "default" | "secondary" | "outline" }> = {
  rich: { label: "Rich interview data", variant: "default" },
  available: { label: "Data available", variant: "secondary" },
  limited: { label: "Limited data", variant: "outline" },
  none: { label: "No data yet", variant: "outline" },
};

export default function JobsPage() {
  const [company, setCompany] = useState("");
  const [specialization, setSpecialization] = useState("");
  const { data: jds, isLoading, isError } = useJds({
    company: company || undefined,
    specialization: specialization || undefined,
  });
  const { data: companies } = useJobCompanies();

  // Group experience-level-wise.
  const byLevel = new Map<string, JdSummary[]>();
  for (const jd of jds ?? []) {
    (byLevel.get(jd.level) ?? byLevel.set(jd.level, []).get(jd.level)!).push(jd);
  }
  const levels = [...byLevel.keys()].sort(
    (a, b) => (LEVEL_ORDER.indexOf(a) + 1 || 99) - (LEVEL_ORDER.indexOf(b) + 1 || 99),
  );

  return (
    <div className="flex-1 space-y-8 p-6">
      <PageHeader
        title="Job descriptions"
        description="Browse real postings by experience level, pick one, and see the full interview process before you practise."
      />

      <div className="flex flex-wrap gap-3">
        <select aria-label="Company" value={company} onChange={(e) => setCompany(e.target.value)} className={selectClass}>
          <option value="">All companies</option>
          {(companies ?? []).map((c) => (
            <option key={c.slug} value={c.slug}>{c.name}</option>
          ))}
        </select>
        <select
          aria-label="Specialization"
          value={specialization}
          onChange={(e) => setSpecialization(e.target.value)}
          className={selectClass}
        >
          {SPECIALIZATIONS.map((s) => (
            <option key={s} value={s}>{s ? s[0].toUpperCase() + s.slice(1) : "All specializations"}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      ) : isError || !jds ? (
        <p role="alert" className="text-sm text-destructive">Could not load job descriptions.</p>
      ) : jds.length === 0 ? (
        <EmptyState title="No JDs found" hint="Try clearing the filters, or load the starter companies from the Intelligence console." />
      ) : (
        <div className="space-y-8">
          {levels.map((level) => (
            <section key={level} className="space-y-3">
              <SectionLabel>{LEVEL_LABEL[level] ?? level} · {byLevel.get(level)!.length} roles</SectionLabel>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {byLevel.get(level)!.map((jd) => {
                  const avail = AVAILABILITY[jd.dataAvailability] ?? AVAILABILITY.none;
                  return (
                    <Link key={jd.id} href={`/jobs/${jd.id}`} className="group">
                      <Card className="h-full transition-colors group-hover:border-foreground/20">
                        <CardContent className="space-y-3 p-5">
                          <div className="space-y-1">
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              {jd.companyName}
                            </p>
                            <h3 className="text-sm font-semibold tracking-tight">{jd.title}</h3>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {jd.specialization ? <Badge variant="outline">{jd.specialization}</Badge> : null}
                            <Badge variant={avail.variant}>{avail.label}</Badge>
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
