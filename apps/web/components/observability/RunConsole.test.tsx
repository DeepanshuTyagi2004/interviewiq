import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { RunSnapshot, RunStatus } from "@/features/observability";
import { LogTerminal } from "./LogTerminal";
import { RunConsole } from "./RunConsole";

function snapshot(status: RunStatus, overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    run_id: "run_AbC123",
    pipeline: "resume",
    source: "bench",
    label: "Resume parse · cv.pdf",
    status,
    current_step: status === "running" ? "extract_text" : null,
    steps: [],
    result: null,
    error: null,
    started_at: null,
    finished_at: null,
    logs: [],
    last_seq: 0,
    ...overrides,
  };
}

/** The status dot in the run card's header (the only dot RunConsole draws itself). */
function headerDot(label: RegExp) {
  const run = screen.getByRole("region", { name: /^Run Resume parse/ });
  const status = within(run).getByText(label);
  return status.parentElement!.querySelector("span[aria-hidden]")!;
}

describe("RunConsole status", () => {
  it("pulses the header dot only while the run is really running, with the same words", () => {
    render(<RunConsole snapshot={snapshot("running")} />);
    const dot = headerDot(/Running · extract_text/);
    expect(dot).toHaveAttribute("data-motion");
    expect(dot.className).toContain("bg-ink");
  });

  it("shows a steady dot once the run has completed", () => {
    render(<RunConsole snapshot={snapshot("completed")} />);
    const dot = headerDot(/^Completed$/);
    expect(dot).not.toHaveAttribute("data-motion");
    expect(dot.className).toContain("bg-ink");
  });

  it("shows an error dot for a failed run", () => {
    render(<RunConsole snapshot={snapshot("failed")} />);
    const dot = headerDot(/^Failed$/);
    expect(dot).not.toHaveAttribute("data-motion");
    expect(dot.className).toContain("bg-destructive");
  });

  it("keeps the run id's case in the header", () => {
    render(<RunConsole snapshot={snapshot("completed")} />);
    expect(screen.getByText("run_AbC123").className).toContain("normal-case");
  });

  it("frames an empty step list with the empty block, same copy", () => {
    render(<RunConsole snapshot={snapshot("running")} />);
    expect(screen.getByText("No steps reported yet.")).toBeInTheDocument();
  });
});

describe("LogTerminal", () => {
  const line = (seq: number) => ({ seq, ts: "2026-10-02T12:30:00Z", level: "INFO", message: `line ${seq}` });

  it("is a named region on the ink card, with a zero-padded line count", () => {
    const { container } = render(<LogTerminal title="Live logs" logs={[line(1), line(2), line(3)]} />);
    const card = screen.getByRole("region", { name: "Live logs" });
    expect(card.className).toContain("bg-ink");
    expect(within(card).getByRole("heading", { name: "Live logs" })).toBeInTheDocument();
    expect(within(card).getByText("03 lines")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Live logs output" })).toHaveTextContent("line 3");
    // No raw hex left for the quiet text: the inverse tone uses white opacities.
    expect(container.innerHTML).not.toMatch(/text-\[#(dcdbd6|9d9c97|8d8c87)\]/);
  });

  it("uses the singular for one line and shows the empty text", () => {
    render(<LogTerminal logs={[line(1)]} />);
    expect(screen.getByText("01 line")).toBeInTheDocument();
    render(<LogTerminal title="Other" logs={[]} emptyText="Nothing yet." />);
    expect(screen.getByText("Nothing yet.")).toBeInTheDocument();
  });

  it("prefers a caller's meta over the line count", () => {
    render(<LogTerminal logs={[]} meta="Connecting…" />);
    expect(screen.getByText("Connecting…")).toBeInTheDocument();
    expect(screen.queryByText(/lines?$/)).not.toBeInTheDocument();
  });
});
