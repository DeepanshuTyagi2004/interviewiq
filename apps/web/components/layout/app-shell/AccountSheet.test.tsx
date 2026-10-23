import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountMenu } from "./AccountMenu";

function phone(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches, media: query, addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false,
  }));
}

describe("AccountMenu on a phone", () => {
  beforeEach(() => phone(true));
  afterEach(() => vi.unstubAllGlobals());

  it("opens a bottom sheet with the everyday destinations, theme switch and Sign out", async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn();
    render(<AccountMenu name="Aarav Sharma" email="aarav@x.dev" status="Active · Meesho SDE I" isAdmin onOpenSearch={vi.fn()} onToggleSidebar={vi.fn()} onSignOut={onSignOut} />);
    await user.click(screen.getByRole("button", { name: /account menu/i }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    for (const label of ["Profile", "Sources", "Interviews", "Account", "Notifications", "Privacy"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: /billing & plan/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /intelligence/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Light theme" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText(/keyboard shortcuts/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});
