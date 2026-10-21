"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Card, PageHeader, Stat } from "@/components/ds";
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

const FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function StatTile({ label, value, href }: { label: string; value: number | string; href?: string }) {
  const tile = (
    <Card tone="surface" interactive={Boolean(href)} className="h-full p-5">
      <Stat label={label} value={value} />
    </Card>
  );
  return href ? (
    <Link href={href} className={`block rounded-card ${FOCUS}`}>
      {tile}
    </Link>
  ) : (
    tile
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
    <div className="flex min-w-0 flex-col">
      <PageHeader
        eyebrow="My tracks"
        title="Interview tracks"
        description="Every role you've started a track for, with progress and what to book next. Run several at once, each in its own slots, and keep every interview in one schedule."
        actions={
          <Button asChild>
            <Link href={ROUTES.jobs}>Browse companies</Link>
          </Button>
        }
      />

      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Active tracks" value={loops.isLoading ? "–" : live} />
        <StatTile label="Upcoming interviews" value={sessions.isLoading ? "–" : upcoming} />
        <StatTile label="Custom processes" value={processes.isLoading ? "–" : (processes.data?.length ?? 0)} href={ROUTES.processes} />
        <StatTile label="Watching" value={targets.isLoading ? "–" : (targets.data?.length ?? 0)} />
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => router.replace(v === "tracks" ? pathname : `${pathname}?tab=${v}`, { scroll: false })}
        className="mt-10"
      >
        <TabsList variant="pill" aria-label="My tracks" className="w-full sm:w-auto">
          <TabsTrigger value="tracks" className="flex-1 sm:flex-none">Tracks</TabsTrigger>
          <TabsTrigger value="schedule" className="flex-1 sm:flex-none">Schedule</TabsTrigger>
          <TabsTrigger value="targets" className="flex-1 sm:flex-none">Targets</TabsTrigger>
        </TabsList>
        <TabsContent value="tracks" className="mt-5"><LoopsTab /></TabsContent>
        <TabsContent value="schedule" className="mt-5"><ScheduleTab /></TabsContent>
        <TabsContent value="targets" className="mt-5"><TargetsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
