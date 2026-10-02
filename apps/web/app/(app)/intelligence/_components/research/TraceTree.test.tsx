import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { buildSpanTree } from "@/features/research";
import { makeItem, makeSpan } from "@/features/research/testing";

vi.mock("./GraphMiniMap", () => ({ GraphMiniMap: ({ item }: { item: { company_id: string } }) => <div data-testid="minimap">{item.company_id}</div> }));

import { TraceTree } from "./TraceTree";

const t = (s: number) => `2026-10-02T10:00:0${s}+00:00`;
const SPANS = [
  makeSpan({ span_id: "run", kind: "run", name: "run", started_at: t(0) }),
  makeSpan({ span_id: "co", parent_id: "run", kind: "company", name: "Meesho", company_id: "c-meesho", status: "ok", started_at: t(1) }),
  makeSpan({ span_id: "res", parent_id: "co", kind: "node", name: "resolve", company_id: "c-meesho", status: "error", started_at: t(2) }),
];

describe("TraceTree", () => {
  it("shows nested steps with a minimap per company, and selects on click", async () => {
    const onSelect = vi.fn();
    render(<TraceTree roots={buildSpanTree(SPANS)} items={[makeItem()]} selectedSpanId={null} onSelectSpan={onSelect} onCopyFailure={vi.fn()} />);
    expect(screen.getByTestId("minimap")).toHaveTextContent("c-meesho");
    await userEvent.click(screen.getByRole("button", { name: /resolve/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ span_id: "res" }));
  });

  it("marks a collapsed company whose steps failed", async () => {
    render(<TraceTree roots={buildSpanTree(SPANS)} items={[makeItem()]} selectedSpanId={null} onSelectSpan={vi.fn()} onCopyFailure={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Collapse Meesho" }));
    expect(screen.queryByRole("button", { name: /resolve/ })).not.toBeInTheDocument();
    expect(screen.getAllByLabelText("a step inside failed").length).toBeGreaterThan(0);
  });

  it("offers a failure report for a failed company", async () => {
    const onCopyFailure = vi.fn();
    const failed = makeItem({ status: "failed" });
    render(<TraceTree roots={buildSpanTree(SPANS)} items={[failed]} selectedSpanId={null} onSelectSpan={vi.fn()} onCopyFailure={onCopyFailure} />);
    await userEvent.click(screen.getByRole("button", { name: "Copy failure report for Meesho" }));
    expect(onCopyFailure).toHaveBeenCalledWith(failed);
  });
});
