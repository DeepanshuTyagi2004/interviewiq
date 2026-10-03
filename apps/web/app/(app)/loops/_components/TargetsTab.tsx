"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/patterns";
import { HudCard } from "@/components/hud";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfirmLoop, useLoops, useTargets, useToggleTarget } from "@/features/loops";
import { ApiFetchError } from "@/lib/api-client/errors";
import { ROUTES } from "@/lib/constants/shared";
import { JdTitle, loopHref } from "./loopUi";

export function TargetsTab() {
  const router = useRouter();
  const targets = useTargets();
  const loops = useLoops();
  const toggle = useToggleTarget();
  const confirm = useConfirmLoop();

  if (targets.isLoading) return <Skeleton className="h-[200px] rounded-[14px]" />;
  if (targets.isError) return <EmptyState title="Couldn't load your targets" action={<Button variant="outline" size="sm" onClick={() => void targets.refetch()}>Try again</Button>} />;
  const list = targets.data ?? [];
  if (list.length === 0) {
    return (
      <EmptyState
        title="Nothing on your watchlist"
        hint="Use “Add to targets” on a role to keep it here while you decide. Starting a track for it moves it out of the list."
        action={<Button asChild><Link href={ROUTES.jobs}>Browse companies</Link></Button>}
      />
    );
  }
  const liveByJd = new Map((loops.data ?? []).filter((l) => l.status === "active" || l.status === "paused").map((l) => [l.jdId, l.id]));

  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,420px),1fr))]">
      {list.map((t) => {
        const liveLoop = liveByJd.get(t.jd.jdId);
        return (
          <HudCard as="article" key={t.jd.jdId} title="Target" bodyClassName="flex flex-col gap-4 p-4 sm:p-5">
            <JdTitle jd={t.jd} href={`${ROUTES.jobs}/${t.jd.jdId}`} />
            {t.jd.techStack.length > 0 ? <p className="m-0 text-xs text-muted-foreground">{t.jd.techStack.slice(0, 6).join(" · ")}</p> : null}
            <div className="flex flex-wrap items-center gap-2">
              {liveLoop ? (
                <Button asChild size="sm"><Link href={loopHref(liveLoop)}>Open track</Link></Button>
              ) : (
                <Button
                  size="sm"
                  disabled={confirm.isPending}
                  onClick={() => confirm.mutate({ jdId: t.jd.jdId }, {
                    onSuccess: (loop) => { toast.success("Track started."); router.push(loopHref(loop.id)); },
                    onError: (err) => toast.error(err instanceof ApiFetchError && err.code === "no_official_process" ? err.message : "Couldn't start this track."),
                  })}
                >
                  Start track
                </Button>
              )}
              <Button asChild size="sm" variant="strong"><Link href={`${ROUTES.jobs}/${t.jd.jdId}`}>View role</Link></Button>
              <Button size="sm" variant="ghost" disabled={toggle.isPending} onClick={() => toggle.mutate({ jdId: t.jd.jdId, targeted: true })}>
                <Trash2 aria-hidden />Remove
              </Button>
            </div>
          </HudCard>
        );
      })}
    </div>
  );
}
