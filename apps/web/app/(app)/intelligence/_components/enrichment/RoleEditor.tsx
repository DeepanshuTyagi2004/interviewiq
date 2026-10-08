"use client";

import { useState } from "react";
import type { XYPosition } from "@xyflow/react";
import { Maximize2 } from "lucide-react";
import { HudCard } from "@/components/hud";
import { Button } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/custom-select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { moveRound, newRound, type EnrichmentRole, type EnrichmentRound } from "@/features/research/enrichment";
import { ListField, NumberField, TextField, VerifiedField } from "./Fields";
import { RoundsCanvas } from "./RoundsCanvas";
import { ENGINEERING_LEVEL_OPTIONS, isEngineeringLevel, normalizeLegacyLevel } from "@/lib/constants/engineering-levels";

export function RoleEditor({ role, onChange, disabled }: { role: EnrichmentRole; onChange: (role: EnrichmentRole) => void; disabled: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(role.rounds[0]?.id ?? null);
  const [expanded, setExpanded] = useState(false);
  const [positions, setPositions] = useState<Record<string, XYPosition>>({});
  const selected = role.rounds.find((round) => round.id === selectedId) ?? role.rounds[0];
  const edit = (patch: Partial<EnrichmentRole>) => { if (!disabled) onChange({ ...role, ...patch, verified: false }); };
  const editRound = (round: EnrichmentRound) => edit({ rounds: role.rounds.map((r) => r.id === round.id ? round : r) });
  const workspace = <RoundsWorkspace rounds={role.rounds} selected={selected} expanded={expanded} disabled={disabled}
    positions={positions} onPositionsChange={(next) => { if (!disabled) setPositions(next); }}
    onSelect={(id) => { if (!disabled) setSelectedId(id); }} onEditRound={editRound}
    onMove={(id, delta) => edit({ rounds: moveRound(role.rounds, id, delta) })}
    onRemove={(id) => {
      if (disabled) return;
      const index = role.rounds.findIndex((round) => round.id === id);
      if (selected?.id === id) setSelectedId(role.rounds[index + 1]?.id ?? role.rounds[index - 1]?.id ?? null);
      edit({ rounds: role.rounds.filter((round) => round.id !== id) });
    }}
    onAdd={() => {
      if (disabled || role.rounds.length >= 12) return;
      const round = newRound();
      edit({ rounds: [...role.rounds, round] });
      setSelectedId(round.id);
    }} />;
  return <fieldset disabled={disabled} className="min-w-0 space-y-6">
    <HudCard title="Role profile / job description" bodyClassName="space-y-5 p-5 sm:p-6">
      <div className="grid gap-5 md:grid-cols-2">
        <TextField label="Job title" value={role.title} onChange={(title) => edit({ title })} />
        <TextField label="Role" value={role.role} onChange={(value) => edit({ role: value })} />
        <div className="space-y-2 text-sm text-muted-foreground"><span className="block">Level</span><CustomSelect label="Level" disabled={disabled} value={normalizeLegacyLevel(role.level) ?? ""} options={[{ value: "", label: "Choose a level" }, ...ENGINEERING_LEVEL_OPTIONS]} onValueChange={(level) => { if (isEngineeringLevel(level)) edit({ level }); }} /></div>
        <TextField label="Specialization (optional)" value={role.specialization ?? ""} onChange={(specialization) => edit({ specialization: specialization || null })} />
      </div>
      <TextField label="Job description" multiline value={role.description} onChange={(description) => edit({ description })} />
      <ListField label="Tech stack" value={role.techStack} onChange={(techStack) => edit({ techStack })} />
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <NumberField label="Experience min (years)" value={role.yoeMin} onChange={(yoeMin) => edit({ yoeMin })} />
        <NumberField label="Experience max (years)" value={role.yoeMax} onChange={(yoeMax) => edit({ yoeMax })} />
        <NumberField label="CTC min (LPA)" value={role.ctcMinLpa} onChange={(ctcMinLpa) => edit({ ctcMinLpa })} />
        <NumberField label="CTC max (LPA)" value={role.ctcMaxLpa} onChange={(ctcMaxLpa) => edit({ ctcMaxLpa })} />
      </div>
      <p className="text-xs text-muted-foreground">Leave unknown experience and compensation empty.</p>
      <ListField label="Role source URLs" value={role.sourceUrls} onChange={(sourceUrls) => edit({ sourceUrls })} />
      <VerifiedField label="I verified this role profile, job description and round sequence." checked={role.verified} onChange={(verified) => { if (!disabled) onChange({ ...role, verified }); }} />
    </HudCard>
    <HudCard title="Interview rounds" meta={<span className="font-mono text-xs text-faint">{role.rounds.length} / 12</span>} bodyClassName="space-y-5 p-5 sm:p-6">
      <Dialog open={expanded} onOpenChange={(open) => { if (!open || !disabled) setExpanded(open); }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="m-0 max-w-3xl text-sm text-muted-foreground">One connected sequence, first to last. Expand rounds to pan, zoom and arrange nodes. Use Move up / Move down to change the saved interview order. Canvas positions are temporary.</p>
          <DialogTrigger asChild><Button type="button" variant="strong" disabled={disabled}><Maximize2 aria-hidden="true" />Expand rounds</Button></DialogTrigger>
        </div>
        {!expanded ? workspace : null}
        <DialogContent className="left-0 top-0 flex max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 bg-frame p-0 text-foreground sm:rounded-none"
          style={{ width: "calc(100vw / var(--hud-zoom, 1))", height: "calc(100dvh / var(--hud-zoom, 1))", transform: "none", animation: "none" }}>
          <DialogHeader className="shrink-0 border-b border-line-2 bg-card px-5 py-4 pr-14 text-left">
            <DialogTitle>Interview rounds · Full screen</DialogTitle>
            <DialogDescription>Edits stay in your draft when you close this view. Use Save draft in the editor to store them.</DialogDescription>
          </DialogHeader>
          {expanded ? workspace : null}
        </DialogContent>
      </Dialog>
    </HudCard>
  </fieldset>;
}

type RoundsWorkspaceProps = {
  rounds: EnrichmentRound[];
  selected: EnrichmentRound | undefined;
  expanded: boolean;
  disabled: boolean;
  positions: Record<string, XYPosition>;
  onPositionsChange: (positions: Record<string, XYPosition>) => void;
  onSelect: (id: string) => void;
  onEditRound: (round: EnrichmentRound) => void;
  onMove: (id: string, delta: -1 | 1) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
};

/** Only one workspace is mounted; its document, selection and layout live above the dialog. */
function RoundsWorkspace({ rounds, selected, expanded, disabled, positions, onPositionsChange, onSelect, onEditRound, onMove, onRemove, onAdd }: RoundsWorkspaceProps) {
  return <fieldset disabled={disabled} aria-label="Interview rounds workspace" className={expanded
    ? "grid min-h-0 min-w-0 flex-1 grid-rows-[minmax(160px,40%)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_420px] lg:grid-rows-[minmax(0,1fr)]"
    : "min-w-0 space-y-5"}>
    <div className={expanded ? "min-h-0 min-w-0 p-3 sm:p-5" : "min-w-0"}>
      {rounds.length ? <RoundsCanvas rounds={rounds} selectedId={selected?.id ?? null} onSelect={onSelect} disabled={disabled} expanded={expanded} positions={positions} onPositionsChange={onPositionsChange} />
        : <p className={`flex items-center justify-center rounded-lg border border-dashed border-line-3 p-8 text-center text-sm text-muted-foreground ${expanded ? "m-0 h-full" : ""}`}>Add the first interview round.</p>}
    </div>
    <div role={expanded ? "region" : undefined} aria-label={expanded ? "Round inspector" : undefined} tabIndex={expanded ? 0 : undefined} className={expanded ? "min-h-0 min-w-0 space-y-5 overflow-y-auto overscroll-contain border-t border-line-2 bg-card p-5 lg:border-l lg:border-t-0" : "space-y-5"}>
      {expanded ? <div className="space-y-2"><h3 className="text-sm font-medium">Round inspector <span className="ml-2 font-mono text-xs text-faint">{rounds.length} / 12</span></h3><p className="text-xs text-muted-foreground">Select a round to edit. Move up / Move down changes the saved order; dragging only arranges this view.</p></div> : null}
      <ol className="m-0 space-y-2 p-0" aria-label="Saved interview order">
        {rounds.map((round, index) => <li key={round.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line-2 p-3">
          <button type="button" disabled={disabled} aria-pressed={selected?.id === round.id} className="min-w-0 flex-1 text-left text-sm hover:text-brand" onClick={() => onSelect(round.id)}><span className="mr-3 font-mono text-faint">{String(index + 1).padStart(2, "0")}</span>{round.name || "Untitled round"}</button>
          <Button type="button" size="sm" variant="ghost" aria-label={`Move round ${index + 1} up`} disabled={disabled || index === 0} onClick={() => onMove(round.id, -1)}>Move up</Button>
          <Button type="button" size="sm" variant="ghost" aria-label={`Move round ${index + 1} down`} disabled={disabled || index === rounds.length - 1} onClick={() => onMove(round.id, 1)}>Move down</Button>
          <Button type="button" size="sm" variant="ghost" aria-label={`Remove round ${index + 1}`} disabled={disabled} onClick={() => onRemove(round.id)}>Remove</Button>
        </li>)}
      </ol>
      <Button type="button" variant="strong" disabled={disabled || rounds.length >= 12} onClick={onAdd}>Add round</Button>
      {selected ? <RoundEditor key={selected.id} round={selected} onChange={onEditRound} expanded={expanded} disabled={disabled} /> : null}
    </div>
  </fieldset>;
}

function RoundEditor({ round, onChange, expanded, disabled }: { round: EnrichmentRound; onChange: (round: EnrichmentRound) => void; expanded: boolean; disabled: boolean }) {
  const edit = (patch: Partial<EnrichmentRound>) => { if (!disabled) onChange({ ...round, ...patch, verified: false }); };
  const types: EnrichmentRound["type"][] = ["dsa", "system-design", "lld", "behavioural", "hiring-manager"];
  const difficulties: EnrichmentRound["difficulty"][] = ["easy", "medium", "hard"];
  return <div className="space-y-5 border-t border-line-2 pt-6">
    <TextField label="Round name" value={round.name} onChange={(name) => edit({ name })} />
    <div className={expanded ? "grid gap-5" : "grid gap-5 sm:grid-cols-3"}>
      <label className="space-y-2 text-sm text-muted-foreground"><span className="block">Round type</span><CustomSelect label="Round type" disabled={disabled} className="h-10 w-full rounded-md border border-input bg-background px-3 text-foreground" value={round.type} options={types.map((type) => ({ value: type, label: type }))} onValueChange={(value) => { const type = types.find((item) => item === value); if (type) edit({ type }); }} /></label>
      <label className="space-y-2 text-sm text-muted-foreground"><span className="block">Difficulty</span><CustomSelect label="Difficulty" disabled={disabled} className="h-10 w-full rounded-md border border-input bg-background px-3 text-foreground" value={round.difficulty} options={difficulties.map((difficulty) => ({ value: difficulty, label: difficulty }))} onValueChange={(value) => { const difficulty = difficulties.find((item) => item === value); if (difficulty) edit({ difficulty }); }} /></label>
      <NumberField label="Duration (minutes)" integer value={round.durationMinutes} onChange={(durationMinutes) => edit({ durationMinutes: durationMinutes ?? 0 })} />
    </div>
    <div className={expanded ? "grid gap-5" : "grid gap-5 lg:grid-cols-2"}><ListField label="Topics" value={round.topics} onChange={(topics) => edit({ topics })} /><ListField label="Questions" value={round.questions} onChange={(questions) => edit({ questions })} /></div>
    <TextField label="Round guidance" multiline value={round.guidance} onChange={(guidance) => edit({ guidance })} />
    <ListField label="Round source URLs" value={round.sourceUrls} onChange={(sourceUrls) => edit({ sourceUrls })} />
    <VerifiedField label="I verified this round's content, duration and sources." checked={round.verified} onChange={(verified) => onChange({ ...round, verified })} />
  </div>;
}
