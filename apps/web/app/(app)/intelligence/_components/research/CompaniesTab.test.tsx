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

  it("opens the full enrichment editor from each company", () => {
    render(<CompaniesTab />);
    expect(within(row("Razorpay")).getByRole("link", { name: "Enrich company" })).toHaveAttribute("href", `/intelligence/companies/${RAZORPAY.id}/edit`);
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
