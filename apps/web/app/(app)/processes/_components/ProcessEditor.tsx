"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { HudZoomOff } from "@/components/hud";
import { Button } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/custom-select";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  graphProblems, isRound, newInfoNode, newPresetNode, roundNodesOf, ROUND_PRESETS,
  useConfirmLoop, useOfficialProcess, useProcess, useUpdateProcess,
  type ProcessGraph, type ProcessNode, type RoundNode,
} from "@/features/loops";
import { FlowCanvas } from "@/features/loops/components/FlowCanvas";
import { MAX_INFO_NODES, MAX_ROUND_NODES, newCatalogueNode } from "@/features/loops/graph";
import { NODE_PRESETS } from "@/features/loops/presets";
import { ApiFetchError } from "@/lib/api-client/errors";
import { ROUND_OPTIONS } from "@/lib/constants/interview";
import { ROUTES } from "@/lib/constants/shared";
import { cn } from "@/lib/utils/cn";
import { NodePalette } from "./NodePalette";
import { ENGINEERING_LEVEL_OPTIONS, isEngineeringLevel, normalizeLegacyLevel, type EngineeringLevel } from "@/lib/constants/engineering-levels";

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
  const [topics, setTopics] = useState((node.topics ?? []).join(", "));
  const topicList = topics.split(",").map((topic) => topic.trim()).filter(Boolean);
  const topicsInvalid = topicList.length > 20 || topicList.some((topic) => topic.length > 80);
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
            <CustomSelect label="Round type" className={field} value={node.type} options={types.map((t) => ({ value: t.value, label: t.label }))} onValueChange={(value) => { const type = types.find((t) => t.value === value)?.value; if (type) onPatch({ type }); }} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <Label>Minutes</Label>
              <input aria-label="Duration in minutes" type="number" min={5} max={240} className={field} value={node.durationMinutes}
                onChange={(e) => onPatch({ durationMinutes: Math.min(240, Math.max(5, Math.round(Number(e.target.value) || 5))) })} />
            </label>
          </div>
        </>
      ) : (
        <label className="flex flex-col gap-1.5">
          <Label>Note</Label>
          <textarea aria-label="Note" rows={4} maxLength={1000} className={cn(field, "h-auto resize-none py-2")} value={node.note} onChange={(e) => onPatch({ note: e.target.value })} />
          <span className="text-xs text-faint">Info steps are shown for reference. They can&apos;t be connected and never count.</span>
        </label>
      )}
      <div className="flex flex-col gap-1.5"><Label>Difficulty{isRound(node) ? "" : " (optional)"}</Label>
        <CustomSelect label="Difficulty" className={field} value={node.difficulty ?? ""} options={[...(!isRound(node) ? [{ value: "", label: "Not specified" }] : []), { value: "easy", label: "Easy" }, { value: "medium", label: "Medium" }, { value: "hard", label: "Hard" }]} onValueChange={(difficulty) => { if (difficulty === "easy" || difficulty === "medium" || difficulty === "hard") onPatch({ difficulty }); else if (!isRound(node)) onPatch({ difficulty: undefined }); }} />
      </div>
      <label className="flex flex-col gap-1.5"><Label>Topics (comma separated)</Label>
        <textarea aria-label="Topics" aria-invalid={topicsInvalid} rows={3} className={cn(field, "h-auto resize-none py-2")} value={topics} onChange={(event) => { setTopics(event.target.value); onPatch({ topics: event.target.value.split(",").map((topic) => topic.trim()).filter(Boolean) }); }} />
        <span className={cn("text-xs", topicsInvalid ? "text-destructive" : "text-faint")} role={topicsInvalid ? "alert" : undefined}>Up to 20 topics, 80 characters each.</span>
      </label>
      <label className="flex flex-col gap-1.5"><Label>Interviewer instructions</Label>
        <textarea aria-label="Interviewer instructions" rows={6} maxLength={4000} className={cn(field, "h-auto resize-y py-2")} placeholder="Describe what to focus on and how to run this round…" value={node.instructions ?? ""} onChange={(event) => onPatch({ instructions: event.target.value })} />
        <span className="text-xs text-faint">Natural-language guidance for the interviewer. {(node.instructions ?? "").length}/4000{!isRound(node) ? " · reference only" : ""}</span>
      </label>
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
  const [level, setLevel] = useState<EngineeringLevel | "">("");
  const [graph, setGraph] = useState<ProcessGraph | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [selected, setSelected] = useState<string | null>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [action, setAction] = useState<"leave" | "reset" | null>(null);
  const saving = useRef(false);
  const starting = useRef(false);
  const latestGraph = useRef<ProcessGraph | null>(null);
  useEffect(() => { latestGraph.current = graph; }, [graph]);

  // Initialise once per process. Background refetches must never replace a live canvas draft.
  if (process.data && loadedId !== processId) {
    setLoadedId(processId);
    setName(process.data.name);
    setLevel(normalizeLegacyLevel(process.data.level) ?? "");
    setGraph(process.data.graph);
    setSaved(JSON.stringify([process.data.name, normalizeLegacyLevel(process.data.level) ?? "", process.data.graph]));
    setSelected(null);
  }

  const dirty = graph !== null && JSON.stringify([name, level, graph]) !== saved;
  const problems = useMemo(() => (graph ? graphProblems(graph) : []), [graph]);
  const nameOk = name.trim().length > 0 && isEngineeringLevel(level);

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

  function addNode(kind: ProcessNode["kind"], create: (position: { x: number; y: number }) => ProcessNode, position?: { x: number; y: number }) {
    if (saving.current || starting.current || update.isPending || confirm.isPending) return;
    const limit = kind === "round" ? MAX_ROUND_NODES : MAX_INFO_NODES;
    if ((latestGraph.current ?? g).nodes.filter((node) => node.kind === kind).length >= limit) {
      toast.error(`A process can have at most ${limit} ${kind === "round" ? "interview rounds" : "reference steps"}. Remove one to add another.`);
      return;
    }
    const node = create(position ?? { x: 0, y: 0 });
    setGraph((current) => {
      if (!current || current.nodes.filter((item) => item.kind === kind).length >= limit) return current;
      const rounds = roundNodesOf(current);
      const selectedRound = rounds.find((item) => item.id === selected);
      // Stored insertion order is stable even when the user drags rounds around the canvas.
      const from = selectedRound?.id ?? rounds.at(-1)?.id;
      const placed = { ...node, position: position ?? (kind === "round" ? nextPosition(current) : { x: current.nodes.filter((item) => item.kind === "info").length * 260, y: -170 }) };
      const next = { nodes: [...current.nodes, placed], edges: kind === "round" && from && !position ? [...current.edges, { source: from, target: node.id }] : current.edges };
      latestGraph.current = next;
      return next;
    });
    setSelected(node.id);
  }

  function addCatalogue(id: string, position?: { x: number; y: number }) {
    const preset = NODE_PRESETS.find((item) => item.id === id);
    if (preset) addNode(preset.kind, (point) => newCatalogueNode(id, point), position);
  }

  function patchNode(id: string, patch: Record<string, unknown>) {
    if (saving.current || starting.current) return;
    setGraph((current) => {
      if (!current) return current;
      const next = { ...current, nodes: current.nodes.map((n) => (n.id === id ? ({ ...n, ...patch } as ProcessNode) : n)) };
      latestGraph.current = next;
      return next;
    });
  }

  function removeNode(id: string) {
    if (saving.current || starting.current || update.isPending || confirm.isPending) return;
    setGraph((current) => {
      if (!current) return current;
      const next = { nodes: current.nodes.filter((n) => n.id !== id), edges: current.edges.filter((e) => e.source !== id && e.target !== id) };
      latestGraph.current = next;
      return next;
    });
    setSelected(null);
  }

  function drop(payload: string, position: { x: number; y: number }) {
    if (saving.current || starting.current || update.isPending || confirm.isPending) return;
    if (payload.startsWith("catalogue:")) addCatalogue(payload.slice(10), position);
    else if (payload === "info") addNode("info", newInfoNode, position);
    else {
      const preset = payload.startsWith("preset:") ? ROUND_PRESETS.find((p) => p.id === payload.slice(7)) : payload.startsWith("round:") ? ROUND_PRESETS.find((p) => p.type === payload.slice(6)) : undefined;
      if (preset) addNode("round", (point) => newPresetNode(preset.id, point), position);
    }
  }

  async function save(): Promise<boolean> {
    if (saving.current || update.isPending || problems.length || !nameOk || !isEngineeringLevel(level)) return false;
    saving.current = true;
    try {
      const canonical = await update.mutateAsync({ id: processId, name: name.trim(), level, graph: g });
      setName(canonical.name);
      setLevel(normalizeLegacyLevel(canonical.level) ?? "");
      latestGraph.current = canonical.graph;
      setGraph(canonical.graph);
      setSaved(JSON.stringify([canonical.name, canonical.level, canonical.graph]));
      toast.success("Process saved.");
      return true;
    } catch (err) {
      toast.error(err instanceof ApiFetchError && err.status === 400 ? err.message : "Couldn't save. Please try again.");
      return false;
    } finally {
      saving.current = false;
    }
  }

  async function saveAndConfirm() {
    if (starting.current || confirm.isPending || update.isPending || !nameOk || problems.length) return;
    starting.current = true;
    if (dirty && !(await save())) { starting.current = false; return; }
    confirm.mutate({ ...(jdId ? { jdId } : {}), processId }, {
      onSuccess: (loop) => { toast.success("Track started from your custom process."); router.push(`${ROUTES.loops}/${loop.id}`); },
      onError: (err) => toast.error(err instanceof ApiFetchError && err.code === "loop_exists" ? "You already have an active track for this role." : "Couldn't start a track from this process."),
      onSettled: () => { starting.current = false; },
    });
  }

  function leave() {
    if (update.isPending || confirm.isPending) return;
    if (dirty) { setAction("leave"); return; }
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
          disabled={update.isPending || confirm.isPending}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          className="h-9 min-w-0 flex-[1_1_240px] rounded-lg border border-transparent bg-transparent px-2 text-[15px] outline-none hover:border-line-3 focus-visible:border-line-4 focus-visible:ring-1 focus-visible:ring-ring"
        />
        <CustomSelect label="Process level" value={level} disabled={update.isPending || confirm.isPending} options={[{ value: "", label: "Choose a level" }, ...ENGINEERING_LEVEL_OPTIONS]} onValueChange={(value) => { if (isEngineeringLevel(value) || value === "") setLevel(value); }} className={cn(field, "w-40")} />
        {!normalizeLegacyLevel(process.data.level) && !level ? <span className="text-xs text-muted-foreground">Saved level is unrecognized. Choose a level to save or start.</span> : null}
        <span className="hidden truncate text-xs text-faint md:block">
          {process.data.jd ? `${process.data.jd.companyName} · ${process.data.jd.title} · ` : ""}Standalone practice
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

      <div className="grid min-h-0 flex-1 grid-cols-1 auto-rows-max overflow-y-auto md:grid-cols-[280px_minmax(0,1fr)_300px] md:grid-rows-[minmax(0,1fr)] md:overflow-hidden">
        <NodePalette onAdd={addCatalogue} disabled={update.isPending || confirm.isPending} roundCount={roundNodesOf(g).length} infoCount={g.nodes.filter((node) => node.kind === "info").length} />

        <main inert={update.isPending || confirm.isPending} className="h-[420px] min-h-0 min-w-0 p-3 md:h-auto">
          <FlowCanvas graph={g} mode="edit" selectedId={selected} onSelect={setSelected} onGraphChange={(next) => { if (!saving.current && !starting.current && !update.isPending && !confirm.isPending) { latestGraph.current = next; setGraph(next); } }} onDropPreset={drop} className="h-full" />
        </main>

        <aside aria-label="Inspector" inert={update.isPending || confirm.isPending} className="flex flex-col gap-4 overflow-y-auto border-t border-line-2 p-4 md:border-l md:border-t-0">
          {sel ? (
            <Inspector key={sel.id} node={sel} onPatch={(patch) => patchNode(sel.id, patch)} onDelete={() => removeNode(sel.id)} />
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
                  onClick={() => setAction("reset")}
                >
                  <RotateCcw aria-hidden />Copy suggested rounds
                </Button>
              ) : null}
            </>
          )}
        </aside>
      </div>
      <ConfirmationDialog open={action !== null} onOpenChange={(open) => { if (!open) setAction(null); }} title={action === "leave" ? "Leave without saving?" : "Replace these rounds?"} description={action === "leave" ? "Your unsaved changes will be lost." : "Replace your current canvas with the role's suggested rounds. You can edit the copy before saving."} confirmLabel={action === "leave" ? "Leave editor" : "Replace rounds"} destructive={action === "leave"} onConfirm={() => { if (action === "leave") router.push(ROUTES.processes); else if (official.data) { latestGraph.current = official.data; setGraph(official.data); setSelected(null); } }} />
    </div>
  );
}
