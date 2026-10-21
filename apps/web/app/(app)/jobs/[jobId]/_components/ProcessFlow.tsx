"use client";

import Link from "next/link";
import { Card } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { JdDetail } from "@/features/jobs";
import { FlowCanvas } from "@/features/loops/components/FlowCanvas";
import { ROUTES } from "@/lib/constants/shared";
import { isEngineeringLevel } from "@/lib/constants/engineering-levels";
import { useRoleTrack } from "./RoleActions";

/**
 * The role's suggested process as a read-only flow on the dotted canvas, plus the user's own custom
 * processes for it. The actions (start, duplicate, watch) live in the hero. Edited processes are standalone.
 */
export function ProcessFlow({ jd }: { jd: JdDetail }) {
  const { official, confirm, mine, loopId, confirmProcess } = useRoleTrack(jd);

  return (
    <div className="flex flex-col gap-4">
      <Card title="Interview flow" meta="Read only" flush bodyClassName="p-3 sm:p-4">
        {official.isLoading ? (
          <Skeleton className="h-[360px] rounded-2xl" />
        ) : official.isError || !official.data ? (
          <p className="m-0 p-4 text-sm text-destructive">Couldn&apos;t load the flow. Refresh to try again.</p>
        ) : (
          <FlowCanvas graph={official.data} mode="view" />
        )}
        <p className="m-0 mt-3 px-1 pb-1 text-[12.5px] leading-[1.5] text-ink-3">
          Rounds unlock in order as you complete them. Dashed steps are not interviews: they&apos;re shown for information
          and don&apos;t count towards progress.
        </p>
      </Card>

      {mine.length > 0 ? (
        <Card title="Your custom processes for this role" meta={`${mine.length} · standalone practice`} flush>
          <ul className="m-0 flex list-none flex-col p-0 pb-2">
            {mine.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 first:mt-3">
                <div className="min-w-0">
                  <p title={p.name} className="m-0 truncate text-sm">{p.name}</p>
                  <p className="m-0 mt-0.5 text-xs text-ink-3">{p.graph.nodes.filter((n) => n.kind === "round").length} rounds · standalone</p>
                </div>
                <div className="flex gap-2">
                  <Button asChild variant="secondary" size="sm"><Link href={`${ROUTES.processes}/${p.id}`}>Edit</Link></Button>
                  {loopId ? null : <Button size="sm" disabled={confirm.isPending || !isEngineeringLevel(p.level)} onClick={() => confirmProcess(p.id)}>Start track</Button>}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
