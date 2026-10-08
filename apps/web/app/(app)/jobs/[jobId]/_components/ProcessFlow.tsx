"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, Loader2, Star } from "lucide-react";
import { toast } from "sonner";
import { HudCard } from "@/components/hud";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { JdDetail } from "@/features/jobs";
import { useConfirmLoop, useCreateProcess, useJdLoopStatus, useOfficialProcess, useProcesses, useToggleTarget } from "@/features/loops";
import { FlowCanvas } from "@/features/loops/components/FlowCanvas";
import { ApiFetchError } from "@/lib/api-client/errors";
import { ROUTES } from "@/lib/constants/shared";
import { isEngineeringLevel } from "@/lib/constants/engineering-levels";

function errorText(err: unknown, fallback: string): string {
  if (err instanceof ApiFetchError) {
    if (err.code === "loop_exists") return "You already have an active track for this role.";
    if (err.code === "process_limit") return err.message;
    if (err.code === "no_official_process") return err.message;
  }
  return fallback;
}

/**
 * The role's suggested process as a read-only flow, with what you can do next: start it as a track,
 * duplicate it into a process you can edit, or watch the role. Edited processes are standalone.
 */
export function ProcessFlow({ jd }: { jd: JdDetail }) {
  const router = useRouter();
  const official = useOfficialProcess(jd.id);
  const status = useJdLoopStatus(jd.id);
  const processes = useProcesses();
  const confirm = useConfirmLoop();
  const create = useCreateProcess();
  const toggle = useToggleTarget();

  const mine = (processes.data ?? []).filter((p) => p.jd?.jdId === jd.id);
  const loopId = status.data?.loopId ?? null;
  const targeted = status.data?.targeted ?? false;
  const hasRounds = official.data?.nodes.some((n) => n.kind === "round") ?? false;

  function confirmProcess(processId?: string) {
    if (processId ? !isEngineeringLevel(mine.find((process) => process.id === processId)?.level) : !isEngineeringLevel(jd.level)) return;
    confirm.mutate(
      { jdId: jd.id, processId: processId ?? null },
      {
        onSuccess: (loop) => { toast.success("Track started. Book your first round from here."); router.push(`${ROUTES.loops}/${loop.id}`); },
        onError: (err) => toast.error(errorText(err, "Couldn't confirm this process. Please try again.")),
      },
    );
  }

  function duplicate() {
    if (!isEngineeringLevel(jd.level)) return;
    create.mutate(
      { jdId: jd.id, name: `${jd.companyName} · ${jd.title} (custom)`.slice(0, 120), level: jd.level, graph: official.data },
      {
        onSuccess: (p) => router.push(`${ROUTES.processes}/${p.id}`),
        onError: (err) => toast.error(errorText(err, "Couldn't duplicate the process. Please try again.")),
      },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <HudCard title="Interview flow" meta="Read only" bodyClassName="p-3 sm:p-4">
        {official.isLoading ? (
          <Skeleton className="h-[360px] rounded-xl" />
        ) : official.isError || !official.data ? (
          <p className="m-0 p-4 text-sm text-destructive">Couldn&apos;t load the flow. Refresh to try again.</p>
        ) : (
          <FlowCanvas graph={official.data} mode="view" className="h-[380px]" />
        )}
        <p className="m-0 mt-3 px-1 text-[12.5px] leading-[1.5] text-muted-foreground">
          Rounds unlock in order as you complete them. Dashed steps are not interviews: they&apos;re shown for information
          and don&apos;t count towards progress.
        </p>
      </HudCard>

      <HudCard title="What next" bodyClassName="flex flex-wrap items-center gap-2.5 p-4 sm:p-5">
        {loopId ? (
          <Button asChild>
            <Link href={`${ROUTES.loops}/${loopId}`}>Open your track</Link>
          </Button>
        ) : (
          <Button disabled={!hasRounds || !isEngineeringLevel(jd.level) || confirm.isPending} onClick={() => confirmProcess()}>
            {confirm.isPending ? <Loader2 aria-hidden className="animate-spin" /> : null}
            {jd.practiceTemplate ? "Start practice track" : "Start suggested track"}
          </Button>
        )}
        <Button variant="strong" disabled={!hasRounds || !isEngineeringLevel(jd.level) || create.isPending} onClick={duplicate}>
          {create.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <Copy aria-hidden />}
          Duplicate &amp; customise
        </Button>
        <Button
          variant="ghost"
          disabled={toggle.isPending || status.isLoading}
          aria-pressed={targeted}
          onClick={() => toggle.mutate({ jdId: jd.id, targeted }, { onError: () => toast.error("Couldn't update your targets.") })}
        >
          <Star aria-hidden className={targeted ? "fill-current" : undefined} />
          {targeted ? "Watching" : "Add to targets"}
        </Button>
        <p className="m-0 basis-full text-[12.5px] leading-[1.5] text-muted-foreground">
          {jd.practiceTemplate ? "This simulated practice template is not company-official and never counts towards readiness." : "Starting the unedited suggested process counts towards readiness for this role. A customised process is standalone practice: fully analysed, but not counted."}
        </p>
      </HudCard>

      {mine.length > 0 ? (
        <HudCard title="Your custom processes for this role" meta={String(mine.length)} bodyClassName="flex flex-col divide-y divide-line-2">
          {mine.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <p className="m-0 truncate text-sm">{p.name}</p>
                <p className="m-0 mt-0.5 text-xs text-faint">{p.graph.nodes.filter((n) => n.kind === "round").length} rounds · standalone</p>
              </div>
              <div className="flex gap-2">
                <Button asChild variant="strong" size="sm"><Link href={`${ROUTES.processes}/${p.id}`}>Edit</Link></Button>
                {loopId ? null : <Button size="sm" disabled={confirm.isPending || !isEngineeringLevel(p.level)} onClick={() => confirmProcess(p.id)}>Start track</Button>}
              </div>
            </div>
          ))}
        </HudCard>
      ) : null}
    </div>
  );
}
