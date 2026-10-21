"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, Loader2, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { JdDetail } from "@/features/jobs";
import { useConfirmLoop, useCreateProcess, useJdLoopStatus, useOfficialProcess, useProcesses, useToggleTarget } from "@/features/loops";
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

/** What you can do with a role's suggested process: start it as a track, duplicate it, or watch the role. */
export function useRoleTrack(jd: JdDetail) {
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

  return { official, status, confirm, create, toggle, mine, loopId, targeted, hasRounds, confirmProcess, duplicate };
}

/** The hero's actions: Open / Start track, Duplicate & customise, Add to targets / Watching. */
export function RoleActions({ jd }: { jd: JdDetail }) {
  const { status, confirm, create, toggle, loopId, targeted, hasRounds, confirmProcess, duplicate } = useRoleTrack(jd);
  return (
    <div className="flex flex-wrap items-center gap-2">
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
      <Button variant="secondary" disabled={!hasRounds || !isEngineeringLevel(jd.level) || create.isPending} onClick={duplicate}>
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
    </div>
  );
}
