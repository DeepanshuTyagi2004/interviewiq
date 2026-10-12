## Task 15: Companies tab

**Files:**
- Create: `apps/web/app/(app)/intelligence/_components/research/AddCompanyForm.tsx`, `apps/web/app/(app)/intelligence/_components/research/CompaniesTab.tsx`
- Test: `apps/web/app/(app)/intelligence/_components/research/CompaniesTab.test.tsx`

**Interfaces:**
- Consumes: `@/features/research` (Task 14).
- Produces:
  - `CompaniesTab` (no props).
  - `AddCompanyForm` (no props) and `parseAliasInput(raw) -> string[]`.
  - "Research now" starts `{scope: "selected", companyIds: [id]}`, then navigates to `?tab=runs&run=<id>`.

- [ ] **Step 1: Write the failing test**

`apps/web/app/(app)/intelligence/_components/research/CompaniesTab.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeCompany } from "@/features/research/testing";

const h = vi.hoisted(() => ({
  companies: { data: undefined as unknown, isLoading: false },
  runs: { data: { runs: [] as unknown[] } },
  startMutateAsync: vi.fn(),
  push: vi.fn(),
  deleteMutate: vi.fn(),
  updateMutate: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("tab=companies"),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-client/client", () => {
  class ApiFetchError extends Error {
    constructor(readonly status: number, readonly code: string | undefined, message: string) {
      super(message);
    }
  }
  return { ApiFetchError, apiFetch: vi.fn() };
});
vi.mock("@/features/research", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/research")>()),
  useAdminCompanies: () => h.companies,
  useResearchRuns: () => h.runs,
  useStartRun: () => ({ mutateAsync: h.startMutateAsync, isPending: false }),
  useSeedCompanies: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateCompany: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateCompany: () => ({ mutate: h.updateMutate, isPending: false }),
  useDeleteCompany: () => ({ mutate: h.deleteMutate, isPending: false }),
}));

import { ApiFetchError } from "@/lib/api-client/client";
import { parseAliasInput } from "./AddCompanyForm";
import { CompaniesTab } from "./CompaniesTab";

const research = (over: object) => ({ lastRunId: "r".repeat(32), lastResearchedAt: null, lastStatus: null, latestDraftId: null, latestDraftStatus: null, ...over });
const MEESHO = makeCompany({ id: "00000000-0000-4000-8000-00000000000a", name: "Meesho", slug: "meesho", research: research({ lastStatus: "done", latestDraftStatus: "pending_review" }) });
const RAZORPAY = makeCompany({ id: "00000000-0000-4000-8000-00000000000b", name: "Razorpay", slug: "razorpay" });
const TCS = makeCompany({ id: "00000000-0000-4000-8000-00000000000c", name: "TCS", slug: "tcs", publishedAt: "2026-01-01T00:00:00Z", research: research({ lastStatus: "running" }) });

function row(name: string) {
  return screen.getByText(name).closest("tr")!;
}

describe("CompaniesTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.companies = { data: { companies: [MEESHO, RAZORPAY, TCS], researchAvailable: true }, isLoading: false };
    h.runs = { data: { runs: [] } };
  });

  it("shows each company's research status in words", () => {
    render(<CompaniesTab />);
    expect(within(row("Meesho")).getByText("Awaiting review")).toBeInTheDocument();
    expect(within(row("Razorpay")).getByText("Never researched")).toBeInTheDocument();
    expect(within(row("TCS")).getByText("Researching")).toBeInTheDocument();
  });

  it("Research now starts a selected run and opens it on the Runs tab", async () => {
    h.startMutateAsync.mockResolvedValue({ run_id: "f".repeat(32) });
    render(<CompaniesTab />);
    await userEvent.click(within(row("Razorpay")).getByRole("button", { name: "Research now" }));
    expect(h.startMutateAsync).toHaveBeenCalledWith({ scope: "selected", companyIds: [RAZORPAY.id] });
    expect(h.push).toHaveBeenCalledWith(`?tab=runs&run=${"f".repeat(32)}`);
  });

  it("explains a 409 run_active instead of failing silently", async () => {
    h.startMutateAsync.mockRejectedValue(new ApiFetchError(409, "run_active", "run x is still active"));
    render(<CompaniesTab />);
    await userEvent.click(within(row("Meesho")).getByRole("button", { name: "Research now" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already active");
  });

  it("Research selected sends every ticked company", async () => {
    h.startMutateAsync.mockResolvedValue({ run_id: "e".repeat(32) });
    render(<CompaniesTab />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Select Meesho" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select Razorpay" }));
    await userEvent.click(screen.getByRole("button", { name: "Research selected (2)" }));
    expect(h.startMutateAsync).toHaveBeenCalledWith({ scope: "selected", companyIds: [MEESHO.id, RAZORPAY.id] });
  });

  it("delete needs a confirming second click", async () => {
    render(<CompaniesTab />);
    await userEvent.click(within(row("Razorpay")).getByRole("button", { name: "Delete" }));
    expect(h.deleteMutate).not.toHaveBeenCalled();
    await userEvent.click(within(row("Razorpay")).getByRole("button", { name: "Confirm delete" }));
    expect(h.deleteMutate).toHaveBeenCalledWith(RAZORPAY.id, expect.any(Object));
  });

  it("says when research status is unavailable", () => {
    h.companies = { data: { companies: [RAZORPAY], researchAvailable: false }, isLoading: false };
    render(<CompaniesTab />);
    expect(screen.getByText(/research status is unavailable/i)).toBeInTheDocument();
  });
});

describe("parseAliasInput", () => {
  it("splits on commas and drops blanks", () => {
    expect(parseAliasInput(" TCS, Tata CS ,, ")).toEqual(["TCS", "Tata CS"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @interviewiq/web exec vitest run "app/(app)/intelligence/_components/research/CompaniesTab.test.tsx"`
Expected: FAIL. `./CompaniesTab` cannot be resolved.

- [ ] **Step 3: Implement**

`apps/web/app/(app)/intelligence/_components/research/AddCompanyForm.tsx`:

```tsx
"use client";

import * as React from "react";
import { toast } from "sonner";
import { HudCard } from "@/components/hud";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiFetchError } from "@/lib/api-client/client";
import { useCreateCompany } from "@/features/research";

/** "TCS, Tata CS" → ["TCS", "Tata CS"]. The API trims, dedupes and validates. */
export function parseAliasInput(raw: string): string[] {
  return raw.split(",").map((a) => a.trim()).filter(Boolean);
}

/** Add a company to the curated research list. The next run (or "Research now") picks it up. */
export function AddCompanyForm() {
  const create = useCreateCompany();
  const [name, setName] = React.useState("");
  const [website, setWebsite] = React.useState("");
  const [aliases, setAliases] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const company = await create.mutateAsync({ name, website: website.trim() || null, aliases: parseAliasInput(aliases) });
      toast.success(`${company.name} added · the next research run picks it up`);
      setName("");
      setWebsite("");
      setAliases("");
    } catch (err) {
      setError(err instanceof ApiFetchError ? err.message : "Could not add the company.");
    }
  }

  return (
    <HudCard title="Add a company" spotlight={false}>
      <form
        onSubmit={onSubmit}
        aria-label="Add a company"
        className="grid gap-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
      >
        <div className="grid gap-1.5">
          <Label htmlFor="company-name">Name</Label>
          <Input id="company-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Meesho" required maxLength={255} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="company-website">Website (optional)</Label>
          <Input id="company-website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="meesho.com" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="company-aliases">Aliases (optional, comma-separated)</Label>
          <Input id="company-aliases" value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="Fashnear Technologies" />
        </div>
        <Button type="submit" disabled={create.isPending || !name.trim()}>
          {create.isPending ? "Adding…" : "Add company"}
        </Button>
      </form>
      {error ? <p role="alert" className="m-0 mt-3 text-[13px] text-destructive">{error}</p> : null}
    </HudCard>
  );
}
```

`apps/web/app/(app)/intelligence/_components/research/CompaniesTab.tsx`:

```tsx
"use client";

import * as React from "react";
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
      <Td><StatusDot state={status.dot} label={status.label} /></Td>
      <Td className="whitespace-nowrap text-[13px] text-muted-foreground">
        {company.research?.lastResearchedAt ? timeAgo(company.research.lastResearchedAt) : "—"}
      </Td>
      <Td className="font-mono text-[12px] text-muted-foreground">
        {company.publishedVersion ? `v${company.publishedVersion}` : company.publishedAt ? "seed" : "—"}
      </Td>
      <Td>
        <div className="flex flex-wrap justify-end gap-1.5">
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
      </Td>
    </Tr>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @interviewiq/web exec vitest run "app/(app)/intelligence/_components/research"`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run `git status`; leave the changes uncommitted.

---

