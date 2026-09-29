"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionLabel, EmptyState } from "@/components/patterns";
import { ApiFetchError } from "@/lib/api-client/client";
import {
  useAddCompany,
  useCompanies,
  useDeleteCompany,
  useSeedCompanies,
  type CreateCompanyInput,
} from "@/features/intelligence";

const LEVELS = [
  { value: "fresher", label: "Fresher" },
  { value: "sde1", label: "SDE-1" },
  { value: "sde2", label: "SDE-2" },
  { value: "sde3", label: "SDE-3" },
];

const SPECIALIZATIONS = ["general", "backend", "frontend", "fullstack", "ml", "mobile", "platform"];

type DraftJd = {
  title: string;
  role: string;
  level: string;
  specialization: string;
  jdUrl: string;
  description: string;
};

const emptyJd = (): DraftJd => ({
  title: "",
  role: "",
  level: "fresher",
  specialization: "general",
  jdUrl: "",
  description: "",
});

const levelClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function CompaniesPanel() {
  return (
    <div className="space-y-8">
      <AddCompanyForm />
      <Catalogue />
    </div>
  );
}

function AddCompanyForm() {
  const [company, setCompany] = useState("");
  const [jds, setJds] = useState<DraftJd[]>([emptyJd()]);
  const add = useAddCompany();

  const update = (i: number, patch: Partial<DraftJd>) =>
    setJds((prev) => prev.map((jd, idx) => (idx === i ? { ...jd, ...patch } : jd)));
  const addRow = () => setJds((prev) => [...prev, emptyJd()]);
  const removeRow = (i: number) => setJds((prev) => prev.filter((_, idx) => idx !== i));

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: CreateCompanyInput = {
      company: company.trim(),
      jds: jds
        .filter((jd) => jd.title.trim())
        .map((jd) => ({
          title: jd.title.trim(),
          role: jd.role.trim() || undefined,
          level: jd.level,
          specialization: jd.specialization,
          jdUrl: jd.jdUrl.trim() || undefined,
          description: jd.description.trim() || undefined,
        })),
    };
    add.mutate(payload, {
      onSuccess: () => {
        toast.success("Company added — ingestion started. Watch the Live ingestion tab.");
        setCompany("");
        setJds([emptyJd()]);
      },
      onError: (err) =>
        toast.error(err instanceof ApiFetchError ? err.message : "Could not add company."),
    });
  }

  const valid = company.trim() && jds.some((jd) => jd.title.trim());

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <SectionLabel>Add a company + JDs</SectionLabel>

      <div className="max-w-md space-y-2">
        <Label htmlFor="company">Company</Label>
        <Input
          id="company"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder="e.g. Stripe"
          autoComplete="off"
        />
      </div>

      <div className="space-y-3">
        {jds.map((jd, i) => (
          <div key={i} className="space-y-3 rounded-lg border border-border bg-card p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_8rem_9rem_8rem_auto]">
              <Input
                value={jd.title}
                onChange={(e) => update(i, { title: e.target.value })}
                placeholder="JD title (e.g. Software Engineer, New Grad)"
                aria-label="JD title"
              />
              <select
                value={jd.level}
                onChange={(e) => update(i, { level: e.target.value })}
                className={levelClass}
                aria-label="Level"
              >
                {LEVELS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
              <select
                value={jd.specialization}
                onChange={(e) => update(i, { specialization: e.target.value })}
                className={levelClass}
                aria-label="Specialization"
              >
                {SPECIALIZATIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <Input
                value={jd.role}
                onChange={(e) => update(i, { role: e.target.value })}
                placeholder="role (opt.)"
                aria-label="Role"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeRow(i)}
                disabled={jds.length === 1}
                aria-label="Remove JD"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
            <Textarea
              value={jd.description}
              onChange={(e) => update(i, { description: e.target.value })}
              rows={4}
              placeholder="Paste the full JD content — responsibilities, requirements, qualifications. This is stored and fed to Perplexity as search context."
              aria-label="JD content"
            />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          <Plus className="size-4" /> Add JD
        </Button>
        <Button type="submit" disabled={!valid || add.isPending}>
          {add.isPending ? "Adding…" : "Add company & ingest"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Each JD becomes an ingestion target keyed by company + role + level + specialization. Adding
        triggers a run; the per-JD prompt, response, and stored document show in the Live ingestion tab.
      </p>
    </form>
  );
}

function Catalogue() {
  const { data, isLoading, isError } = useCompanies();
  const del = useDeleteCompany();
  const seed = useSeedCompanies();

  function onSeed() {
    seed.mutate(undefined, {
      onSuccess: (r) =>
        toast.success(`Starter catalogue loaded: ${r.inserted} added, ${r.backfilled} backfilled.`),
      onError: () => toast.error("Could not load the starter catalogue."),
    });
  }

  const seedButton = (
    <Button variant="outline" size="sm" onClick={onSeed} disabled={seed.isPending}>
      {seed.isPending ? "Loading…" : "Load starter companies"}
    </Button>
  );

  if (isLoading) return <Skeleton className="h-40 w-full rounded-xl" />;
  if (isError || !data) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Could not load the catalogue.
      </p>
    );
  }

  function onDelete(company: string) {
    del.mutate(company, {
      onSuccess: () => toast.success(`Removed ${company}.`),
      onError: () => toast.error("Could not remove company."),
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <SectionLabel>Catalogue ({data.length} companies)</SectionLabel>
        {seedButton}
      </div>
      {data.length === 0 ? (
        <EmptyState title="No companies yet" hint="Add a company above to start collecting interview intelligence." />
      ) : (
        <div className="space-y-3">
          {data.map((c) => (
            <Card key={c.company}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm font-semibold">{c.company}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDelete(c.company)}
                    disabled={del.isPending}
                  >
                    <Trash2 className="size-4" /> Remove
                  </Button>
                </div>
                <ul className="space-y-2">
                  {c.jds.map((jd) => (
                    <li key={jd.id ?? `${jd.role}-${jd.level}`}>
                      <details className="rounded-md border border-border">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm">
                          <span className="truncate">{jd.title || "(untitled)"}</span>
                          <span className="flex shrink-0 items-center gap-2">
                            {jd.specialization ? (
                              <Badge variant="outline">{jd.specialization}</Badge>
                            ) : null}
                            <Badge variant="outline">{jd.role}</Badge>
                            <Badge variant="secondary">{jd.level}</Badge>
                          </span>
                        </summary>
                        <div className="space-y-2 border-t border-border px-3 py-3">
                          {jd.jdUrl ? (
                            <a
                              href={jd.jdUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="block break-all font-mono text-xs text-primary underline-offset-4 hover:underline"
                            >
                              {jd.jdUrl}
                            </a>
                          ) : null}
                          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                            {jd.description || "No JD content yet."}
                          </p>
                        </div>
                      </details>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
