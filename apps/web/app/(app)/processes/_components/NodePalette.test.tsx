import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NODE_CATEGORIES, NODE_PRESETS, filterNodePresets } from "@/features/loops/presets";
import { PALETTE_MIME } from "@/features/loops/components/FlowCanvas";
import { MAX_INFO_NODES, MAX_ROUND_NODES } from "@/features/loops/graph";
import { NodePalette } from "./NodePalette";

const props = { onAdd: vi.fn(), disabled: false, roundCount: 1, infoCount: 0 };

describe("NodePalette", () => {
  beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null); });
  afterEach(() => { vi.restoreAllMocks(); });
  it("shows unique, categorized accessible cards with round and reference metadata", () => {
    const error = vi.spyOn(console, "error");
    render(<NodePalette {...props} />);
    expect(screen.getAllByRole("button", { name: /^Add / })).toHaveLength(NODE_PRESETS.length);
    expect(new Set(screen.getAllByRole("button", { name: /^Add / }).map((button) => button.getAttribute("aria-describedby"))).size).toBe(NODE_PRESETS.length);
    for (const category of NODE_CATEGORIES) expect(screen.getByRole("heading", { name: new RegExp(category.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })).toBeInTheDocument();
    const round = NODE_PRESETS.find((node) => node.kind === "round")!;
    const info = NODE_PRESETS.find((node) => node.kind === "info")!;
    expect(screen.getByRole("button", { name: `Add ${round.label}` })).toHaveTextContent(round.description);
    expect(screen.getByRole("button", { name: `Add ${info.label}` })).toHaveTextContent("Reference only");
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("shows the 30-45 minute label on round cards, even if a preset still holds another length", () => {
    const round = NODE_PRESETS.find((node) => node.kind === "round")!;
    const stored = round.durationMinutes;
    (round as { durationMinutes: number }).durationMinutes = 60; // simulate stale data; restored below
    try {
      render(<NodePalette {...props} />);
      const card = screen.getByRole("button", { name: `Add ${round.label}` });
      expect(card).toHaveTextContent("30-45 min · " + round.difficulty);
      expect(card).not.toHaveTextContent("60 min");
    } finally {
      (round as { durationMinutes: number }).durationMinutes = stored;
    }
  });

  it("finds technology, topics, and multiword matches, and clears search", async () => {
    const user = userEvent.setup();
    render(<NodePalette {...props} />);
    const search = screen.getByRole("textbox", { name: "Search nodes" });
    const technology = NODE_PRESETS.find((node) => /^React /.test(node.label))!;
    const topicNode = NODE_PRESETS.find((node) => node.topics.some((topic) => topic.includes(" ")))!;
    for (const query of [technology.label.split(" ")[0], "golang", topicNode.topics.find((topic) => topic.includes(" "))!, `${topicNode.label.split(" ")[0]} ${topicNode.topics[0]}`]) {
      await user.clear(search); await user.type(search, query);
      const matches = filterNodePresets(query);
      expect(matches.length).toBeGreaterThan(0);
      expect(screen.getAllByRole("button", { name: /^Add / })).toHaveLength(matches.length);
      expect(screen.getByRole("status")).toHaveTextContent(`${matches.length} ${matches.length === 1 ? "node" : "nodes"} found`);
    }
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(search).toHaveValue("");
    expect(screen.getAllByRole("button", { name: /^Add / })).toHaveLength(NODE_PRESETS.length);
  });

  it("filters with the themed category select and resets the no-match state", async () => {
    const user = userEvent.setup();
    render(<NodePalette {...props} />);
    const category = NODE_CATEGORIES[0];
    await user.click(screen.getByRole("combobox", { name: "Node category" }));
    await user.click(screen.getByRole("option", { name: category.label }));
    expect(screen.getAllByRole("button", { name: /^Add / })).toHaveLength(NODE_PRESETS.filter((node) => node.category === category.id).length);
    await user.type(screen.getByRole("textbox", { name: "Search nodes" }), "no-node-with-this-name-xyz");
    expect(screen.getByText("No matching nodes")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("0 nodes found");
    await user.click(screen.getByRole("button", { name: "Show all nodes" }));
    expect(screen.getByRole("combobox", { name: "Node category" })).toHaveTextContent("All categories");
    expect(screen.getByRole("textbox", { name: "Search nodes" })).toHaveValue("");
    expect(screen.getAllByRole("button", { name: /^Add / })).toHaveLength(NODE_PRESETS.length);
  });

  it("adds by keyboard and writes the validated catalogue ID to the existing drag MIME", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(<NodePalette {...props} onAdd={onAdd} />);
    const node = NODE_PRESETS.find((preset) => preset.kind === "info")!;
    const card = screen.getByRole("button", { name: `Add ${node.label}` });
    card.focus(); await user.keyboard("{Enter}");
    expect(onAdd).toHaveBeenCalledWith(node.id);
    expect(card).toHaveAccessibleDescription(new RegExp(node.topics[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const dataTransfer = { setData: vi.fn(), effectAllowed: "" };
    fireEvent.dragStart(card, { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith(PALETTE_MIME, `catalogue:${node.id}`);
    expect(dataTransfer.effectAllowed).toBe("copy");
  });

  it("disables the DOM controls and cancels drags during pending work", () => {
    const onAdd = vi.fn();
    const view = render(<NodePalette {...props} onAdd={onAdd} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search nodes" }), { target: { value: "sql" } });
    view.rerender(<NodePalette {...props} onAdd={onAdd} disabled />);
    const palette = screen.getByLabelText("Node palette");
    expect(palette).toHaveAttribute("inert");
    expect(screen.getByRole("textbox", { name: "Search nodes" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Node category" })).toBeDisabled();
    for (const button of within(palette).getAllByRole("button")) expect(button).toBeDisabled();
    const card = screen.getAllByRole("button", { name: /^Add / })[0];
    const dataTransfer = { setData: vi.fn(), effectAllowed: "" };
    expect(fireEvent.dragStart(card, { dataTransfer })).toBe(false);
    expect(dataTransfer.setData).not.toHaveBeenCalled();
    fireEvent.click(card);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("renders an isolated canvas drag image for a scrolled language card with a top-left hotspot", () => {
    const context = { fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn() };
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(context as unknown as CanvasRenderingContext2D);
    render(<NodePalette {...props} />);
    const results = screen.getByLabelText("Node results");
    results.scrollTop = 600;
    const node = NODE_PRESETS.find((preset) => preset.id === "java")!;
    const card = screen.getByRole("button", { name: `Add ${node.label}` });
    const dataTransfer = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: "" };
    fireEvent.dragStart(card, { dataTransfer });
    const image = dataTransfer.setDragImage.mock.calls[0][0] as HTMLCanvasElement;
    expect(dataTransfer.setDragImage).toHaveBeenCalledWith(image, 0, 0);
    expect(dataTransfer.setData).toHaveBeenCalledWith(PALETTE_MIME, `catalogue:${node.id}`);
    expect(dataTransfer.effectAllowed).toBe("copy");
    expect(image).toBeInstanceOf(HTMLCanvasElement);
    expect(image.width).toBe(240);
    expect(image.height).toBe(80);
    expect(image.parentElement).toBe(document.body);
    expect(results).not.toContainElement(image);
    expect(image.style.position).toBe("fixed");
    expect(image.style.left).toBe("-10000px");
    expect(image).toHaveAttribute("aria-hidden", "true");
    expect(image.textContent).toBe(`${node.label}lld · 30-45 min`);
    expect(image.querySelectorAll("[id]")).toHaveLength(0);
    for (const neighbor of NODE_PRESETS.filter((preset) => preset.category === "languages" && preset.id !== node.id)) expect(image).not.toHaveTextContent(neighbor.label);
    expect(context.fillText.mock.calls).toEqual([[node.label, 12, 28, 216], ["lld · 30-45 min", 12, 58, 216]]);
    expect(card).toHaveStyle({ userSelect: "none" });
    expect(card.querySelector("[draggable=true]")).toBeNull();
    expect(results.scrollTop).toBe(600);
    fireEvent.dragEnd(card);
    expect(image).not.toBeInTheDocument();
  });

  it.each(["drop", "dragend", "escape", "blur", "unmount", "pending"])("removes the exact single-reference drag image after %s", (ending) => {
    const view = render(<NodePalette {...props} />);
    const node = NODE_PRESETS.find((preset) => preset.kind === "info")!;
    const card = screen.getByRole("button", { name: `Add ${node.label}` });
    const dataTransfer = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: "" };
    fireEvent.dragStart(card, { dataTransfer });
    const image = dataTransfer.setDragImage.mock.calls[0][0] as HTMLElement;
    // No canvas renderer: the plain fallback still contains only this node.
    expect(image.tagName).toBe("DIV");
    expect(image.textContent).toBe(`${node.label}Reference only`);
    expect(image).toBeInTheDocument();
    if (ending === "drop") fireEvent.drop(document.body);
    if (ending === "dragend") fireEvent.dragEnd(card);
    if (ending === "escape") fireEvent.keyDown(document, { key: "Escape" });
    if (ending === "blur") fireEvent.blur(window);
    if (ending === "unmount") view.unmount();
    if (ending === "pending") view.rerender(<NodePalette {...props} disabled />);
    expect(image).not.toBeInTheDocument();
    // A later native dragend after cancellation is harmless.
    fireEvent.dragEnd(document.body);
  });

  it("suppresses the drag-side click and permits subsequent pointer and keyboard additions", async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(<NodePalette {...props} onAdd={onAdd} />);
    const node = NODE_PRESETS[0];
    const card = screen.getByRole("button", { name: `Add ${node.label}` });
    const dataTransfer = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: "" };
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.drop(document.body);
    fireEvent.dragEnd(card);
    fireEvent.click(card);
    expect(onAdd).not.toHaveBeenCalled();
    await user.click(card);
    expect(onAdd).toHaveBeenCalledTimes(1);
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.keyDown(document, { key: "Escape" });
    card.focus();
    await user.keyboard("{Enter}");
    expect(onAdd).toHaveBeenCalledTimes(2);
  });

  it("blocks capped round and reference drags and clicks, including nested text drags", () => {
    const onAdd = vi.fn();
    const view = render(<NodePalette {...props} onAdd={onAdd} roundCount={MAX_ROUND_NODES} infoCount={MAX_INFO_NODES} />);
    for (const kind of ["round", "info"]) {
      const node = NODE_PRESETS.find((preset) => preset.kind === kind)!;
      const card = screen.getByRole("button", { name: `Add ${node.label}` });
      const dataTransfer = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: "" };
      expect(card).toHaveAttribute("draggable", "false");
      expect(fireEvent.dragStart(card, { dataTransfer })).toBe(false);
      expect(dataTransfer.setData).not.toHaveBeenCalled();
      expect(dataTransfer.setDragImage).not.toHaveBeenCalled();
      fireEvent.click(card);
    }
    expect(onAdd).not.toHaveBeenCalled();
    view.rerender(<NodePalette {...props} onAdd={onAdd} />);
    const card = screen.getByRole("button", { name: `Add ${NODE_PRESETS[0].label}` });
    const dataTransfer = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: "" };
    expect(fireEvent.dragStart(within(card).getByText(NODE_PRESETS[0].label), { dataTransfer })).toBe(false);
    expect(dataTransfer.setData).not.toHaveBeenCalled();
    expect(dataTransfer.setDragImage).not.toHaveBeenCalled();
  });

  it("keeps active search/category values and replaces rather than accumulates previews", async () => {
    const user = userEvent.setup();
    const view = render(<NodePalette {...props} />);
    await user.click(screen.getByRole("combobox", { name: "Node category" }));
    await user.click(screen.getByRole("option", { name: "Programming languages" }));
    const search = screen.getByRole("textbox", { name: "Search nodes" });
    await user.type(search, "engineering");
    const cards = screen.getAllByRole("button", { name: /^Add / });
    const dataTransfer = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: "" };
    fireEvent.dragStart(cards[0], { dataTransfer });
    const first = dataTransfer.setDragImage.mock.calls[0][0] as HTMLElement;
    fireEvent.dragStart(cards[1], { dataTransfer });
    const second = dataTransfer.setDragImage.mock.calls[1][0] as HTMLElement;
    expect(first).not.toBeInTheDocument();
    expect(second).toBeInTheDocument();
    fireEvent.drop(document.body);
    expect(second).not.toBeInTheDocument();
    expect(search).toHaveValue("engineering");
    expect(screen.getByRole("combobox", { name: "Node category" })).toHaveTextContent("Programming languages");
    // Minimal DataTransfer shims still support the MIME contract without a preview API.
    const plainTransfer = { setData: vi.fn(), effectAllowed: "" };
    fireEvent.dragStart(cards[0], { dataTransfer: plainTransfer });
    expect(plainTransfer.setData).toHaveBeenCalledWith(PALETTE_MIME, expect.stringMatching(/^catalogue:/));
    expect(plainTransfer.effectAllowed).toBe("copy");
    view.unmount();
  });
});
