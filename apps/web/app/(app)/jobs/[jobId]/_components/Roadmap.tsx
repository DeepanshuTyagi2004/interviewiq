"use client";

import Link from "next/link";
import { EmptyState } from "@/components/patterns";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useJd, useJobCompanies } from "@/features/jobs";
import { ApiFetchError } from "@/lib/api-client/errors";
import { ROUTES } from "@/lib/constants/shared";
import { InsightsTab } from "./InsightsTab";
import { ProcessTab } from "./ProcessTab";
import { RoadmapHeader } from "./RoadmapHeader";
import { PAGE_SCAFFOLD } from "@/components/layout/page";

const page = PAGE_SCAFFOLD;

/** shadcn Tabs restyled to the design's underline tabs. */
const tabTrigger =
  "-mb-px rounded-none border-b-[1.5px] border-transparent bg-transparent px-0 pb-3 pt-0 text-sm font-normal text-faint shadow-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-offset-0 data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none";

function RoadmapSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading roadmap">
      <Skeleton className="h-4 w-60 max-w-full" />
      <div className="mt-5 flex items-center gap-4">
        <Skeleton className="h-12 w-12 flex-none rounded-[10px] sm:h-14 sm:w-14" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-8 w-full max-w-md" />
          <Skeleton className="h-4 w-2/3 max-w-sm" />
        </div>
      </div>
      <Skeleton className="mt-5 h-7 w-40" />
      <div className="mt-5 flex flex-col gap-2.5">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[108px] rounded-[10px]" />
        ))}
      </div>
    </div>
  );
}

/** `/jobs/[jobId]`: one JD's suggested interview process (Process) and what the brief says (Insights). */
export function Roadmap({ jdId }: { jdId: string }) {
  const jd = useJd(jdId);
  const companies = useJobCompanies();

  if (jd.isLoading) {
    return (
      <div className={page}>
        <RoadmapSkeleton />
      </div>
    );
  }

  if (jd.isError || !jd.data) {
    const missing = jd.error instanceof ApiFetchError && (jd.error.status === 404 || jd.error.status === 400);
    return (
      <div className={page}>
        {missing ? (
          <EmptyState
            title="This role isn't in the library"
            hint="It may have been removed, or the link is wrong. Pick a role from the company library instead."
            action={
              <Button asChild variant="strong" size="sm">
                <Link href={ROUTES.jobs}>Browse companies</Link>
              </Button>
            }
          />
        ) : (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-line-2 px-5 py-4">
            <p className="m-0 text-sm text-destructive">Couldn&apos;t load this role.</p>
            <Button variant="outline" size="sm" onClick={() => void jd.refetch()}>
              Try again
            </Button>
          </div>
        )}
      </div>
    );
  }

  const data = jd.data;
  const headquarters = companies.data?.find((c) => c.slug === data.company)?.headquarterLocation;

  return (
    <div className={page}>
      <RoadmapHeader jd={data} headquarters={headquarters} />

      <Tabs defaultValue="process" className="mt-5">
        <TabsList
          aria-label="Roadmap"
          className="flex h-auto w-full justify-start gap-6 rounded-none border-b border-line-2 bg-transparent p-0 text-faint"
        >
          <TabsTrigger value="process" className={tabTrigger}>
            Process
          </TabsTrigger>
          <TabsTrigger value="insights" className={tabTrigger}>
            Insights
          </TabsTrigger>
        </TabsList>
        <TabsContent value="process" className="mt-5">
          <ProcessTab jd={data} />
        </TabsContent>
        <TabsContent value="insights" className="mt-5">
          <InsightsTab jd={data} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
