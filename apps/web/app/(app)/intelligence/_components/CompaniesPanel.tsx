"use client";

import { useId, useState } from "react";
import { ChevronRight, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { FormField, MonoPill } from "@/components/patterns";
import { CardEmpty, ConsoleCard, HeaderCount } from "@/components/observability/ConsoleCard";
import { ApiFetchError } from "@/lib/api-client/client";
import {
  useAddCompany,
  useCompanies,
  useDeleteCompany,
  useSeedCompanies,
  type CreateCompanyInput,
} from "@/features/intelligence";
import { SELECT_CLASS } from "./fields";
import { RemoveCompanyButton } from "./RemoveCompanyButton";
import { ExtLink } from "./viewers";

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

export function CompaniesPanel() {
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] xl:items-start">
      <AddCompanyForm />
      <Catalogue />
    </div>
  );
}

function AddCompanyForm() {
  const [company, setCompany] = useState("");
  const [jds, setJds] = useState<DraftJd[]>([emptyJd()]);
  const add = useAddCompany();
  const formId = useId();

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
    <ConsoleCard title="Add a company + JDs">
      <form onSubmit={onSubmit} className="space-y-5 p-4 sm:p-5" aria-label="Add a company and its JDs">
        <FormField label="Company" htmlFor={`${formId}-company`} className="max-w-md">
          <Input
            id={`${formId}-company`}
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="e.g. Stripe"
            autoComplete="off"
          />
        </FormField>

        <div className="space-y-3 rounded-[14px] bg-panel p-3 sm:p-4">
          <p className="iq-eyebrow m-0">
            JDs · <span className="tabular-nums">{jds.length}</span>
          </p>
          {jds.map((jd, i) => {
            const id = (field: string) => `${formId}-jd${i}-${field}`;
            return (
              <div
                key={i}
                role="group"
                aria-labelledby={id("label")}
                className="iq-float min-w-0 space-y-3 p-3.5 sm:p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <p id={id("label")} className="m-0 font-mono text-[11.5px] tabular-nums text-faint">
                    JD {String(i + 1).padStart(2, "0")}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => removeRow(i)}
                    disabled={jds.length === 1}
                    aria-label={`Remove JD ${i + 1}`}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <FormField label="JD title" htmlFor={id("title")} className="sm:col-span-3">
                    <Input
                      id={id("title")}
                      value={jd.title}
                      onChange={(e) => update(i, { title: e.target.value })}
                      placeholder="e.g. Software Engineer, New Grad"
                    />
                  </FormField>
                  <FormField label="Level" htmlFor={id("level")}>
                    <select
                      id={id("level")}
                      value={jd.level}
                      onChange={(e) => update(i, { level: e.target.value })}
                      className={SELECT_CLASS}
                    >
                      {LEVELS.map((l) => (
                        <option key={l.value} value={l.value}>
                          {l.label}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Specialization" htmlFor={id("spec")}>
                    <select
                      id={id("spec")}
                      value={jd.specialization}
                      onChange={(e) => update(i, { specialization: e.target.value })}
                      className={SELECT_CLASS}
                    >
                      {SPECIALIZATIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Role (optional)" htmlFor={id("role")}>
                    <Input
                      id={id("role")}
                      value={jd.role}
                      onChange={(e) => update(i, { role: e.target.value })}
                      placeholder="e.g. software-engineer"
                    />
                  </FormField>
                </div>
                <FormField label="JD content" htmlFor={id("content")}>
                  <Textarea
                    id={id("content")}
                    value={jd.description}
                    onChange={(e) => update(i, { description: e.target.value })}
                    rows={4}
                    className="min-h-[96px]"
                    placeholder="Paste the full JD content — responsibilities, requirements, qualifications. This is stored and fed to Perplexity as search context."
                  />
                </FormField>
              </div>
            );
          })}
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <Plus aria-hidden /> Add JD
          </Button>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="m-0 max-w-md text-xs leading-[1.5] text-muted-foreground">
            Each JD becomes an ingestion target keyed by company + role + level + specialization.
            Adding triggers a run; the per-JD prompt, response, and stored document show in the Live
            ingestion tab.
          </p>
          <Button type="submit" disabled={!valid || add.isPending} className="shrink-0">
            {add.isPending ? "Adding…" : "Add company & ingest"}
          </Button>
        </div>
      </form>
    </ConsoleCard>
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

  function onDelete(company: string, done: () => void) {
    del.mutate(company, {
      onSuccess: () => {
        done();
        toast.success(`Removed ${company}.`);
      },
      onError: () => toast.error("Could not remove company."),
    });
  }

  const count = data?.length ?? 0;

  return (
    <ConsoleCard
      title="Catalogue"
      meta={
        <>
          {data ? <HeaderCount>{count} {count === 1 ? "company" : "companies"}</HeaderCount> : null}
          <Button variant="outline" size="sm" onClick={onSeed} disabled={seed.isPending}>
            {seed.isPending ? "Loading…" : "Load starter companies"}
          </Button>
        </>
      }
    >
      {isLoading ? (
        <div className="space-y-2 p-4 sm:px-5" aria-busy="true" aria-label="Loading the catalogue">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : isError || !data ? (
        <p role="alert" className="m-0 px-4 py-6 text-sm text-destructive sm:px-5">
          Could not load the catalogue.
        </p>
      ) : data.length === 0 ? (
        <CardEmpty
          title="No companies yet"
          hint="Add a company to start collecting interview intelligence, or load the starter catalogue."
        />
      ) : (
        <ul className="m-0 list-none divide-y divide-line p-0">
          {data.map((c) => (
            <li key={c.company} className="space-y-3 px-4 py-4 sm:px-5">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-primary text-[12px] font-medium uppercase text-primary-foreground"
                >
                  {c.company.charAt(0)}
                </span>
                <h3 className="m-0 min-w-0 flex-1 truncate font-mono text-[13.5px] font-normal">{c.company}</h3>
                <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-faint">
                  {c.jds.length} {c.jds.length === 1 ? "JD" : "JDs"}
                </span>
                <RemoveCompanyButton
                  company={c.company}
                  jdCount={c.jds.length}
                  pending={del.isPending}
                  onConfirm={(done) => onDelete(c.company, done)}
                />
              </div>
              <ul className="m-0 list-none space-y-1.5 p-0">
                {c.jds.map((jd) => (
                  <li key={jd.id ?? `${jd.role}-${jd.level}`}>
                    <details className="group rounded-[11px] border border-line-2 open:border-line-3">
                      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[11px] px-3 py-2.5 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          <ChevronRight
                            aria-hidden
                            className="h-3.5 w-3.5 shrink-0 text-faint transition-transform group-open:rotate-90 motion-reduce:transition-none"
                          />
                          <span className="min-w-0 truncate">{jd.title || "(untitled)"}</span>
                        </span>
                        <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                          {jd.specialization ? <MonoPill tone="ghost">{jd.specialization}</MonoPill> : null}
                          {jd.role ? <MonoPill tone="ghost">{jd.role}</MonoPill> : null}
                          <MonoPill tone="soft">{jd.level}</MonoPill>
                        </span>
                      </summary>
                      <div className="space-y-2 border-t border-line px-3 py-3">
                        {jd.jdUrl ? (
                          <ExtLink href={jd.jdUrl} className="block font-mono text-xs [overflow-wrap:anywhere]">
                            {jd.jdUrl}
                          </ExtLink>
                        ) : null}
                        <p className="m-0 whitespace-pre-wrap text-[13px] leading-[1.55] text-muted-foreground">
                          {jd.description || "No JD content yet."}
                        </p>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </ConsoleCard>
  );
}
