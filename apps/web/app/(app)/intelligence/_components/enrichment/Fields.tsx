"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function TextField({ label, value, onChange, multiline = false }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean }) {
  const id = useId();
  return <div className="min-w-0 space-y-2"><label htmlFor={id} className="text-sm text-muted-foreground">{label}</label>{multiline
    ? <Textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={4} />
    : <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} />}</div>;
}

export function ListField({ label, value, onChange }: { label: string; value: string[]; onChange: (value: string[]) => void }) {
  return <TextField label={`${label} (one per line)`} multiline value={value.join("\n")} onChange={(text) => onChange(text.split("\n"))} />;
}

export function NumberField({ label, value, onChange, integer = false }: { label: string; value: number | null; onChange: (value: number | null) => void; integer?: boolean }) {
  const id = useId();
  return <div className="space-y-2"><label htmlFor={id} className="text-sm text-muted-foreground">{label}</label><Input id={id} className="font-mono" type="number" min={0} step={integer ? 1 : "any"} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : e.target.valueAsNumber)} /></div>;
}

export function VerifiedField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="flex items-start gap-3 rounded-lg border border-line-2 bg-panel p-4 text-sm"><input type="checkbox" className="mt-0.5 accent-brand" checked={checked} onChange={(e) => onChange(e.target.checked)} /><span>{label}</span></label>;
}
