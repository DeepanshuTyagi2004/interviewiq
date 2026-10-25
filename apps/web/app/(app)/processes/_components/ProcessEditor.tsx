"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Chip } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/custom-select";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useBreadcrumbNames } from "@/components/layout/app-shell/Breadcrumbs";
import {
  graphProblems, isRound, newInfoNode, newPresetNode, roundNodesOf, ROUND_PRESETS,
  useConfirmLoop, useOfficialProcess, useProcess, useUpdateProcess,
  type ProcessGraph, type ProcessNode, type RoundNode,
} from "@/features/loops";
import { FlowCanvas } from "@/features/loops/components/FlowCanvas";
import { MAX_INFO_NODES, MAX_ROUND_NODES, newCatalogueNode } from "@/features/loops/graph";
import { NODE_PRESETS } from "@/features/loops/presets";
import { ApiFetchError } from "@/lib/api-client/errors";
import { ROUND_MINUTES_LABEL, ROUND_OPTIONS } from "@/lib/constants/interview";
import { ROUTES } from "@/lib/constants/shared";
import { cn } from "@/lib/utils/cn";
import { NodePalette } from "./NodePalette";
import { ENGINEERING_LEVEL_OPTIONS, isEngineeringLevel, normalizeLegacyLevel, type EngineeringLevel } from "@/lib/constants/engineering-levels";

const field = "h-10 w-full rounded-full bg-background px-4 text-[13px] shadow-ring outline-none transition-[box-shadow] duration-150 placeholder:text-placeholder focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50";
const area = "w-full rounded-2xl bg-background px-4 py-2.5 text-[13px] shadow-ring outline-none transition-[box-shadow] duration-150 placeholder:text-placeholder focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background";

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
            <CustomSelect label="Round type" value={node.type} options={types.map((t) => ({ value: t.value, label: t.label }))} onValueChange={(value) => { const type = types.find((t) => t.value === value)?.value; if (type) onPatch({ type }); }} />
          </label>
          {/* Not editable: every mock round has the same length. */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Length</Label>
              <span className="text-[13px]">{ROUND_MINUTES_LABEL}, set when you book</span>
            </div>
          </div>
        </>
      ) : (
        <label className="flex flex-col gap-1.5">
          <Label>Note</Label>
          <textarea aria-label="Note" rows={4} maxLength={1000} className={cn(area, "resize-none")} value={node.note} onChange={(e) => onPatch({ note: e.target.value })} />
          <span className="text-[12.5px] text-ink-3">Info steps are shown for reference. They can&apos;t be connected and never count.</span>
        </label>
      )}
      <div className="flex flex-col gap-1.5"><Label>Difficulty{isRound(node) ? "" : " (optional)"}</Label>
        <CustomSelect label="Difficulty" value={node.difficulty ?? ""} options={[...(!isRound(node) ? [{ value: "", label: "Not specified" }] : []), { value: "easy", label: "Easy" }, { value: "medium", label: "Medium" }, { value: "hard", label: "Hard" }]} onValueChange={(difficulty) => { if (difficulty === "easy" || difficulty === "medium" || difficulty === "hard") onPatch({ difficulty }); else if (!isRound(node)) onPatch({ difficulty: undefined }); }} />
      </div>
      <label className="flex flex-col gap-1.5"><Label>Topics (comma separated)</Label>
        <textarea aria-label="Topics" aria-invalid={topicsInvalid} rows={3} className={cn(area, "resize-none")} value={topics} onChange={(event) => { setTopics(event.target.value); onPatch({ topics: event.target.value.split(",").map((topic) => topic.trim()).filter(Boolean) }); }} />
        <span className={cn("text-[12.5px]", topicsInvalid ? "text-destructive" : "text-ink-3")} role={topicsInvalid ? "alert" : undefined}>Up to 20 topics, 80 characters each.</span>
      </label>
      <label className="flex flex-col gap-1.5"><Label>Interviewer instructions</Label>
        <textarea aria-label="Interviewer instructions" rows={6} maxLength={4000} className={cn(area, "resize-y")} placeholder="Describe what to focus on and how to run this round…" value={node.instructions ?? ""} onChange={(event) => onPatch({ instructions: event.target.value })} />
        <span className="text-[12.5px] text-ink-3">Natural-language guidance for the interviewer. {(node.instructions ?? "").length}/4000{!isRound(node) ? " · reference only" : ""}</span>
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
  useBreadcrumbNames({ process: process.data?.name });
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
  // From md up the palette and inspector float over the canvas, so the fit keeps clear of them.
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
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
    return <div className="fixed inset-0 z-50 bg-surface p-3" aria-busy="true" aria-label="Loading process"><Skeleton className="h-full w-full rounded-card" /></div>;
  }
  if (process.isError || !process.data || graph === null) {
    const missing = process.error instanceof ApiFetchError && process.error.status === 404;
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-surface p-6 text-center">
        <p className="m-0 text-sm">{missing ? "This process doesn't exist." : "Couldn't load this process."}</p>
        <Button asChild variant="outline" size="sm"><Link href={`${ROUTES.loops}?tab=processes`}>Back to my processes</Link></Button>
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
    router.push(`${ROUTES.loops}?tab=processes`);
  }

  const canSave = dirty && problems.length === 0 && nameOk && !update.isPending;
  const canConfirm = problems.length === 0 && nameOk && !confirm.isPending && !update.isPending;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface text-foreground">
      <header className="z-10 mx-3 mt-3 flex flex-none flex-wrap items-center gap-2 rounded-[28px] border border-line bg-background px-3 py-2 shadow-float md:rounded-full md:pl-2 md:pr-2.5">
        <Button variant="ghost" size="sm" onClick={leave}><ArrowLeft aria-hidden />Interview processes</Button>
        <input
          aria-label="Process name"
          value={name}
          disabled={update.isPending || confirm.isPending}
          maxLength={120}
          title={name}
          onChange={(e) => setName(e.target.value)}
          className="h-9 min-w-0 flex-[1_1_220px] rounded-full border border-transparent bg-transparent px-3 font-display text-[16px] tracking-[-0.01em] outline-none transition-colors hover:border-line-3 focus-visible:ring-2 focus-visible:ring-brand"
        />
        <CustomSelect label="Process level" value={level} disabled={update.isPending || confirm.isPending} options={[{ value: "", label: "Choose a level" }, ...ENGINEERING_LEVEL_OPTIONS]} onValueChange={(value) => { if (isEngineeringLevel(value) || value === "") setLevel(value); }} className="h-9 w-40" />
        {!normalizeLegacyLevel(process.data.level) && !level ? <span className="text-[12.5px] text-ink-2">Saved level is unrecognized. Choose a level to save or start.</span> : null}
        <span className="hidden max-w-[240px] truncate text-[12.5px] text-ink-3 lg:block" title={process.data.jd ? `${process.data.jd.companyName} · ${process.data.jd.title}` : undefined}>
          {process.data.jd ? `${process.data.jd.companyName} · ${process.data.jd.title} · ` : ""}Standalone practice
        </span>
        <span aria-live="polite">
          <Chip tone={dirty || update.isPending ? "ink" : "outline"} dot={update.isPending ? "live" : dirty ? "filled" : "hollow"}>
            {update.isPending ? "Saving…" : dirty ? "Unsaved" : "Saved"}
          </Chip>
        </span>
        <Button variant="outline" size="sm" disabled={!canSave} onClick={() => void save()}>
          {update.isPending ? <Loader2 aria-hidden className="animate-spin" /> : null}Save
        </Button>
        <Button size="sm" disabled={!canConfirm} onClick={() => void saveAndConfirm()}>
          {confirm.isPending ? <Loader2 aria-hidden className="animate-spin" /> : null}Start track
        </Button>
      </header>

      {/* The canvas fills the area; on md+ the palette and inspector float over it as rounded panels. */}
      <div className="relative min-h-0 flex-1 overflow-y-auto md:overflow-hidden">
        <div className="flex flex-col gap-3 p-3 md:block md:p-0">
          <NodePalette onAdd={addCatalogue} disabled={update.isPending || confirm.isPending} roundCount={roundNodesOf(g).length} infoCount={g.nodes.filter((node) => node.kind === "info").length} />

          <main inert={update.isPending || confirm.isPending} className="h-[420px] min-h-0 min-w-0 md:absolute md:inset-0 md:h-full md:p-3">
            <FlowCanvas graph={g} mode="edit" selectedId={selected} onSelect={setSelected} onGraphChange={(next) => { if (!saving.current && !starting.current && !update.isPending && !confirm.isPending) { latestGraph.current = next; setGraph(next); } }} onDropPreset={drop} insets={wide ? { left: 304, right: 324 } : undefined} className="h-full" />
          </main>

          <aside aria-label="Inspector" inert={update.isPending || confirm.isPending} className="flex flex-col gap-4 overflow-y-auto rounded-card border border-line bg-background p-4 shadow-float md:absolute md:right-6 md:top-6 md:z-10 md:max-h-[calc(100%-3rem)] md:w-[300px]">
          {sel ? (
            <Inspector key={sel.id} node={sel} onPatch={(patch) => patchNode(sel.id, patch)} onDelete={() => removeNode(sel.id)} />
          ) : (
            <>
              <div>
                <p className="iq-eyebrow m-0">How it works</p>
                <ul className="m-0 mt-2 list-disc space-y-1.5 pl-4 text-[12.5px] leading-[1.5] text-ink-2">
                  <li>Drag from a round&apos;s right dot to another round&apos;s left dot to set the order.</li>
                  <li>A round unlocks when every round leading into it is completed. Rounds with nothing leading in are open from the start.</li>
                  <li>Select a node to edit it. Delete removes the selected node or connection.</li>
                </ul>
              </div>
              <div>
                <p className="iq-eyebrow m-0">Checks</p>
                {problems.length === 0 ? (
                  <p className="m-0 mt-2 text-[12.5px] text-ink-2">Looks good: {roundNodesOf(g).length} {roundNodesOf(g).length === 1 ? "round" : "rounds"}.</p>
                ) : (
                  <ul role="alert" className="m-0 mt-2 list-disc space-y-1 pl-4 text-[12.5px] leading-[1.5] text-destructive">
                    {problems.map((p) => <li key={p}>{p}</li>)}
                  </ul>
                )}
              </div>
              {official.data ? (
                <Button
                  variant="outline"
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
      </div>
      <ConfirmationDialog open={action !== null} onOpenChange={(open) => { if (!open) setAction(null); }} title={action === "leave" ? "Leave without saving?" : "Replace these rounds?"} description={action === "leave" ? "Your unsaved changes will be lost." : "Replace your current canvas with the role's suggested rounds. You can edit the copy before saving."} confirmLabel={action === "leave" ? "Leave editor" : "Replace rounds"} destructive={action === "leave"} onConfirm={() => { if (action === "leave") router.push(ROUTES.processes); else if (official.data) { latestGraph.current = official.data; setGraph(official.data); setSelected(null); } }} />
    </div>
  );
}
