"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PAGE_SCAFFOLD } from "@/components/layout/page";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMySessions } from "@/features/interview";
import { partitionSessions } from "@/features/interview/presentation";
import { useLoops, useProcesses, useTargets } from "@/features/loops";
import { ROUTES } from "@/lib/constants/shared";
import { LoopsTab } from "./LoopsTab";
import { ScheduleTab } from "./ScheduleTab";
import { TargetsTab } from "./TargetsTab";

const TABS = ["tracks", "schedule", "targets"] as const;
type Tab = (typeof TABS)[number];

const tabTrigger =
  "-mb-px rounded-none border-b-[1.5px] border-transparent bg-transparent px-0 pb-3 pt-0 text-sm font-normal text-faint shadow-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-offset-0 data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none";

function Stat({ label, value, href }: { label: string; value: number | string; href?: string }) {
  const body = (
    <>
      <p className="iq-eyebrow m-0">{label}</p>
      <p className="m-0 mt-1 text-[26px] leading-none tracking-[-0.03em] tabular-nums">{value}</p>
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-[14px] border border-line-2 px-4 py-3 transition-colors hover:border-faint-2">{body}</Link>
  ) : (
    <div className="rounded-[14px] border border-line-2 px-4 py-3">{body}</div>
  );
}

/**
 * `/loops` ("My tracks"): the interview tracks you've subscribed to. Tracks (confirmed processes
 * with progress), Schedule (every interview across companies) and Targets (roles you're watching).
 * Custom processes have their own page, /processes.
 */
export function LoopsHub() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const raw = sp.get("tab");
  const tab: Tab = TABS.includes(raw as Tab) ? (raw as Tab) : "tracks";
  const loops = useLoops();
  const processes = useProcesses();
  const targets = useTargets();
  const sessions = useMySessions();

  const live = (loops.data ?? []).filter((l) => l.status === "active" || l.status === "paused").length;
  const upcoming = partitionSessions(sessions.data?.sessions ?? []).upcoming.length;

  return (
    <div className={PAGE_SCAFFOLD}>
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <p className="iq-eyebrow m-0">My tracks</p>
          <h1 className="m-0 mt-1.5 text-[26px] font-normal leading-[1.1] tracking-[-0.04em] sm:text-[30px]">Interview tracks</h1>
          <p className="m-0 mt-1.5 max-w-[640px] text-[14px] leading-[1.5] text-muted-foreground">
            Every role you&apos;ve started a track for, with progress and what to book next. Run several at once, each in its
            own slots, and keep every interview in one schedule.
          </p>
        </div>
        <Button asChild variant="strong" className="h-10 px-4 text-[13.5px]"><Link href={ROUTES.jobs}>Browse companies</Link></Button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="Active tracks" value={loops.isLoading ? "–" : live} />
        <Stat label="Upcoming interviews" value={sessions.isLoading ? "–" : upcoming} />
        <Stat label="Custom processes" value={processes.isLoading ? "–" : (processes.data?.length ?? 0)} href={ROUTES.processes} />
        <Stat label="Watching" value={targets.isLoading ? "–" : (targets.data?.length ?? 0)} />
      </div>

      <Tabs value={tab} onValueChange={(v) => router.replace(v === "tracks" ? pathname : `${pathname}?tab=${v}`, { scroll: false })} className="mt-6">
        <TabsList aria-label="My tracks" className="flex h-auto w-full justify-start gap-6 rounded-none border-b border-line-2 bg-transparent p-0 text-faint">
          <TabsTrigger value="tracks" className={tabTrigger}>Tracks</TabsTrigger>
          <TabsTrigger value="schedule" className={tabTrigger}>Schedule</TabsTrigger>
          <TabsTrigger value="targets" className={tabTrigger}>Targets</TabsTrigger>
        </TabsList>
        <TabsContent value="tracks" className="mt-5"><LoopsTab /></TabsContent>
        <TabsContent value="schedule" className="mt-5"><ScheduleTab /></TabsContent>
        <TabsContent value="targets" className="mt-5"><TargetsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
