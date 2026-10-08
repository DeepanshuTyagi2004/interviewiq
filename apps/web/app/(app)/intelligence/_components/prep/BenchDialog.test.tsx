import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiFetchError } from "@/lib/api-client/errors";
import { candidates } from "./fixtures";

const h = vi.hoisted(() => ({ mutate: vi.fn(), reset: vi.fn(), error: null as unknown, enabled: [] as boolean[] }));

vi.mock("@/features/blueprints", () => ({
  useBenchCandidates: (enabled: boolean) => {
    h.enabled.push(enabled);
    return { data: candidates, isPending: false, isError: false };
  },
  useStartBench: () => ({ mutate: h.mutate, reset: h.reset, isPending: false, error: h.error }),
}));

import { BenchDialog } from "./BenchDialog";

const JD = "33333333-3333-4333-8333-333333333333";
const LOOP = "44444444-4444-4444-8444-444444444444";

function setup() {
  const onStarted = vi.fn();
  const onOpenChange = vi.fn();
  render(<BenchDialog open onOpenChange={onOpenChange} onStarted={onStarted} />);
  return { onStarted, onOpenChange, user: userEvent.setup() };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.error = null;
  h.enabled = [];
});

describe("BenchDialog", () => {
  it("loads candidates only while open and filters them by name or email", async () => {
    const { user } = setup();
    expect(h.enabled).toContain(true);
    expect(screen.getAllByRole("radio", { name: /Asha Verma|Rohit Das/ })).toHaveLength(2);
    await user.type(screen.getByRole("textbox", { name: "Search candidates" }), "rohit@");
    expect(screen.queryByRole("radio", { name: /Asha Verma/ })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Rohit Das/ })).toBeInTheDocument();
  });

  it("submits a JD run with the round type and options, then selects the new run", async () => {
    h.mutate.mockImplementation((_body: unknown, opts: { onSuccess: (r: { run_id: string }) => void }) => opts.onSuccess({ run_id: "run_bench00001" }));
    const { user, onStarted, onOpenChange } = setup();
    const start = screen.getByRole("button", { name: "Start run" });
    expect(start).toBeDisabled();

    await user.click(screen.getByRole("radio", { name: /Asha Verma/ }));
    await user.type(screen.getByRole("textbox", { name: "JD id" }), "not-a-uuid");
    expect(screen.getByText("Enter a JD id (a UUID).")).toBeInTheDocument();
    expect(start).toBeDisabled();

    await user.clear(screen.getByRole("textbox", { name: "JD id" }));
    await user.type(screen.getByRole("textbox", { name: "JD id" }), JD);
    await user.selectOptions(screen.getByRole("combobox", { name: "Round type" }), "system-design");
    await user.click(screen.getByRole("checkbox", { name: "Bypass answer-key cache" }));
    await user.click(screen.getByRole("checkbox", { name: "Ignore seen-before" }));
    await user.click(start);

    expect(h.mutate).toHaveBeenCalledWith(
      {
        candidateId: candidates[0]!.id,
        jobDescriptionId: JD,
        roundType: "system-design",
        options: { bypassBlueprintCache: false, bypassAnswerKeyCache: true, ignoreExclusions: true },
      },
      expect.anything(),
    );
    expect(onStarted).toHaveBeenCalledWith("run_bench00001");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("submits a practice loop node, letting the node decide the round type", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("radio", { name: /Rohit Das/ }));
    await user.click(screen.getByRole("radio", { name: "Practice loop node" }));
    await user.type(screen.getByRole("textbox", { name: "Loop id" }), LOOP);
    await user.type(screen.getByRole("textbox", { name: "Node id" }), "node-2");
    await user.selectOptions(screen.getByRole("combobox", { name: "Round type" }), "");
    await user.click(screen.getByRole("checkbox", { name: "Bypass blueprint cache" }));
    await user.click(screen.getByRole("button", { name: "Start run" }));
    expect(h.mutate).toHaveBeenCalledWith(
      {
        candidateId: candidates[1]!.id,
        loopId: LOOP,
        nodeId: "node-2",
        options: { bypassBlueprintCache: true, bypassAnswerKeyCache: false, ignoreExclusions: false },
      },
      expect.anything(),
    );
  });

  it("shows the API error's code and message inline", () => {
    h.error = new ApiFetchError(422, "jd_not_found", "No JD with that id");
    setup();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("jd_not_found");
    expect(alert).toHaveTextContent("No JD with that id");
  });
});
