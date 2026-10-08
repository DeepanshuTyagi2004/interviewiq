import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { InterviewProcess } from "@/features/loops/types";
import { newRoundNode } from "@/features/loops/graph";
import { ProcessList } from "./ProcessList";

const mocks = vi.hoisted(() => ({ process: null as InterviewProcess | null, start: vi.fn(), remove: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/features/loops", async (original) => ({
  ...(await original<typeof import("@/features/loops")>()),
  useProcesses: () => ({ data: [mocks.process] }), useLoops: () => ({ data: [] }),
  useConfirmLoop: () => ({ mutate: mocks.start }),
  useDeleteProcess: () => ({ mutateAsync: mocks.remove }),
  useDuplicateProcess: () => ({ mutate: vi.fn() }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.process = { id: "p-1", name: "Custom cloud practice", level: "staff", jd: null, graph: { nodes: [newRoundNode("dsa", { x: 0, y: 0 })], edges: [] }, createdAt: "2030-01-01", updatedAt: "2030-01-01" };
  mocks.remove.mockResolvedValue(undefined);
});
describe("ProcessList", () => {
  it("requires unknown saved levels to be repaired before start or duplicate", () => {
    mocks.process = { ...mocks.process!, level: null, legacyLevel: "Any level" };
    render(<ProcessList query="" onCreate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Start track" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Duplicate" })).toBeDisabled();
    expect(screen.getByText("Choose a level · Standalone practice")).toBeInTheDocument();
  });
  it("shows the canonical level and starts a standalone process without a JD", async () => {
    const user = userEvent.setup();
    render(<ProcessList query="staff" onCreate={vi.fn()} />);
    expect(screen.getByText("Staff · Standalone practice")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start track" }));
    expect(mocks.start.mock.calls[0][0]).toEqual({ processId: "p-1" });
  });
  it("requires themed confirmation before deleting and calls delete once", async () => {
    const user = userEvent.setup();
    render(<ProcessList query="" onCreate={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Delete “Custom cloud practice”?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete process" }));
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledWith("p-1");
  });
});
