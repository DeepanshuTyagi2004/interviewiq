import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { newRoundNode } from "@/features/loops/graph";
import type { InterviewProcess, ProcessGraph } from "@/features/loops/types";
import { NODE_PRESETS } from "@/features/loops/presets";
import { ProcessEditor } from "./ProcessEditor";

const mocks = vi.hoisted(() => ({ data: null as InterviewProcess | null, graph: null as ProcessGraph | null, drop: null as null | ((payload: string, position: { x: number; y: number }) => void), change: null as null | ((graph: ProcessGraph) => void), update: vi.fn(), confirm: vi.fn(), push: vi.fn(), error: vi.fn(), pending: false }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: mocks.error } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/components/hud", () => ({ HudZoomOff: () => null }));
vi.mock("@/features/loops", async (original) => ({
  ...(await original<typeof import("@/features/loops")>()),
  useProcess: () => ({ data: mocks.data }), useOfficialProcess: () => ({}),
  useUpdateProcess: () => ({ mutateAsync: mocks.update, isPending: mocks.pending }),
  useConfirmLoop: () => ({ mutate: mocks.confirm, isPending: false }),
}));
vi.mock("@/features/loops/components/FlowCanvas", () => ({
  PALETTE_MIME: "application/test-preset",
  FlowCanvas: ({ graph, onSelect, onDropPreset, onGraphChange }: { graph: ProcessGraph; onSelect: (id: string) => void; onDropPreset: (payload: string, position: { x: number; y: number }) => void; onGraphChange: (graph: ProcessGraph) => void }) => {
    mocks.graph = graph; mocks.drop = onDropPreset; mocks.change = onGraphChange;
    return <div>
    {graph.nodes.map((node) => <button key={node.id} onClick={() => onSelect(node.id)}>Inspect {node.name}</button>)}
    <button onClick={() => onDropPreset("round:unsupported", { x: 1, y: 1 })}>Invalid drop</button>
  </div>;
  },
}));

beforeEach(() => {
  vi.clearAllMocks(); mocks.pending = false;
  mocks.data = { id: "p-1", name: "My process", level: "sde3", jd: null, graph: { nodes: [newRoundNode("dsa", { x: 0, y: 0 })], edges: [] }, createdAt: "2030-01-01", updatedAt: "2030-01-01" };
  mocks.update.mockImplementation(async (body) => ({ ...mocks.data!, ...body }));
});

describe("ProcessEditor", () => {
  it("blocks save and start for an unknown saved level until explicitly repaired", async () => {
    const user = userEvent.setup();
    mocks.data = { ...mocks.data!, level: null, legacyLevel: "Career switcher" };
    render(<ProcessEditor processId="p-1" />);
    expect(screen.getByRole("combobox", { name: "Process level" })).toHaveTextContent("Choose a level");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Start track" })).toBeDisabled();
    await user.click(screen.getByRole("combobox", { name: "Process level" }));
    expect(screen.getAllByRole("option")).toHaveLength(9);
    await user.click(screen.getByRole("option", { name: "Distinguished" }));
    await user.click(screen.getByRole("button", { name: "Start track" }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    expect(mocks.update.mock.calls[0][0].level).toBe("distinguished");
  });
  it("disables pending edits and prevents repeated standalone start callbacks", async () => {
    const user = userEvent.setup();
    const view = render(<ProcessEditor processId="p-1" />);
    await user.dblClick(screen.getByRole("button", { name: "Start track" }));
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    const preset = NODE_PRESETS.find((node) => node.kind === "round")!;
    await user.click(screen.getByRole("button", { name: `Add ${preset.label}` }));
    act(() => mocks.drop!(`catalogue:${preset.id}`, { x: 1, y: 2 }));
    expect(mocks.graph!.nodes).toHaveLength(1);
    mocks.pending = true;
    view.rerender(<ProcessEditor processId="p-1" />);
    expect(screen.getByRole("textbox", { name: "Process name" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Process level" })).toBeDisabled();
    expect(screen.getByLabelText("Node palette")).toHaveAttribute("inert");
  });
  it("saves natural-language guidance, stable comma-separated topics and round difficulty", async () => {
    const user = userEvent.setup();
    render(<ProcessEditor processId="p-1" />);
    await user.click(screen.getByRole("button", { name: "Inspect Coding & algorithms" }));
    const topics = screen.getByRole("textbox", { name: "Topics" });
    await user.clear(topics);
    await user.type(topics, "SQL, joins, ");
    expect(topics).toHaveValue("SQL, joins, ");
    await user.type(topics, "indexes");
    await user.clear(screen.getByRole("textbox", { name: "Interviewer instructions" }));
    await user.type(screen.getByRole("textbox", { name: "Interviewer instructions" }), "Ask for query trade-offs; follow up on correctness.");
    await user.click(screen.getByRole("combobox", { name: "Difficulty" }));
    await user.click(screen.getByRole("option", { name: "Hard" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(mocks.update.mock.calls[0][0]).toMatchObject({ name: "My process", level: "sde3", graph: { nodes: [{ topics: ["SQL", "joins", "indexes"], difficulty: "hard", instructions: "Ask for query trade-offs; follow up on correctness." }] } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled());
  });

  it("uses canonical save results, trims the name, and starts a standalone track with an enum level", async () => {
    const user = userEvent.setup();
    render(<ProcessEditor processId="p-1" />);
    const name = screen.getByRole("textbox", { name: "Process name" });
    await user.clear(name); await user.type(name, "  My edited process  ");
    const level = screen.getByRole("combobox", { name: "Process level" });
    await user.click(level); await user.click(screen.getByRole("option", { name: "Staff" }));
    await user.click(screen.getByRole("button", { name: "Start track" }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    expect(mocks.confirm.mock.calls[0][0]).toEqual({ processId: "p-1" });
    expect(name).toHaveValue("My edited process");
    expect(level).toHaveTextContent("Staff");
    expect(mocks.update.mock.calls[0][0].level).toBe("staff");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("rejects unsupported drop types and exposes a themed leave confirmation for unsaved changes", async () => {
    const user = userEvent.setup();
    render(<ProcessEditor processId="p-1" />);
    await user.click(screen.getByRole("button", { name: "Invalid drop" }));
    expect(screen.getAllByRole("button", { name: /^Inspect / })).toHaveLength(1);
    await user.type(screen.getByRole("textbox", { name: "Process name" }), " edited");
    await user.click(screen.getByRole("button", { name: "Interview processes" }));
    expect(screen.getByRole("dialog", { name: "Leave without saving?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.push).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Interview processes" }));
    await user.click(screen.getByRole("button", { name: "Leave editor" }));
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith("/processes");
  });

  it("blocks save for overlong topics instead of silently truncating them", async () => {
    const user = userEvent.setup();
    render(<ProcessEditor processId="p-1" />);
    await user.click(screen.getByRole("button", { name: "Inspect Coding & algorithms" }));
    await user.clear(screen.getByRole("textbox", { name: "Topics" }));
    await user.type(screen.getByRole("textbox", { name: "Topics" }), "t".repeat(81));
    expect(screen.getByRole("textbox", { name: "Topics" })).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("adds catalogue round guidance and saves the canonical catalogue-backed fields", async () => {
    const user = userEvent.setup();
    const preset = NODE_PRESETS.find((node) => node.kind === "round" && node.instructions && node.topics.length)!;
    render(<ProcessEditor processId="p-1" />);
    await user.click(screen.getByRole("button", { name: `Add ${preset.label}` }));
    expect(screen.getByRole("textbox", { name: "Interviewer instructions" })).toHaveValue(preset.instructions);
    expect(screen.getByRole("textbox", { name: "Topics" })).toHaveValue(preset.topics.join(", "));
    expect(screen.getByRole("combobox", { name: "Difficulty" })).toHaveTextContent(new RegExp(preset.difficulty, "i"));
    expect(mocks.graph!.edges).toHaveLength(1);
    mocks.update.mockImplementation(async (body) => ({ ...mocks.data!, ...body, name: "Canonical process" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(mocks.update.mock.calls[0][0].graph.nodes[1]).toMatchObject({ kind: "round", name: preset.label, topics: preset.topics, instructions: preset.instructions, difficulty: preset.difficulty });
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Process name" })).toHaveValue("Canonical process"));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("adds searchable reference steps without edges or runnable round counts", async () => {
    const user = userEvent.setup();
    const preset = NODE_PRESETS.find((node) => node.kind === "info")!;
    render(<ProcessEditor processId="p-1" />);
    await user.type(screen.getByRole("textbox", { name: "Search nodes" }), preset.label);
    await user.click(screen.getByRole("button", { name: `Add ${preset.label}` }));
    expect(mocks.graph!.nodes[1]).toMatchObject({ kind: "info", name: preset.label, note: preset.kind === "info" ? preset.note : "", topics: preset.topics, instructions: preset.instructions });
    expect(mocks.graph!.nodes.filter((node) => node.kind === "round")).toHaveLength(1);
    expect(mocks.graph!.edges).toHaveLength(0);
    expect(screen.queryByRole("combobox", { name: "Round type" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(mocks.update.mock.calls[0][0].graph.nodes[1].kind).toBe("info");
  });

  it("validates catalogue IDs and preserves legacy drag payloads without auto-connecting drops", () => {
    render(<ProcessEditor processId="p-1" />);
    act(() => { mocks.drop!("catalogue:unknown", { x: 11, y: 22 }); mocks.drop!("catalogue:__proto__", { x: 11, y: 22 }); });
    expect(mocks.graph!.nodes).toHaveLength(1);
    const round = NODE_PRESETS.find((node) => node.kind === "round")!;
    const info = NODE_PRESETS.find((node) => node.kind === "info")!;
    for (const payload of [`catalogue:${round.id}`, `catalogue:${info.id}`, "preset:sql-data", "round:behavioural", "info"]) act(() => mocks.drop!(payload, { x: 11, y: 22 }));
    expect(mocks.graph!.nodes).toHaveLength(6);
    expect(mocks.graph!.nodes.slice(1).every((node) => node.position.x === 11 && node.position.y === 22)).toBe(true);
    expect(mocks.graph!.edges).toHaveLength(0);
  });

  it("chains after the most recently stored round, not x-order, and retains same-tick canvas changes", async () => {
    const user = userEvent.setup();
    const first = newRoundNode("dsa", { x: 900, y: 0 });
    const latest = newRoundNode("behavioural", { x: -300, y: 0 });
    mocks.data!.graph = { nodes: [first, latest], edges: [{ source: first.id, target: latest.id }] };
    render(<ProcessEditor processId="p-1" />);
    const preset = NODE_PRESETS.find((node) => node.kind === "round")!;
    await user.click(screen.getByRole("button", { name: `Add ${preset.label}` }));
    expect(mocks.graph!.edges.at(-1)!.source).toBe(latest.id);
    const moved = { ...mocks.graph!, nodes: mocks.graph!.nodes.map((node) => ({ ...node, position: { x: 555, y: 999 } })) };
    act(() => { mocks.change!(moved); mocks.drop!(`catalogue:${preset.id}`, { x: 1, y: 2 }); });
    expect(mocks.graph!.nodes[0].position).toEqual({ x: 555, y: 999 });
    expect(mocks.graph!.nodes).toHaveLength(4);
  });

  it("prefers the selected round over the most recently stored round when clicking to add", async () => {
    const user = userEvent.setup();
    const first = newRoundNode("dsa", { x: 0, y: 0 });
    const latest = newRoundNode("behavioural", { x: 300, y: 0 });
    mocks.data!.graph = { nodes: [first, latest], edges: [{ source: first.id, target: latest.id }] };
    render(<ProcessEditor processId="p-1" />);
    await user.click(screen.getByRole("button", { name: `Inspect ${first.name}` }));
    const preset = NODE_PRESETS.find((node) => node.kind === "round")!;
    await user.click(screen.getByRole("button", { name: `Add ${preset.label}` }));
    expect(mocks.graph!.edges.at(-1)).toEqual({ source: first.id, target: mocks.graph!.nodes.at(-1)!.id });
  });

  it.each(["round", "info"] as const)("enforces the %s cap on click and drop without changing the graph", async (kind) => {
    const user = userEvent.setup();
    const preset = NODE_PRESETS.find((node) => node.kind === kind)!;
    render(<ProcessEditor processId="p-1" />);
    const { newCatalogueNode } = await import("@/features/loops/graph");
    const capped = { nodes: [ ...(kind === "info" ? mocks.graph!.nodes : []), ...Array.from({ length: 12 }, (_, index) => newCatalogueNode(preset.id, { x: index * 100, y: 0 })) ], edges: [] };
    act(() => { mocks.change!(capped); mocks.drop!(`catalogue:${preset.id}`, { x: 1, y: 2 }); });
    await user.click(screen.getByRole("button", { name: `Add ${preset.label}` }));
    act(() => mocks.drop!(`catalogue:${preset.id}`, { x: 1, y: 2 }));
    expect(mocks.graph).toEqual(capped);
    expect(screen.getByRole("button", { name: `Add ${preset.label}` })).toHaveAttribute("draggable", "false");
    expect(mocks.error).toHaveBeenCalledTimes(2);
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("at most 12"));
  });

  it("ignores pending drop callbacks and restores editing after pending work is cancelled", async () => {
    const user = userEvent.setup();
    mocks.pending = true;
    const view = render(<ProcessEditor processId="p-1" />);
    const preset = NODE_PRESETS.find((node) => node.kind === "round")!;
    expect(screen.getByRole("button", { name: `Add ${preset.label}` })).toBeDisabled();
    act(() => mocks.drop!(`catalogue:${preset.id}`, { x: 1, y: 2 }));
    expect(mocks.graph!.nodes).toHaveLength(1);
    mocks.pending = false; view.rerender(<ProcessEditor processId="p-1" />);
    await user.click(screen.getByRole("button", { name: `Add ${preset.label}` }));
    expect(mocks.graph!.nodes).toHaveLength(2);
  });
});
