import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Use vi.hoisted so the mocks are available when vi.mock factories run.
const { mutateMock, toastSuccess, toastError } = vi.hoisted(() => ({
  mutateMock: vi.fn(
    (
      _vars: unknown,
      opts?: { onSuccess?: () => void; onError?: () => void },
    ) => {
      opts?.onSuccess?.();
    },
  ),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

// Mock the mutation hook: capture mutate and drive its onSuccess synchronously
// so the dialog's success path (close + toast.success) runs in the test.
vi.mock("@/features/profile", () => ({
  useDisconnectGithub: () => ({ mutate: mutateMock, isPending: false }),
}));

// Mock sonner so we can assert the success toast without a real Toaster.
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

import { DisconnectDialog } from "./DisconnectDialog";

describe("DisconnectDialog", () => {
  beforeEach(() => {
    mutateMock.mockClear();
    toastSuccess.mockClear();
    toastError.mockClear();
  });

  it("calls the disconnect mutation and runs the success path on confirm", async () => {
    const user = userEvent.setup();
    render(<DisconnectDialog label="GitHub" />);

    // Open the dialog via its trigger.
    await user.click(screen.getByRole("button", { name: /^disconnect$/i }));

    // The confirm dialog is now open with its destructive Disconnect button.
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();

    // Click the destructive confirm button inside the dialog.
    const confirm = screen
      .getAllByRole("button", { name: /^disconnect$/i })
      .at(-1)!;
    await user.click(confirm);

    // Mutation fired exactly once.
    expect(mutateMock).toHaveBeenCalledTimes(1);

    // Success path: toast fired and the dialog closed (state flip).
    expect(toastSuccess).toHaveBeenCalledWith("GitHub disconnected");
    expect(toastError).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
});
