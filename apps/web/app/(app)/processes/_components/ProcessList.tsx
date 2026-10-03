"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/patterns";
import { HudCard } from "@/components/hud";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfirmLoop, useDeleteProcess, useDuplicateProcess, useLoops, useProcesses } from "@/features/loops";
import { ApiFetchError } from "@/lib/api-client/errors";
import { ROUTES } from "@/lib/constants/shared";
import { JdTitle, loopHref, processHref } from "@/app/(app)/loops/_components/loopUi";

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** Your saved processes: edit, start a track from one, duplicate or delete. */
export function ProcessList({ query, onCreate }: { query: string; onCreate: () => void }) {
  const router = useRouter();
  const processes = useProcesses();
  const loops = useLoops();
  const duplicate = useDuplicateProcess();
  const remove = useDeleteProcess();
  const confirm = useConfirmLoop();

  if (processes.isLoading) return <Skeleton className="h-[220px] rounded-[14px]" />;
  if (processes.isError) return <EmptyState title="Couldn't load your processes" action={<Button variant="outline" size="sm" onClick={() => void processes.refetch()}>Try again</Button>} />;
  const q = query.trim().toLowerCase();
  const all = processes.data ?? [];
  const list = q ? all.filter((p) => [p.name, p.jd?.companyName ?? "", p.jd?.title ?? ""].join(" ").toLowerCase().includes(q)) : all;
  if (all.length === 0) {
    return (
      <EmptyState
        title="No custom processes yet"
        hint="Create one from a role's suggested process or from scratch, then add, remove and connect rounds in the editor. Custom processes are standalone practice and never count towards readiness."
        action={<Button onClick={onCreate}>New process</Button>}
      />
    );
  }
  if (list.length === 0) return <EmptyState title="No processes match" hint={`Nothing matches “${query.trim()}”.`} />;
  const liveByJd = new Map((loops.data ?? []).filter((l) => l.status === "active" || l.status === "paused").map((l) => [l.jdId, l.id]));

  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,420px),1fr))]">
      {list.map((p) => {
        const rounds = p.graph.nodes.filter((n) => n.kind === "round").length;
        const infos = p.graph.nodes.length - rounds;
        const liveLoop = p.jd ? liveByJd.get(p.jd.jdId) : undefined;
        return (
          <HudCard as="article" key={p.id} title={p.name} meta="Standalone" bodyClassName="flex flex-col gap-4 p-4 sm:p-5">
            <JdTitle jd={p.jd} href={p.jd ? `${ROUTES.jobs}/${p.jd.jdId}` : undefined} />
            <p className="m-0 text-xs text-faint">
              {rounds} {rounds === 1 ? "round" : "rounds"}{infos ? ` · ${infos} info ${infos === 1 ? "step" : "steps"}` : ""} · updated {when(p.updatedAt)}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild size="sm" variant="strong"><Link href={processHref(p.id)}><Pencil aria-hidden />Edit</Link></Button>
              {liveLoop ? (
                <Button asChild size="sm" variant="ghost"><Link href={loopHref(liveLoop)}>Active track</Link></Button>
              ) : (
                <Button
                  size="sm"
                  disabled={confirm.isPending || !p.jd}
                  onClick={() => confirm.mutate({ jdId: p.jd!.jdId, processId: p.id }, {
                    onSuccess: (loop) => { toast.success("Track started."); router.push(loopHref(loop.id)); },
                    onError: (err) => toast.error(err instanceof ApiFetchError && err.code === "loop_exists" ? "You already have an active track for this role." : "Couldn't start a track from this process."),
                  })}
                >
                  Start track
                </Button>
              )}
              <Button size="sm" variant="ghost" disabled={duplicate.isPending} onClick={() => duplicate.mutate(p.id, { onError: () => toast.error("Couldn't duplicate this process.") })}>
                <Copy aria-hidden />Duplicate
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm(`Delete “${p.name}”? Tracks already started from it keep their own copy.`)) {
                    remove.mutate(p.id, { onSuccess: () => toast.success("Process deleted."), onError: () => toast.error("Couldn't delete this process.") });
                  }
                }}
              >
                <Trash2 aria-hidden />Delete
              </Button>
            </div>
          </HudCard>
        );
      })}
    </div>
  );
}
