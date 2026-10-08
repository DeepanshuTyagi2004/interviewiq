import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { newRoundNode } from "../graph";
import type { Loop } from "../types";
import { BookRoundDialog } from "./SlotDialog";

const mocks = vi.hoisted(() => ({ book: vi.fn() }));
vi.mock("@/features/interview", () => ({ useCreateSession: () => ({ mutate: mocks.book }), useMySessions: () => ({ data: { sessions: [] } }) }));
vi.mock("./SlotPicker", () => ({ SlotPicker: () => null }));

describe("standalone round booking", () => {
  it("books by loop and node without manufacturing a job description", async () => {
    const node = newRoundNode("dsa", { x: 0, y: 0 });
    const loop: Loop = { id: "l-1", name: "SQL practice", level: "staff", jdId: null, jd: null, processId: "p-1", kind: "standalone", status: "active", countsTowardReadiness: false, confirmedAt: "2030-01-01", graph: { nodes: [node], edges: [] }, progress: { total: 1, completed: 0, nextNodeIds: [node.id] }, nodeStates: { [node.id]: "available" }, sessions: [] };
    const user = userEvent.setup();
    render(<BookRoundDialog loop={loop} nodeId={node.id} onOpenChange={vi.fn()} />);
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription(/SQL practice · Staff/);
    await user.click(screen.getByRole("button", { name: "Start now" }));
    expect(mocks.book.mock.calls[0][0]).toMatchObject({ loopId: "l-1", nodeId: node.id, scheduledAt: expect.any(String), timezone: expect.any(String) });
    expect(mocks.book.mock.calls[0][0]).not.toHaveProperty("jobDescriptionId");
  });
});
