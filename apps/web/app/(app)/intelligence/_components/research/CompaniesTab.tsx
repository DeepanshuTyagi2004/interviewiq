"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { StatusDot, padCount } from "@/components/hud";
import { CardEmpty, ConsoleCard, HeaderCount } from "@/components/observability/ConsoleCard";
import { HairlineHead, HairlineTable, Td, Th, Tr } from "@/components/observability/HairlineTable";
import { Button } from "@/components/ui/button";
import { ApiFetchError } from "@/lib/api-client/client";
import {
  COMPANY_STATUS_META,
  companyResearchStatus,
  companyStatusLabel,
  deepLinkHref,
  isRunActive,
  timeAgo,
  useAdminCompanies,
  useDeleteCompany,
  useResearchRuns,
  useSeedCompanies,
  useStartRun,
  useUpdateCompany,
  type AdminCompany,
} from "@/features/research";
import { AddCompanyForm } from "./AddCompanyForm";
import { DraftReviewDialog } from "./DraftReviewDialog";

function errorMessage(err: unknown): string {
  return err instanceof ApiFetchError ? err.message : "Something went wrong. Check the API logs.";
}

/** Intelligence → Companies: the curated list the research job works through (spec §9.1). */
export function CompaniesTab() {
  const companies = useAdminCompanies();
  const runs = useResearchRuns();
  const start = useStartRun();
  const seed = useSeedCompanies();
  const router = useRouter();
  const params = useSearchParams();
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = React.useState<string | null>(null);

  const rows = companies.data?.companies ?? [];
  const activeRun = runs.data?.runs.find((r) => isRunActive(r.status)) ?? null;

  const openRun = (runId: string) =>
    router.push(deepLinkHref(new URLSearchParams(params.toString()), { tab: "runs", run: runId, company: null, span: null }));

  async function research(ids: string[]) {
    setNotice(null);
    try {
      const run = await start.mutateAsync({ scope: "selected", companyIds: ids });
      setSelected(new Set());
      openRun(run.run_id);
    } catch (err) {
      setNotice(
        err instanceof ApiFetchError && err.code === "run_active"
          ? "A research run is already active. Resume or stop it before starting another."
          : errorMessage(err),
      );
    }
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-5">
      <AddCompanyForm />
      <ConsoleCard title="Companies" meta={<HeaderCount>{padCount(rows.length)}</HeaderCount>}>
        <div className="flex flex-wrap items-center gap-2 pb-3">
          <Button size="sm" disabled={selected.size === 0 || start.isPending} onClick={() => research([...selected])}>
            Research selected{selected.size > 0 ? ` (${selected.size})` : ""}
          </Button>
          <Button
            size="sm"
            variant="strong"
            disabled={seed.isPending}
            onClick={() =>
              seed.mutate(undefined, {
                onSuccess: (r) => toast.success(`Starter catalogue loaded · ${r.companies} new`),
                onError: (e) => toast.error(errorMessage(e)),
              })
            }
          >
            Load starter companies
          </Button>
          {activeRun ? (
            <button
              type="button"
              onClick={() => openRun(activeRun.run_id)}
              className="ml-auto text-[13px] text-muted-foreground underline-offset-4 hover:underline"
            >
              Active run · {activeRun.status} · open
            </button>
          ) : null}
        </div>
        {notice ? (
          <p role="alert" className="m-0 mb-3 text-[13px] text-destructive">
            {notice}
            {activeRun ? (
              <>
                {" "}
                <button type="button" className="underline" onClick={() => openRun(activeRun.run_id)}>
                  Open the active run
                </button>
              </>
            ) : null}
          </p>
        ) : null}
        {companies.data && !companies.data.researchAvailable ? (
          <p className="m-0 mb-3 text-[13px] text-muted-foreground">Research status is unavailable: the AI service is not reachable.</p>
        ) : null}
        {companies.isLoading ? (
          <p className="m-0 text-[13px] text-muted-foreground">Loading companies…</p>
        ) : rows.length === 0 ? (
          <CardEmpty title="No companies yet" hint="Add one above, or load the starter catalogue." />
        ) : (
          <HairlineTable label="Companies" className="min-w-[760px]">
            <HairlineHead>
              <Th className="w-8"><span className="sr-only">Select</span></Th>
              <Th>Company</Th>
              <Th>Research</Th>
              <Th>Last researched</Th>
              <Th>Published</Th>
              <Th><span className="sr-only">Actions</span></Th>
            </HairlineHead>
            <tbody>
              {rows.map((c) => (
                <CompanyRow
                  key={c.id}
                  company={c}
                  checked={selected.has(c.id)}
                  onToggle={() => toggle(c.id)}
                  onResearch={() => research([c.id])}
                  onOpenRun={openRun}
                  busy={start.isPending}
                />
              ))}
            </tbody>
          </HairlineTable>
        )}
      </ConsoleCard>
    </div>
  );
}

function CompanyRow({
  company,
  checked,
  onToggle,
  onResearch,
  onOpenRun,
  busy,
}: {
  company: AdminCompany;
  checked: boolean;
  onToggle: () => void;
  onResearch: () => void;
  onOpenRun: (runId: string) => void;
  busy: boolean;
}) {
  const update = useUpdateCompany();
  const del = useDeleteCompany();
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [reviewing, setReviewing] = React.useState(false);
  const status = COMPANY_STATUS_META[companyResearchStatus(company)];
  const archived = company.status === "archived";
  const lastRunId = company.research?.lastRunId ?? null;

  return (
    <Tr className={archived ? "opacity-60" : undefined}>
      <Td>
        <input type="checkbox" aria-label={`Select ${company.name}`} checked={checked} onChange={onToggle} disabled={archived} />
      </Td>
      <Td>
        <div className="flex flex-col">
          <span>{company.name}</span>
          <span className="font-mono text-[11px] text-faint">
            {company.slug}
            {archived ? " · archived" : ""}
          </span>
        </div>
      </Td>
      <Td><StatusDot state={status.dot} label={companyStatusLabel(company)} /></Td>
      <Td className="whitespace-nowrap text-[13px] text-muted-foreground">
        {company.research?.lastResearchedAt ? timeAgo(company.research.lastResearchedAt) : "—"}
      </Td>
      <Td className="font-mono text-[12px] text-muted-foreground">
        {company.publishedVersion ? `v${company.publishedVersion}` : company.publishedAt ? "seed" : "—"}
      </Td>
      <Td>
        <div className="flex flex-wrap justify-end gap-1.5">
          {!archived ? <Button size="sm" asChild><Link href={`/intelligence/companies/${encodeURIComponent(company.id)}/edit`}>Enrich company</Link></Button> : null}
          {company.research?.latestDraftId ? <Button size="sm" variant="strong" onClick={() => setReviewing(true)}>View research</Button> : null}
          <Button size="sm" variant="strong" disabled={busy || archived} onClick={onResearch}>Research now</Button>
          {lastRunId ? <Button size="sm" variant="ghost" onClick={() => onOpenRun(lastRunId)}>Last run</Button> : null}
          <Button
            size="sm"
            variant="ghost"
            disabled={update.isPending}
            onClick={() =>
              update.mutate(
                { id: company.id, patch: { status: archived ? "active" : "archived" } },
                { onError: (e) => toast.error(errorMessage(e)) },
              )
            }
          >
            {archived ? "Restore" : "Archive"}
          </Button>
          {confirmDelete ? (
            <>
              <Button
                size="sm"
                variant="destructive"
                disabled={del.isPending}
                onClick={() =>
                  del.mutate(company.id, { onError: (e) => toast.error(errorMessage(e)), onSettled: () => setConfirmDelete(false) })
                }
              >
                Confirm delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>Delete</Button>
          )}
        </div>
        {reviewing ? <DraftReviewDialog company={company} open onOpenChange={setReviewing} readOnly /> : null}
      </Td>
    </Tr>
  );
}
