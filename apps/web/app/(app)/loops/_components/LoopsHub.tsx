"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
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
import { ProcessesPanel } from "../../processes/_components/ProcessesPage";

const TABS = ["tracks", "schedule", "targets", "processes"] as const;
type Tab = (typeof TABS)[number];

const FOCUS =
  "outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background";

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
 * and Custom processes (build your own; the editor lives at /processes/:id).
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
  const [creating, setCreating] = useState(false);

  const live = (loops.data ?? []).filter((l) => l.status === "active" || l.status === "paused").length;
  const upcoming = partitionSessions(sessions.data?.sessions ?? []).upcoming.length;
  const processCount = processes.data?.length ?? 0;
  const targetCount = targets.data?.length ?? 0;
  // Four zeros say nothing: the tiles appear once there is something to count.
  const loaded = !loops.isLoading && !sessions.isLoading && !processes.isLoading && !targets.isLoading;
  const empty = loaded && (loops.data ?? []).length === 0 && upcoming === 0 && processCount === 0 && targetCount === 0;

  return (
    <div className="flex min-w-0 flex-col">
      <PageHeader
        eyebrow="My tracks"
        title="Interview tracks"
        description="Every role you've started a track for, with progress and what to book next. Run several at once, each in its own slots, and keep every interview in one schedule."
        actions={
          tab === "processes" ? (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden />New process
            </Button>
          ) : (
            <Button asChild>
              <Link href={ROUTES.jobs}>Browse companies</Link>
            </Button>
          )
        }
      />

      {empty ? null : (
        <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Active tracks" value={loops.isLoading ? "–" : live} />
          <StatTile label="Upcoming interviews" value={sessions.isLoading ? "–" : upcoming} />
          <StatTile label="Custom processes" value={processes.isLoading ? "–" : processCount} href={`${ROUTES.loops}?tab=processes`} />
          <StatTile label="Watching" value={targets.isLoading ? "–" : targetCount} />
        </div>
      )}

      <Tabs
        value={tab}
        onValueChange={(v) => router.replace(v === "tracks" ? pathname : `${pathname}?tab=${v}`, { scroll: false })}
        className="mt-10"
      >
        <TabsList variant="pill" aria-label="My tracks" className="w-full sm:w-auto">
          <TabsTrigger value="tracks" className="flex-1 sm:flex-none">Tracks</TabsTrigger>
          <TabsTrigger value="schedule" className="flex-1 sm:flex-none">Schedule</TabsTrigger>
          <TabsTrigger value="targets" className="flex-1 sm:flex-none">Targets</TabsTrigger>
          <TabsTrigger value="processes" className="flex-1 sm:flex-none">Custom processes</TabsTrigger>
        </TabsList>
        <TabsContent value="tracks" className="mt-5"><LoopsTab /></TabsContent>
        <TabsContent value="schedule" className="mt-5"><ScheduleTab /></TabsContent>
        <TabsContent value="targets" className="mt-5"><TargetsTab /></TabsContent>
        <TabsContent value="processes" className="mt-5">
          <ProcessesPanel creating={creating} onCreatingChange={setCreating} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
