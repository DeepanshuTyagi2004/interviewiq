import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmationDialog } from "./confirmation-dialog";

describe("ConfirmationDialog", () => {
  it("focuses cancel, exposes accessible title and description, and confirms once while work is unresolved", async () => {
    let resolve!: () => void;
    const action = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    const close = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmationDialog open onOpenChange={close} title="Delete this process?" description="Started tracks keep their copy." confirmLabel="Delete process" destructive onConfirm={action} />);
    expect(screen.getByRole("dialog", { name: "Delete this process?" })).toHaveAccessibleDescription("Started tracks keep their copy.");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.dblClick(screen.getByRole("button", { name: "Delete process" }));
    expect(action).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    await act(async () => { resolve(); });
    expect(close).toHaveBeenCalledWith(false);
  });
});
