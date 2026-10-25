"use client";

import Link from "next/link";
import { EmptyState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useBreadcrumbNames } from "@/components/layout/app-shell/Breadcrumbs";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useJd, useJdFit, useJobCompanies } from "@/features/jobs";
import { ApiFetchError } from "@/lib/api-client/errors";
import { ROUTES } from "@/lib/constants/shared";
import { cn } from "@/lib/utils/cn";
import { InsightsTab } from "./InsightsTab";
import { MatchTab } from "./MatchTab";
import { ProcessTab } from "./ProcessTab";
import { RoadmapHeader } from "./RoadmapHeader";
import { useHasFitEvidence } from "@/app/(app)/jobs/_components/fitEvidence";
import { hasPublishedDetails, PublishedDetails } from "./PublishedDetails";

function RoadmapSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading roadmap">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <Skeleton className="h-[104px] w-full flex-none rounded-[14px] sm:w-[176px]" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-10 w-full max-w-lg" />
          <Skeleton className="h-4 w-2/3 max-w-sm" />
        </div>
      </div>
      <Skeleton className="mt-6 h-10 w-72 max-w-full rounded-full" />
      <Skeleton className="mt-8 h-10 w-full max-w-md" />
      <div className="mt-6 flex flex-col gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[108px] rounded-card" />
        ))}
      </div>
    </div>
  );
}

/** `/jobs/[jobId]`: one JD's suggested interview process (Process), what the brief says (Insights) and the user's match (Your match). */
export function Roadmap({ jdId }: { jdId: string }) {
  const jd = useJd(jdId);
  useBreadcrumbNames({ company: jd.data?.companyName, companySlug: jd.data?.company, role: jd.data?.title });
  const fit = useJdFit(jdId);
  const hasFitEvidence = useHasFitEvidence();
  const companies = useJobCompanies();

  if (jd.isLoading) {
    return (
      <RoadmapSkeleton />
    );
  }

  if (jd.isError || !jd.data) {
    const missing = jd.error instanceof ApiFetchError && (jd.error.status === 404 || jd.error.status === 400);
    return missing ? (
      <EmptyState title="This role isn't in the library" hint="It may have been removed, or the link is wrong. Pick a role from the company library instead.">
        <Button asChild size="sm">
          <Link href={ROUTES.jobs}>Browse companies</Link>
        </Button>
      </EmptyState>
    ) : (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-surface px-5 py-4 shadow-ring">
        <p className="m-0 text-sm text-destructive">Couldn&apos;t load this role.</p>
        <Button variant="outline" size="sm" onClick={() => void jd.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const data = jd.data;
  const headquarters = companies.data?.find((c) => c.slug === data.company)?.headquarterLocation;

  return (
    <div>
      {/* The top bar already shows "Companies / {company} / {role}" (set through useBreadcrumbNames above). */}
      <RoadmapHeader jd={data} headquarters={headquarters} fit={hasFitEvidence ? (fit.data ?? null) : null} noFitEvidence={!hasFitEvidence} />

      {/* About and Role details sit in a right column from 1280px and stack below the tabs under that. */}
      <div className={cn("mt-9 grid items-start gap-x-10 gap-y-10", hasPublishedDetails(data) && "xl:grid-cols-[minmax(0,1fr)_340px]")}>
        <Tabs defaultValue="process" className="min-w-0">
          <TabsList variant="underline" aria-label="Roadmap" className="sticky top-[60px] z-10 flex w-full justify-start gap-2 bg-background">
            <TabsTrigger value="process">Process</TabsTrigger>
            <TabsTrigger value="insights">Insights</TabsTrigger>
            <TabsTrigger value="match">Your match</TabsTrigger>
          </TabsList>
          <TabsContent value="process" className="mt-6">
            <ProcessTab jd={data} />
          </TabsContent>
          <TabsContent value="insights" className="mt-6">
            <InsightsTab jd={data} />
          </TabsContent>
          <TabsContent value="match" className="mt-6">
            <MatchTab fit={fit.data} isLoading={fit.isLoading} isError={fit.isError} onRetry={() => void fit.refetch()} />
          </TabsContent>
        </Tabs>
        <PublishedDetails jd={data} />
      </div>
    </div>
  );
}
