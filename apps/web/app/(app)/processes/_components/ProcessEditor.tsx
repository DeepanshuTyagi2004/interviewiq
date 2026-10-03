"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Info, Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { HudZoomOff } from "@/components/hud";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  graphProblems, isRound, newInfoNode, newRoundNode, roundNodesOf, ROUND_PRESETS,
  useConfirmLoop, useOfficialProcess, useProcess, useUpdateProcess,
  type ProcessGraph, type ProcessNode, type RoundNode,
} from "@/features/loops";
import { FlowCanvas, PALETTE_MIME } from "@/features/loops/components/FlowCanvas";
import type { RoundType } from "@/features/interview";
import { ApiFetchError } from "@/lib/api-client/errors";
import { ROUND_OPTIONS } from "@/lib/constants/interview";
import { ROUTES } from "@/lib/constants/shared";
import { cn } from "@/lib/utils/cn";

const field = "h-9 w-full rounded-lg border border-line-4 bg-card px-3 text-[13px] outline-none transition-colors hover:border-faint-2 focus-visible:ring-1 focus-visible:ring-ring";

function Label({ children }: { children: React.ReactNode }) {
  return <span className="iq-eyebrow">{children}</span>;
}

/** Where the next palette node goes: right of the rightmost node, on the main row. */
function nextPosition(g: ProcessGraph): { x: number; y: number } {
  const rounds = roundNodesOf(g);
  if (rounds.length === 0) return { x: 0, y: 0 };
  return { x: Math.max(...rounds.map((r) => r.position.x)) + 280, y: 0 };
}

function Inspector({ node, onPatch, onDelete }: { node: ProcessNode; onPatch: (patch: Partial<RoundNode> & { note?: string; name?: string }) => void; onDelete: () => void }) {
  const types = ROUND_OPTIONS;
  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <Label>Name</Label>
        <input aria-label="Node name" className={field} value={node.name} maxLength={120} onChange={(e) => onPatch({ name: e.target.value })} />
      </label>
      {isRound(node) ? (
        <>
          <label className="flex flex-col gap-1.5">
            <Label>Round type</Label>
            <select aria-label="Round type" className={field} value={node.type} onChange={(e) => onPatch({ type: e.target.value as RoundType })}>
              {types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <Label>Minutes</Label>
              <input aria-label="Duration in minutes" type="number" min={5} max={240} className={field} value={node.durationMinutes}
                onChange={(e) => onPatch({ durationMinutes: Math.min(240, Math.max(5, Math.round(Number(e.target.value) || 5))) })} />
            </label>
            <label className="flex flex-col gap-1.5">
              <Label>Difficulty</Label>
              <select aria-label="Difficulty" className={field} value={node.difficulty} onChange={(e) => onPatch({ difficulty: e.target.value as RoundNode["difficulty"] })}>
                <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1.5">
            <Label>Topics (comma separated)</Label>
            <textarea
              aria-label="Topics"
              rows={3}
              className={cn(field, "h-auto resize-none py-2")}
              defaultValue={node.topics.join(", ")}
              key={node.id}
              onChange={(e) => onPatch({ topics: e.target.value.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 20) })}
            />
          </label>
        </>
      ) : (
        <label className="flex flex-col gap-1.5">
          <Label>Note</Label>
          <textarea aria-label="Note" rows={4} maxLength={1000} className={cn(field, "h-auto resize-none py-2")} value={node.note} onChange={(e) => onPatch({ note: e.target.value })} />
          <span className="text-xs text-faint">Info steps are shown for reference. They can&apos;t be connected and never count.</span>
        </label>
      )}
      <Button variant="ghost" size="sm" className="self-start text-destructive hover:text-destructive" onClick={onDelete}>
        <Trash2 aria-hidden />Delete {isRound(node) ? "round" : "step"}
      </Button>
    </div>
  );
}

/**
 * `/processes/[id]`: the full-screen process editor. Add nodes from the preset palette
 * (click or drag), join rounds into an order, tune each round, and save. A round unlocks once every
 * round leading into it is completed; info steps are display-only. The server re-validates on save.
 */
export function ProcessEditor({ processId }: { processId: string }) {
  const router = useRouter();
  const process = useProcess(processId);
  const jdId = process.data?.jd?.jdId ?? "";
  const official = useOfficialProcess(jdId);
  const update = useUpdateProcess();
  const confirm = useConfirmLoop();

  const [name, setName] = useState("");
  const [graph, setGraph] = useState<ProcessGraph | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [selected, setSelected] = useState<string | null>(null);

  // Load the draft once, when the process arrives.
  useEffect(() => {
    if (process.data && graph === null) {
      setName(process.data.name);
      setGraph(process.data.graph);
      setSaved(JSON.stringify([process.data.name, process.data.graph]));
    }
  }, [process.data, graph]);

  const dirty = graph !== null && JSON.stringify([name, graph]) !== saved;
  const problems = useMemo(() => (graph ? graphProblems(graph) : []), [graph]);
  const nameOk = name.trim().length > 0;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (process.isLoading || (process.data && graph === null)) {
    return <div className="fixed inset-0 z-50 bg-background p-6"><HudZoomOff /><Skeleton className="h-full w-full rounded-xl" /></div>;
  }
  if (process.isError || !process.data || graph === null) {
    const missing = process.error instanceof ApiFetchError && process.error.status === 404;
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <HudZoomOff />
        <p className="m-0 text-sm">{missing ? "This process doesn't exist." : "Couldn't load this process."}</p>
        <Button asChild variant="strong" size="sm"><Link href={ROUTES.processes}>Back to my processes</Link></Button>
      </div>
    );
  }

  const g: ProcessGraph = graph;
  const sel = g.nodes.find((n) => n.id === selected) ?? null;

  function addRound(type: RoundType, position?: { x: number; y: number }) {
    const node = newRoundNode(type, position ?? nextPosition(g));
    // Chain after the selected round, or else after the last round on the canvas, so building a
    // line is one click per round. Dropping at a point never auto-connects.
    const rounds = roundNodesOf(g);
    const last = [...rounds].sort((a, b) => b.position.x - a.position.x)[0];
    const from = sel && isRound(sel) ? sel.id : (last?.id ?? null);
    setGraph({ nodes: [...g.nodes, node], edges: from && !position ? [...g.edges, { source: from, target: node.id }] : g.edges });
    setSelected(node.id);
  }

  function addInfo(position?: { x: number; y: number }) {
    const infoCount = g.nodes.filter((n) => n.kind === "info").length;
    const node = newInfoNode(position ?? { x: infoCount * 260, y: -170 });
    setGraph({ ...g, nodes: [...g.nodes, node] });
    setSelected(node.id);
  }

  function patchNode(id: string, patch: Record<string, unknown>) {
    setGraph({ ...g, nodes: g.nodes.map((n) => (n.id === id ? ({ ...n, ...patch } as ProcessNode) : n)) });
  }

  function removeNode(id: string) {
    setGraph({ nodes: g.nodes.filter((n) => n.id !== id), edges: g.edges.filter((e) => e.source !== id && e.target !== id) });
    setSelected(null);
  }

  function drop(payload: string, position: { x: number; y: number }) {
    if (payload === "info") addInfo(position);
    else if (payload.startsWith("round:")) addRound(payload.slice(6) as RoundType, position);
  }

  async function save(): Promise<boolean> {
    try {
      await update.mutateAsync({ id: processId, name: name.trim(), graph: g });
      setSaved(JSON.stringify([name, g]));
      toast.success("Process saved.");
      return true;
    } catch (err) {
      toast.error(err instanceof ApiFetchError && err.status === 400 ? err.message : "Couldn't save. Please try again.");
      return false;
    }
  }

  async function saveAndConfirm() {
    if (dirty && !(await save())) return;
    confirm.mutate({ jdId, processId }, {
      onSuccess: (loop) => { toast.success("Track started from your custom process."); router.push(`${ROUTES.loops}/${loop.id}`); },
      onError: (err) => toast.error(err instanceof ApiFetchError && err.code === "loop_exists" ? "You already have an active track for this role." : "Couldn't start a track from this process."),
    });
  }

  function leave() {
    if (dirty && !window.confirm("You have unsaved changes. Leave without saving?")) return;
    router.push(ROUTES.processes);
  }

  const canSave = dirty && problems.length === 0 && nameOk && !update.isPending;
  const canConfirm = problems.length === 0 && nameOk && !confirm.isPending && !update.isPending;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background text-foreground">
      <HudZoomOff />
      <header className="flex flex-wrap items-center gap-3 border-b border-line-2 px-4 py-3 sm:px-5">
        <Button variant="ghost" size="sm" onClick={leave}><ArrowLeft aria-hidden />Interview processes</Button>
        <input
          aria-label="Process name"
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          className="h-9 min-w-0 flex-[1_1_240px] rounded-lg border border-transparent bg-transparent px-2 text-[15px] outline-none hover:border-line-3 focus-visible:border-line-4 focus-visible:ring-1 focus-visible:ring-ring"
        />
        <span className="hidden truncate text-xs text-faint md:block">
          {process.data.jd ? `${process.data.jd.companyName} · ${process.data.jd.title}` : ""} · standalone, not counted towards readiness
        </span>
        <span className={cn("font-mono text-[11px] uppercase tracking-[0.08em]", dirty ? "text-brand" : "text-faint")} aria-live="polite">
          {update.isPending ? "Saving…" : dirty ? "Unsaved" : "Saved"}
        </span>
        <Button variant="strong" size="sm" disabled={!canSave} onClick={() => void save()}>
          {update.isPending ? <Loader2 aria-hidden className="animate-spin" /> : null}Save
        </Button>
        <Button size="sm" disabled={!canConfirm} onClick={() => void saveAndConfirm()}>
          {confirm.isPending ? <Loader2 aria-hidden className="animate-spin" /> : null}Start track
        </Button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[230px_minmax(0,1fr)_300px]">
        <aside aria-label="Node palette" className="flex flex-col gap-2 overflow-y-auto border-b border-line-2 p-4 md:border-b-0 md:border-r">
          <p className="iq-eyebrow m-0">Interview rounds</p>
          <p className="m-0 text-xs leading-[1.5] text-muted-foreground">Click to add: the round chains after the selected round (or the last one). Drag onto the canvas to place it yourself, then connect it.</p>
          {ROUND_PRESETS.map((p) => (
            <button
              key={p.type}
              type="button"
              draggable
              onDragStart={(e) => { e.dataTransfer.setData(PALETTE_MIME, `round:${p.type}`); e.dataTransfer.effectAllowed = "copy"; }}
              onClick={() => addRound(p.type)}
              className="flex items-center justify-between gap-2 rounded-xl border border-line-3 bg-card px-3 py-2.5 text-left text-[13px] transition-colors hover:border-faint-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <span>{p.label}<span className="block font-mono text-[11px] text-faint">{p.durationMinutes} min · {p.difficulty}</span></span>
              <Plus aria-hidden className="h-4 w-4 text-faint" />
            </button>
          ))}
          <p className="iq-eyebrow m-0 mt-3">Info only</p>
          <button
            type="button"
            draggable
            onDragStart={(e) => { e.dataTransfer.setData(PALETTE_MIME, "info"); e.dataTransfer.effectAllowed = "copy"; }}
            onClick={() => addInfo()}
            className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-line-4 bg-panel/60 px-3 py-2.5 text-left text-[13px] opacity-80 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <span className="flex items-center gap-2"><Info aria-hidden className="h-4 w-4" />Info step</span>
            <Plus aria-hidden className="h-4 w-4 text-faint" />
          </button>
          <p className="m-0 text-xs leading-[1.5] text-faint">Online tests, take-homes and the like. They can&apos;t be connected and never count.</p>
        </aside>

        <main className="min-h-[360px] min-w-0 p-3">
          <FlowCanvas graph={g} mode="edit" selectedId={selected} onSelect={setSelected} onGraphChange={setGraph} onDropPreset={drop} className="h-full" />
        </main>

        <aside aria-label="Inspector" className="flex flex-col gap-4 overflow-y-auto border-t border-line-2 p-4 md:border-l md:border-t-0">
          {sel ? (
            <Inspector node={sel} onPatch={(patch) => patchNode(sel.id, patch)} onDelete={() => removeNode(sel.id)} />
          ) : (
            <>
              <div>
                <p className="iq-eyebrow m-0">How it works</p>
                <ul className="m-0 mt-2 list-disc space-y-1.5 pl-4 text-[12.5px] leading-[1.5] text-muted-foreground">
                  <li>Drag from a round&apos;s right dot to another round&apos;s left dot to set the order.</li>
                  <li>A round unlocks when every round leading into it is completed. Rounds with nothing leading in are open from the start.</li>
                  <li>Select a node to edit it. Delete removes the selected node or connection.</li>
                </ul>
              </div>
              <div>
                <p className="iq-eyebrow m-0">Checks</p>
                {problems.length === 0 ? (
                  <p className="m-0 mt-2 text-[12.5px] text-muted-foreground">Looks good: {roundNodesOf(g).length} {roundNodesOf(g).length === 1 ? "round" : "rounds"}.</p>
                ) : (
                  <ul role="alert" className="m-0 mt-2 list-disc space-y-1 pl-4 text-[12.5px] leading-[1.5] text-destructive">
                    {problems.map((p) => <li key={p}>{p}</li>)}
                  </ul>
                )}
              </div>
              {official.data ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  onClick={() => { if (window.confirm("Replace the canvas with the role's official process? Your unsaved changes will be lost.")) { setGraph(official.data!); setSelected(null); } }}
                >
                  <RotateCcw aria-hidden />Reset to official
                </Button>
              ) : null}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
