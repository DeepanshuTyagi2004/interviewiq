import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiFetchError, apiFetch } from "@/lib/api-client/client";
import { enrichmentKey, newRole, newRound, type EnrichmentResponse, type EnrichmentWriteRequest } from "@/features/research/enrichment";
import { makeCompany } from "@/features/research/testing";
import { EnrichmentEditor } from "./EnrichmentEditor";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: navigation.push }) }));

vi.mock("@/lib/api-client/client", async (original) => ({ ...(await original<typeof import("@/lib/api-client/client")>()), apiFetch: vi.fn() }));
vi.mock("@/features/research", async (original) => ({ ...(await original<typeof import("@/features/research")>()), useAdminCompanies: () => ({ data: { companies: [makeCompany()] } }) }));
vi.mock("@xyflow/react", () => ({
  Position: { Right: "right", Left: "left" },
  ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
  ReactFlow: ({ nodes, edges, onNodeClick, onNodesChange, nodesDraggable }: { nodes: Array<{ id: string; data: { label: ReactNode } }>; edges: Array<{ source: string; target: string }>; onNodeClick: (event: unknown, node: unknown) => void; onNodesChange: (changes: unknown[]) => void; nodesDraggable: boolean }) => <div data-testid="round-canvas" data-edges={JSON.stringify(edges)}>{nodes.map((node) => <div key={node.id}><button onClick={() => onNodeClick({}, node)}>{node.data.label}</button><button disabled={!nodesDraggable} aria-label={`Drag ${node.id}`} onClick={() => onNodesChange([{ type: "position", id: node.id, position: { x: 60, y: 90 } }])}>Drag</button></div>)}</div>,
  Background: () => null,
  Controls: () => null,
}));

const ID = makeCompany().id;
const PATH = `/api/v1/admin/companies/${ID}/enrichment`;
let server: EnrichmentResponse;
let failWrite: ApiFetchError | null;
let normalizedTitle: string | null;
let prefillResult: EnrichmentResponse | null;
let failPrefill: ApiFetchError | null;

function fixture(): EnrichmentResponse {
  return { revision: 2, publishedRevision: null, publishedAt: null, verifiedBy: null, document: {
    company: { overview: "Verified overview", culture: "", benefits: "", sourceUrls: ["https://example.com/about"], verified: true },
    roles: [{ ...newRole(), title: "Platform engineer", role: "backend", level: "sde2", description: "Build reliable services.", sourceUrls: ["https://example.com/jobs"], verified: true,
      rounds: [{ ...newRound(), name: "Technical", sourceUrls: ["https://example.com/interviews"], verified: true }, { ...newRound(), name: "Discussion", sourceUrls: ["https://example.com/interviews"], verified: true }] }],
  } };
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { ...render(<QueryClientProvider client={client}><EnrichmentEditor companyId={ID} /></QueryClientProvider>), client };
}

beforeEach(() => {
  vi.clearAllMocks();
  server = fixture(); failWrite = null; normalizedTitle = null;
  prefillResult = null; failPrefill = null;
  vi.mocked(apiFetch).mockImplementation(async (path, options) => {
    if (path === PATH && !options?.method) return structuredClone(server);
    if (path === `${PATH}/prefill` && options?.method === "POST") {
      if (failPrefill) throw failPrefill;
      expect(options.json).toEqual({ revision: server.revision });
      server = structuredClone(prefillResult ?? server);
      return structuredClone(server);
    }
    if ((path === PATH && options?.method === "PUT") || (path === `${PATH}/publish` && options?.method === "POST")) {
      if (failWrite) throw failWrite;
      const body = options.json as EnrichmentWriteRequest;
      expect(body.revision).toBe(server.revision);
      server = { ...server, revision: server.revision + 1, document: structuredClone(body.document) };
      if (path.endsWith("/publish")) { server.publishedRevision = server.revision; server.publishedAt = "2026-10-03T10:00:00Z"; server.verifiedBy = ID; server.document.roles[0]!.jdId = ID; }
      if (normalizedTitle) server.document.roles[0]!.title = normalizedTitle;
      return structuredClone(server);
    }
    throw new Error(`Unexpected request: ${path}`);
  });
});

describe("EnrichmentEditor", () => {
  it("confirms leaving dirty work without publishing and lets cancellation preserve edits", async () => {
    mount(); await screen.findByLabelText("Company overview");
    fireEvent.change(screen.getByLabelText("Company overview"), { target: { value: "Unsaved correction" } });
    await userEvent.click(screen.getByRole("link", { name: "Back to companies" }));
    const dialog = screen.getByRole("dialog", { name: "Leave enrichment editor?" });
    expect(dialog).toHaveAccessibleDescription("Your unsaved changes will be lost.");
    expect(navigation.push).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("Company overview")).toHaveValue("Unsaved correction");
    await userEvent.click(screen.getByRole("link", { name: "Back to companies" }));
    await userEvent.click(screen.getByRole("button", { name: "Leave without saving" }));
    expect(navigation.push).toHaveBeenCalledTimes(1);
    expect(navigation.push).toHaveBeenCalledWith("/intelligence?tab=companies");
    expect(vi.mocked(apiFetch).mock.calls.every(([, options]) => !options?.method)).toBe(true);
  });

  it("confirms role removal in a draft-only dialog and does not save or publish it", async () => {
    mount(); await screen.findByLabelText("Company overview");
    await userEvent.click(screen.getByRole("button", { name: "Remove role profile" }));
    const dialog = screen.getByRole("dialog", { name: "Remove role profile?" });
    expect(dialog).toHaveAccessibleDescription(/Platform engineer and all its rounds/);
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("Job title")).toHaveValue("Platform engineer");
    await userEvent.click(screen.getByRole("button", { name: "Remove role profile" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove role and rounds" }));
    expect(screen.queryByLabelText("Job title")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(vi.mocked(apiFetch).mock.calls.every(([, options]) => !options?.method)).toBe(true);
  });
  it("shows initial research-prefilled fields as editable and unverified", async () => {
    server.document.company = { overview: "Collected company overview", culture: "", benefits: "", sourceUrls: ["https://example.com/research"], verified: false };
    server.document.roles[0]!.verified = false;
    mount();
    expect(await screen.findByLabelText("Company overview")).toHaveValue("Collected company overview");
    expect(screen.getByLabelText("Company overview")).toBeEnabled();
    expect(screen.getByLabelText("Company source URLs (one per line)")).toHaveValue("https://example.com/research");
    expect(screen.getByLabelText(/I verified the company/)).not.toBeChecked();
    expect(screen.getByLabelText(/I verified this role profile/)).not.toBeChecked();
    expect(screen.getByText(/Remaining blanks need research or manual additions/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Company overview"), { target: { value: "Reviewer correction" } });
    expect(screen.getByLabelText("Company overview")).toHaveValue("Reviewer correction");
  });

  it("requires saving edits before confirmed prefill and uses the saved revision", async () => {
    mount(); await screen.findByLabelText("Company overview");
    fireEvent.change(screen.getByLabelText("Company overview"), { target: { value: "Reviewer overview" } });
    expect(screen.getByRole("button", { name: "Fill missing from research" })).toBeDisabled();
    expect(screen.getByText("Save draft first to fill missing fields from research.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await screen.findByText(/Draft saved/);
    prefillResult = structuredClone(server);
    prefillResult.revision = 4;
    prefillResult.document.company.culture = "Collected culture";
    prefillResult.document.roles.push({ ...newRole(), title: "Research role", description: "Research description", sourceUrls: ["https://example.com/new-role"] });
    await userEvent.click(screen.getByRole("button", { name: "Fill missing from research" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Existing content and verified sections are preserved/)).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalledWith(`${PATH}/prefill`, expect.anything());
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm & fill missing fields" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Research prefilled for review");
    expect(screen.getByRole("status")).toHaveTextContent("still unverified");
    expect(apiFetch).toHaveBeenCalledWith(`${PATH}/prefill`, { method: "POST", json: { revision: 3 } });
    expect(screen.getByLabelText("Company overview")).toHaveValue("Reviewer overview");
    expect(screen.getByLabelText("Culture")).toHaveValue("Collected culture");
    expect(screen.getByRole("button", { name: "Fill missing from research" })).toBeEnabled();
    const roles = screen.getByRole("group", { name: "Role profiles" });
    await userEvent.click(within(roles).getByRole("button", { name: /Research role/ }));
    expect(screen.getByLabelText("Job description")).toHaveValue("Research description");
    expect(screen.getByLabelText(/I verified this role profile/)).not.toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Fill missing from research" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm & fill missing fields" }));
    expect(await screen.findByRole("status")).toHaveTextContent("No additional sourced research");
    expect(within(roles).getAllByRole("button")).toHaveLength(2);
    expect(apiFetch).toHaveBeenLastCalledWith(`${PATH}/prefill`, { method: "POST", json: { revision: 4 } });
    expect(server.publishedAt).toBeNull();
  });

  it("allows a saved blank draft to request research and explains when no data fills it", async () => {
    server.document = { company: { overview: "", culture: "", benefits: "", sourceUrls: [], verified: false }, roles: [] };
    mount(); await screen.findByLabelText("Company overview");
    await userEvent.click(screen.getByRole("button", { name: "Fill missing from research" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm & fill missing fields" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Your content is unchanged; remaining blanks need research or manual additions");
    expect(screen.getByLabelText("Company overview")).toHaveValue("");
    expect(screen.getByRole("group", { name: "Role profiles" })).toBeEmptyDOMElement();
    expect(server.revision).toBe(2);
  });

  it("locks editing and prevents duplicate imports while filling", async () => {
    mount(); await screen.findByLabelText("Company overview");
    await userEvent.click(screen.getByRole("button", { name: "Fill missing from research" }));
    let finish!: (value: EnrichmentResponse) => void;
    vi.mocked(apiFetch).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await userEvent.dblClick(screen.getByRole("button", { name: "Confirm & fill missing fields" }));
    expect(screen.getByRole("button", { name: "Filling…" })).toBeDisabled();
    expect(screen.getByLabelText("Company overview")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save draft", hidden: true })).toBeDisabled();
    expect(vi.mocked(apiFetch).mock.calls.filter(([path]) => path === `${PATH}/prefill`)).toHaveLength(1);
    finish(structuredClone(server));
    await screen.findByText(/No additional sourced research/);
    expect(screen.getByLabelText("Company overview")).toBeEnabled();
  });

  it.each([400, 409])("preserves the document and allows further editing after prefill error %s", async (status) => {
    failPrefill = new ApiFetchError(status, status === 409 ? "revision_conflict" : "invalid_enrichment", "Research unavailable");
    mount(); await screen.findByLabelText("Company overview");
    await userEvent.click(screen.getByRole("button", { name: "Fill missing from research" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm & fill missing fields" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(status === 409 ? "Your unsaved edits are still here" : "Research unavailable");
    expect(screen.getByLabelText("Company overview")).toHaveValue("Verified overview");
    expect(screen.getByLabelText("Job description")).toHaveValue("Build reliable services.");
    fireEvent.change(screen.getByLabelText("Culture"), { target: { value: "Retained reviewer edit" } });
    expect(screen.getByLabelText("Culture")).toHaveValue("Retained reviewer edit");
    expect(vi.mocked(apiFetch).mock.calls.filter(([path]) => path === `${PATH}/prefill`)).toHaveLength(1);
    if (status === 409) {
      expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
      await userEvent.click(screen.getByRole("button", { name: "Load latest draft…" }));
      await userEvent.click(screen.getByRole("button", { name: "Keep my edits" }));
      expect(screen.getByLabelText("Culture")).toHaveValue("Retained reviewer edit");
    } else {
      expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();
      failWrite = new ApiFetchError(503, undefined, "Save temporarily unavailable");
      await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Save temporarily unavailable");
      expect(screen.getByLabelText("Culture")).toHaveValue("Retained reviewer edit");
    }
  });

  it("does not replace a dirty editor when a background query returns newer research", async () => {
    const { client } = mount(); await screen.findByLabelText("Company overview");
    fireEvent.change(screen.getByLabelText("Company overview"), { target: { value: "Unsaved reviewer work" } });
    const newer = structuredClone(server);
    newer.revision += 1;
    newer.document.company.overview = "New research";
    await act(async () => { client.setQueryData(enrichmentKey(ID), newer); });
    expect(screen.getByLabelText("Company overview")).toHaveValue("Unsaved reviewer work");
    expect(screen.getByRole("button", { name: "Fill missing from research" })).toBeDisabled();
  });

  it("saves a private draft, clears changed verification and restores it when reopened", async () => {
    const view = mount();
    await screen.findByLabelText("Company overview");
    fireEvent.change(screen.getByLabelText("Company overview"), { target: { value: "Manually edited overview" } });
    expect(screen.getByLabelText(/I verified the company/)).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Submit & publish" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText(/Draft saved/)).toBeInTheDocument();
    expect(server.document.company.overview).toBe("Manually edited overview");
    expect(server.publishedAt).toBeNull();
    view.unmount(); mount();
    expect(await screen.findByLabelText("Company overview")).toHaveValue("Manually edited overview");
  });

  it("publishes only after immediate-public confirmation and adopts normalized server output", async () => {
    normalizedTitle = "Canonical platform engineer";
    mount(); await screen.findByLabelText("Company overview");
    await userEvent.click(screen.getByRole("button", { name: "Submit & publish" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/public immediately/)).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalledWith(`${PATH}/publish`, expect.anything());
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm & publish immediately" }));
    await screen.findByText(/Published\. The verified/);
    expect(screen.getByLabelText("Job title")).toHaveValue("Canonical platform engineer");
    expect(server.document.roles[0]!.jdId).toBe(ID);
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(server.revision).toBe(4));
    expect(server.document.roles[0]!.jdId).toBe(ID);
  });

  it("preserves every unsaved edit on revision conflict without retrying", async () => {
    failWrite = new ApiFetchError(409, "revision_conflict", "stale revision");
    mount(); await screen.findByLabelText("Company overview");
    fireEvent.change(screen.getByLabelText("Job description"), { target: { value: "Do not lose this edit" } });
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your unsaved edits are still here");
    expect(screen.getByLabelText("Job description")).toHaveValue("Do not lose this edit");
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
    expect(vi.mocked(apiFetch).mock.calls.filter(([, options]) => options?.method === "PUT")).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Load latest draft…" }));
    await userEvent.click(screen.getByRole("button", { name: "Keep my edits" }));
    expect(screen.getByLabelText("Job description")).toHaveValue("Do not lose this edit");
  });

  it("surfaces load and save errors while retaining editable content", async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(new ApiFetchError(503, undefined, "Temporarily unavailable"));
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Temporarily unavailable");
    await userEvent.click(screen.getByRole("button", { name: "Retry loading" }));
    await screen.findByLabelText("Company overview");
    failWrite = new ApiFetchError(400, "invalid_enrichment", "Check source URLs");
    fireEvent.change(screen.getByLabelText("Culture"), { target: { value: "Edited culture" } });
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Check source URLs");
    expect(screen.getByLabelText("Culture")).toHaveValue("Edited culture");
    expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();
  });

  it("changes persisted order through accessible controls, while dragging only changes the canvas", async () => {
    mount(); await screen.findByLabelText("Company overview");
    const [first, second] = server.document.roles[0]!.rounds;
    expect(screen.getByRole("button", { name: `Drag ${first!.id}` })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Expand rounds" }));
    await userEvent.click(screen.getByRole("button", { name: `Drag ${first!.id}` }));
    await userEvent.keyboard("{Escape}");
    expect(screen.getByLabelText(/I verified this role profile/)).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Move round 1 down" }));
    expect(screen.getByLabelText(/I verified this role profile/)).not.toBeChecked();
    expect(screen.getByTestId("round-canvas").getAttribute("data-edges")).toContain(`"source":"${second!.id}","target":"${first!.id}"`);
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await screen.findByText(/Draft saved/);
    expect(server.document.roles[0]!.rounds.map((r) => r.id)).toEqual([second!.id, first!.id]);
    expect(server.document.roles[0]!.rounds[0]).not.toHaveProperty("position");
  });

  it("invalidates both round and role verification when round content changes", async () => {
    mount(); await screen.findByLabelText("Round name");
    fireEvent.change(screen.getByLabelText("Round name"), { target: { value: "Updated technical" } });
    expect(screen.getByLabelText(/I verified this round/)).not.toBeChecked();
    expect(screen.getByLabelText(/I verified this role profile/)).not.toBeChecked();
    expect(screen.getByLabelText(/I verified the company/)).toBeChecked();
  });

  it("locks editing and duplicate submissions while a save is pending", async () => {
    mount(); await screen.findByLabelText("Company overview");
    let finish!: (value: EnrichmentResponse) => void;
    vi.mocked(apiFetch).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(screen.getByRole("button", { name: "Saving draft…" })).toBeDisabled();
    expect(screen.getByLabelText("Company overview")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Submit & publish" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Round type" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Difficulty" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove role profile" })).toBeDisabled();
    await userEvent.click(screen.getByRole("link", { name: "Back to companies" }));
    expect(navigation.push).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Leave enrichment editor?" })).not.toBeInTheDocument();
    finish({ ...server, revision: 3 });
    await screen.findByText(/Draft saved/);
    expect(screen.getByLabelText("Company overview")).toBeEnabled();
  });

  it("adds independent role profiles and round content without overwriting another role", async () => {
    mount(); await screen.findByLabelText("Job title");
    await userEvent.click(screen.getByRole("button", { name: "Add role profile" }));
    expect(screen.getByLabelText("Job title")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Job title"), { target: { value: "Second job" } });
    await userEvent.click(screen.getByRole("button", { name: "Add round" }));
    fireEvent.change(screen.getByLabelText("Round name"), { target: { value: "New round" } });
    await userEvent.click(within(screen.getByRole("group", { name: "Role profiles" })).getByRole("button", { name: /Platform engineer/ }));
    expect(screen.getByLabelText("Job title")).toHaveValue("Platform engineer");
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await screen.findByText(/Draft saved/);
    expect(server.document.roles).toHaveLength(2);
    expect(server.document.roles[1]!.rounds[0]!.name).toBe("New round");
    expect(server.document.roles[0]!.rounds).toHaveLength(2);
  });
});
