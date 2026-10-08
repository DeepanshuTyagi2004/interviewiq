import { useState, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { selectOption } from "@/tests/helpers/select-option";
import { newRole, newRound, type EnrichmentRole } from "@/features/research/enrichment";
import { RoleEditor } from "./RoleEditor";
import type { RoundsCanvas } from "./RoundsCanvas";

const canvas = vi.hoisted(() => ({ props: null as ComponentProps<typeof RoundsCanvas> | null }));
vi.mock("./RoundsCanvas", () => ({
  RoundsCanvas: (props: ComponentProps<typeof RoundsCanvas>) => {
    canvas.props = props;
    return <div data-testid="round-canvas" data-expanded={props.expanded} data-positions={JSON.stringify(props.positions)}>
      {props.rounds.map((round) => <button type="button" key={round.id} onClick={() => props.onSelect(round.id)}>{`Select ${round.name}`}</button>)}
      <button type="button" onClick={() => props.onPositionsChange?.({ ...props.positions, [props.rounds[0]!.id]: { x: 130, y: 210 } })}>Arrange node</button>
    </div>;
  },
}));

function fixture(): EnrichmentRole {
  return { ...newRole(), title: "Platform engineer", verified: true, rounds: [
    { ...newRound(), name: "Technical", verified: true },
    { ...newRound(), name: "Discussion", verified: true },
  ] };
}

function Harness({ initial = fixture(), disabled = false, onChange = () => {} }: { initial?: EnrichmentRole; disabled?: boolean; onChange?: (role: EnrichmentRole) => void }) {
  const [role, setRole] = useState(initial);
  return <RoleEditor role={role} disabled={disabled} onChange={(next) => { onChange(next); setRole(next); }} />;
}

describe("RoleEditor rounds workspace", () => {
  it("offers all eight canonical engineering levels and clears role verification on selection", async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(<Harness onChange={changed} />);
    expect(screen.queryByRole("textbox", { name: "Level" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "Level" }));
    expect(screen.getAllByRole("option")).toHaveLength(9);
    expect(screen.getByRole("option", { name: "SDE III" })).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Distinguished" }));
    expect(changed.mock.lastCall?.[0]).toMatchObject({ level: "distinguished", verified: false });
  });
  it("selects difficulty from the keyboard and returns focus to the labelled trigger", async () => {
    const changed = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={changed} />);
    const trigger = screen.getByRole("combobox", { name: "Difficulty" });
    trigger.focus();
    await user.keyboard("{ArrowDown}h{Enter}");
    expect(changed.mock.lastCall?.[0].rounds[0].difficulty).toBe("hard");
    expect(trigger).toHaveFocus();
  });
  it("edits every round field in full screen and retains changes and verification on close", async () => {
    const changed = vi.fn();
    render(<Harness onChange={changed} />);
    await userEvent.click(screen.getByRole("button", { name: "Expand rounds" }));
    const dialog = screen.getByRole("dialog", { name: "Interview rounds · Full screen" });
    expect(within(dialog).getByText("Edits stay in your draft when you close this view. Use Save draft in the editor to store them.")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Round name")).toHaveLength(1);
    expect(screen.getAllByTestId("round-canvas")).toHaveLength(1);
    expect(dialog.style.height).toBe("calc(100dvh / var(--hud-zoom, 1))");
    expect(within(dialog).getByRole("region", { name: "Round inspector" })).toHaveClass("overflow-y-auto");
    fireEvent.change(within(dialog).getByLabelText("Round name"), { target: { value: "Architecture" } });
    await selectOption(within(dialog).getByRole("combobox", { name: "Round type" }), "system-design");
    await selectOption(within(dialog).getByRole("combobox", { name: "Difficulty" }), "hard");
    fireEvent.change(within(dialog).getByLabelText("Duration (minutes)"), { target: { value: "60" } });
    fireEvent.change(within(dialog).getByLabelText("Topics (one per line)"), { target: { value: "Scaling\nStorage" } });
    fireEvent.change(within(dialog).getByLabelText("Questions (one per line)"), { target: { value: "Design a queue" } });
    fireEvent.change(within(dialog).getByLabelText("Round guidance"), { target: { value: "Explain tradeoffs" } });
    fireEvent.change(within(dialog).getByLabelText("Round source URLs (one per line)"), { target: { value: "https://example.com/interview" } });
    expect(within(dialog).getByLabelText(/I verified this round/)).not.toBeChecked();
    await userEvent.click(within(dialog).getByLabelText(/I verified this round/));
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Round name")).toHaveValue("Architecture");
    expect(screen.getByLabelText(/I verified this round/)).toBeChecked();
    expect(screen.getByLabelText(/I verified this role profile/)).not.toBeChecked();
    expect(changed.mock.lastCall?.[0].rounds[0]).toMatchObject({ name: "Architecture", type: "system-design", difficulty: "hard", durationMinutes: 60, topics: ["Scaling", "Storage"], questions: ["Design a queue"], guidance: "Explain tradeoffs", sourceUrls: ["https://example.com/interview"], verified: true });
  });

  it("adds, reorders and removes in full screen, retaining saved order and selected round", async () => {
    const changed = vi.fn();
    render(<Harness onChange={changed} />);
    await userEvent.click(screen.getByRole("button", { name: "Expand rounds" }));
    await userEvent.click(screen.getByRole("button", { name: "Add round" }));
    fireEvent.change(screen.getByLabelText("Round name"), { target: { value: "Final" } });
    await userEvent.click(screen.getByRole("button", { name: "Move round 3 up" }));
    await userEvent.click(screen.getByRole("button", { name: "Move round 1 down" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove round 3" }));
    expect(screen.getByLabelText("Round name")).toHaveValue("Final");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByLabelText("Round name")).toHaveValue("Final");
    const list = screen.getByRole("list", { name: "Saved interview order" });
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([expect.stringContaining("Final"), expect.stringContaining("Technical")]);
    expect(changed.mock.lastCall?.[0].rounds.map((round: { name: string }) => round.name)).toEqual(["Final", "Technical"]);
    await userEvent.click(screen.getByRole("button", { name: "Expand rounds" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove round 1" }));
    expect(screen.getByLabelText("Round name")).toHaveValue("Technical");
  });

  it("preserves temporary layout and selection across both transitions and restores focus on Escape", async () => {
    const initial = fixture();
    const changed = vi.fn();
    render(<Harness initial={initial} onChange={changed} />);
    await userEvent.click(screen.getByRole("button", { name: "Arrange node" }));
    await userEvent.click(screen.getByRole("button", { name: "Select Discussion" }));
    const trigger = screen.getByRole("button", { name: "Expand rounds" });
    await userEvent.click(trigger);
    expect(screen.getByLabelText("Round name")).toHaveValue("Discussion");
    expect(screen.getByTestId("round-canvas")).toHaveAttribute("data-expanded", "true");
    expect(canvas.props?.positions?.[initial.rounds[0]!.id]).toEqual({ x: 130, y: 210 });
    act(() => canvas.props?.onPositionsChange?.({ [initial.rounds[0]!.id]: { x: 300, y: 400 } }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.getByLabelText("Round name")).toHaveValue("Discussion");
    expect(canvas.props?.positions?.[initial.rounds[0]!.id]).toEqual({ x: 300, y: 400 });
    expect(changed).not.toHaveBeenCalled();
  });

  it("expands an empty sequence and can add or remove its first round", async () => {
    render(<Harness initial={newRole()} />);
    await userEvent.click(screen.getByRole("button", { name: "Expand rounds" }));
    expect(screen.getByText("Add the first interview round.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add round" }));
    expect(screen.getByLabelText("Round name")).toHaveValue("");
    await userEvent.click(screen.getByRole("button", { name: "Remove round 1" }));
    expect(screen.queryByLabelText("Round name")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add round" })).toBeEnabled();
  });

  it("enforces the twelve-round limit in full screen", async () => {
    render(<Harness initial={{ ...newRole(), rounds: Array.from({ length: 12 }, () => newRound()) }} />);
    await userEvent.click(screen.getByRole("button", { name: "Expand rounds" }));
    expect(screen.getByRole("button", { name: "Add round" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Remove round 12" }));
    expect(screen.getByRole("button", { name: "Add round" })).toBeEnabled();
  });

  it("locks the portalled fields and callbacks when pending while allowing close", async () => {
    const initial = fixture();
    const changed = vi.fn();
    const view = render(<Harness initial={initial} onChange={changed} />);
    await userEvent.click(screen.getByRole("button", { name: "Expand rounds" }));
    view.rerender(<Harness initial={initial} onChange={changed} disabled />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Round name")).toBeDisabled();
    expect(within(dialog).getByLabelText("Round type")).toBeDisabled();
    expect(within(dialog).getByLabelText(/I verified this round/)).toBeDisabled();
    for (const name of ["Add round", "Remove round 1", "Move round 1 down", "Select Discussion"]) expect(within(dialog).getByRole("button", { name })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Round name"), { target: { value: "Blocked" } });
    act(() => {
      canvas.props?.onSelect(initial.rounds[1]!.id);
      canvas.props?.onPositionsChange?.({ [initial.rounds[0]!.id]: { x: 1, y: 2 } });
    });
    expect(canvas.props?.selectedId).toBe(initial.rounds[0]!.id);
    expect(canvas.props?.positions).toEqual({});
    expect(changed).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand rounds" })).toBeDisabled();
  });
});
