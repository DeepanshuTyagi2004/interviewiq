import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROUTES } from "@/lib/constants/shared";

const logoutMock = vi.fn();
const replaceMock = vi.fn();

vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ logout: logoutMock }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

import { LogoutButton } from "./LogoutButton";

describe("LogoutButton", () => {
  beforeEach(() => {
    logoutMock.mockReset();
    replaceMock.mockReset();
    logoutMock.mockResolvedValue(undefined);
  });

  it("renders an accessible HUD-styled action", () => {
    render(<LogoutButton />);

    const button = screen.getByRole("button", { name: "Log out" });
    expect(button).toHaveClass("w-full", "border", "rounded-[14px]");
    expect(button).not.toHaveClass("underline");
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("shows the pending state, disables repeat clicks, and preserves logout navigation", async () => {
    let resolveLogout!: () => void;
    logoutMock.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveLogout = resolve;
      }),
    );

    const user = userEvent.setup();
    render(<LogoutButton />);
    const button = screen.getByRole("button", { name: "Log out" });

    await user.click(button);

    expect(logoutMock).toHaveBeenCalledOnce();
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Logging out…")).toBeInTheDocument();

    resolveLogout();
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith(ROUTES.login));
  });
});
