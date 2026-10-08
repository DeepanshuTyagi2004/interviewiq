import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { selectOption } from "@/tests/helpers/select-option";
import { makeItem, makeRun } from "@/features/research/testing";

const h = vi.hoisted(() => ({ controlMutate: vi.fn(), startMutate: vi.fn(), pending: false }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-client/client", () => ({ ApiFetchError: class extends Error {}, apiFetch: vi.fn() }));
vi.mock("@/features/research", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/research")>()),
  useRunControl: () => ({ mutate: h.controlMutate, isPending: h.pending }),
  useStartRun: () => ({ mutate: h.startMutate, isPending: h.pending }),
  useAdminCompanies: () => ({ data: { companies: [], researchAvailable: true } }),
}));

import { RunControlBar } from "./RunControlBar";

const enabled = (name: string) => !(screen.getByRole("button", { name }) as HTMLButtonElement).disabled;

describe("RunControlBar", () => {
  beforeEach(() => { vi.clearAllMocks(); h.pending = false; });

  it("closes an open picker and locks run/mode controls while a request is pending", async () => {
    const run = makeRun({ status: "completed" });
    const choose = vi.fn();
    const view = render(<RunControlBar runs={[run]} run={run} items={[]} onSelectRun={choose} />);
    await userEvent.click(screen.getByRole("combobox", { name: "Mode" }));
    expect(screen.getByRole("listbox", { name: "Mode" })).toBeInTheDocument();
    h.pending = true;
    view.rerender(<RunControlBar runs={[run]} run={run} items={[]} onSelectRun={choose} />);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Mode" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Run" })).toBeDisabled();
    expect(choose).not.toHaveBeenCalled();
  });

  it.each([
    ["running", { "Start all": false, Pause: true, Resume: false, Stop: true }],
    ["paused", { "Start all": false, Pause: false, Resume: true, Stop: true }],
    ["completed", { "Start all": true, Pause: false, Resume: false, Stop: false }],
  ] as const)("%s run enables exactly the controls that apply", (status, expected) => {
    const run = makeRun({ status });
    render(<RunControlBar runs={[run]} run={run} items={[makeItem()]} onSelectRun={vi.fn()} />);
    for (const [name, on] of Object.entries(expected)) expect(enabled(name)).toBe(on);
  });

  it("pause sends the control for this run", async () => {
    const run = makeRun({ status: "running" });
    render(<RunControlBar runs={[run]} run={run} items={[]} onSelectRun={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(h.controlMutate).toHaveBeenCalledWith({ runId: run.run_id, action: "pause" }, expect.any(Object));
  });

  it("Stop needs a second confirming click", async () => {
    const run = makeRun({ status: "running" });
    render(<RunControlBar runs={[run]} run={run} items={[]} onSelectRun={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(h.controlMutate).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Confirm stop" }));
    expect(h.controlMutate).toHaveBeenCalledWith({ runId: run.run_id, action: "stop" }, expect.any(Object));
  });

  it("moves focus to Confirm stop, and back to Stop on Cancel", async () => {
    const run = makeRun({ status: "running" });
    render(<RunControlBar runs={[run]} run={run} items={[]} onSelectRun={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(screen.getByRole("button", { name: "Confirm stop" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Stop" })).toHaveFocus();
  });

  it("says why a run paused itself", () => {
    const run = makeRun({ status: "paused", pause_reason: "budget_exhausted" });
    render(<RunControlBar runs={[run]} run={run} items={[]} onSelectRun={vi.fn()} />);
    expect(screen.getByText(/budget cap reached/i)).toBeInTheDocument();
  });

  it("Start all uses the chosen mode", async () => {
    render(<RunControlBar runs={[]} run={undefined} items={[]} onSelectRun={vi.fn()} />);
    await selectOption(screen.getByRole("combobox", { name: "Mode" }), "replay");
    await userEvent.click(screen.getByRole("button", { name: "Start all" }));
    expect(h.startMutate).toHaveBeenCalledWith({ scope: "all", mode: "replay" }, expect.any(Object));
  });
});
