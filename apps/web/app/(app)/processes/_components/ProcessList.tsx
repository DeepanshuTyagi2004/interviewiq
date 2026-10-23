"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Pencil } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/patterns";
import { Card, Chip, Orb } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfirmLoop, useDeleteProcess, useDuplicateProcess, useLoops, useProcesses } from "@/features/loops";
import { ApiFetchError } from "@/lib/api-client/errors";
import { ROUTES } from "@/lib/constants/shared";
import { specializationLabel } from "@/app/(app)/jobs/_components/library";
import { loopHref, processHref } from "@/app/(app)/loops/_components/loopUi";
import { levelLabel, normalizeLegacyLevel } from "@/lib/constants/engineering-levels";

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** Your saved processes: edit, start a track from one, duplicate or delete. */
export function ProcessList({ query, onCreate }: { query: string; onCreate: () => void }) {
  const router = useRouter();
  const processes = useProcesses();
  const loops = useLoops();
  const duplicate = useDuplicateProcess();
  const remove = useDeleteProcess();
  const confirm = useConfirmLoop();
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);

  if (processes.isLoading) return <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,400px),1fr))]" aria-busy="true" aria-label="Loading processes">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[200px] rounded-card" />)}</div>;
  if (processes.isError) return <EmptyState title="Couldn't load your processes" action={<Button variant="outline" size="sm" onClick={() => void processes.refetch()}>Try again</Button>} />;
  const q = query.trim().toLowerCase();
  const all = processes.data ?? [];
  const list = q ? all.filter((p) => [p.name, p.level, p.jd?.companyName ?? "", p.jd?.title ?? ""].join(" ").toLowerCase().includes(q)) : all;
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
    <>
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,400px),1fr))]">
        {list.map((p) => {
          const rounds = p.graph.nodes.filter((n) => n.kind === "round").length;
          const infos = p.graph.nodes.length - rounds;
          const liveLoop = p.jd ? liveByJd.get(p.jd.jdId) : undefined;
          const levelOk = Boolean(normalizeLegacyLevel(p.level));
          const sub = [p.jd?.companyName, levelOk ? levelLabel(p.level) : null, p.jd?.practiceTemplate ? "Practice template" : null, p.jd?.specialization ? specializationLabel(p.jd.specialization) : null].filter(Boolean).join(" · ") || "Level not set";
          const startTrack = () =>
            confirm.mutate({ ...(p.jd ? { jdId: p.jd.jdId } : {}), processId: p.id }, {
              onSuccess: (loop) => { toast.success("Track started."); router.push(loopHref(loop.id)); },
              onError: (err) => toast.error(err instanceof ApiFetchError && err.code === "loop_exists" ? "You already have an active track for this role." : "Couldn't start a track from this process."),
            });
          const blocked = confirm.isPending || !levelOk;
          return (
            <Card as="article" key={p.id} aria-label={`${p.name}, ${sub}`} interactive className="gap-4">
              <div className="flex items-start gap-3.5">
                <Orb seed={p.jd?.company ?? p.id} size={44} />
                <div className="min-w-0 flex-1">
                  <Link
                    href={processHref(p.id)}
                    title={p.name}
                    className="block truncate rounded-sm font-display text-[18px] font-normal leading-tight tracking-[-0.02em] outline-none underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    {p.name}
                  </Link>
                  <span className="mt-0.5 block truncate text-[13px] text-ink-3" title={sub}>{sub}</span>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="Process actions" className="-mr-2 -mt-1 flex-none">
                      <MoreHorizontal aria-hidden strokeWidth={1.8} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem asChild><Link href={processHref(p.id)}>Edit</Link></DropdownMenuItem>
                    {liveLoop ? (
                      <DropdownMenuItem asChild><Link href={loopHref(liveLoop)}>Active track</Link></DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem disabled={blocked} onSelect={startTrack}>Start track</DropdownMenuItem>
                    )}
                    <DropdownMenuItem disabled={duplicate.isPending || !levelOk} onSelect={() => duplicate.mutate(p.id, { onError: () => toast.error("Couldn't duplicate this process.") })}>
                      Duplicate
                    </DropdownMenuItem>
                    {p.jd ? <DropdownMenuItem asChild><Link href={`${ROUTES.jobs}/${p.jd.jdId}`}>View role</Link></DropdownMenuItem> : null}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive focus:text-destructive" disabled={remove.isPending} onSelect={() => setDeleting({ id: p.id, name: p.name })}>
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <Chip tone="outline">Standalone</Chip>
                {!levelOk ? <Chip tone="outline" dot="hollow">Level not recognized</Chip> : null}
              </div>

              <p className="m-0 text-[13px] text-ink-3">
                {rounds} {rounds === 1 ? "round" : "rounds"}{infos ? ` · ${infos} info ${infos === 1 ? "step" : "steps"}` : ""} · updated {when(p.updatedAt)}
              </p>
              {!levelOk ? <p className="m-0 text-[12.5px] text-ink-2">Choose a level in Edit before starting or duplicating.</p> : null}

              <div className="mt-auto flex flex-wrap items-center gap-2">
                <Button asChild size="sm" variant="outline"><Link href={processHref(p.id)}><Pencil aria-hidden />Edit</Link></Button>
                {liveLoop ? (
                  <Button asChild size="sm" variant="ghost"><Link href={loopHref(liveLoop)}>Active track</Link></Button>
                ) : (
                  <Button size="sm" disabled={blocked} onClick={startTrack}>Start track</Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
      <ConfirmationDialog open={deleting !== null} onOpenChange={(open) => { if (!open) setDeleting(null); }} title={`Delete “${deleting?.name ?? "process"}”?`} description="Tracks already started from it keep their own copy." confirmLabel="Delete process" destructive pending={remove.isPending} onConfirm={async () => { if (!deleting) return; try { await remove.mutateAsync(deleting.id); toast.success("Process deleted."); } catch { toast.error("Couldn't delete this process."); } }} />
    </>
  );
}
