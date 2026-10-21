import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountMenu, type AccountMenuProps } from "./AccountMenu";

function renderMenu(overrides: Partial<AccountMenuProps> = {}) {
  const props: AccountMenuProps = {
    name: "Aarav Sharma",
    email: "aarav@x.dev",
    status: "Active · Meesho SDE I",
    isAdmin: false,
    onOpenSearch: vi.fn(),
    onToggleSidebar: vi.fn(),
    onSignOut: vi.fn(),
    ...overrides,
  };
  render(<AccountMenu {...props} />);
  return props;
}

describe("AccountMenu", () => {
  it("opens from the avatar with who is signed in and the account links", async () => {
    const user = userEvent.setup();
    renderMenu();
    const trigger = screen.getByRole("button", { name: /account menu/i });
    expect(trigger).toBeInTheDocument();

    await user.click(trigger);
    const menu = screen.getByRole("menu");
    expect(menu).toHaveTextContent("Aarav Sharma");
    expect(menu).toHaveTextContent("aarav@x.dev");
    expect(menu).toHaveTextContent("Active · Meesho SDE I");
    expect(screen.getByRole("menuitem", { name: /^profile$/i })).toHaveAttribute("href", "/profile");
    expect(screen.getByRole("menuitem", { name: /connected sources/i })).toHaveAttribute("href", "/connections");
    expect(screen.getByRole("menuitem", { name: /^account$/i })).toHaveAttribute("href", "/settings/account");
    expect(screen.getByRole("menuitem", { name: /billing/i })).toHaveAttribute("href", "/settings/billing");
    expect(screen.getByRole("menuitem", { name: /help/i })).toHaveAttribute("href", "/help");
  });

  it("shows the admin section only to admins", async () => {
    const user = userEvent.setup();
    renderMenu({ isAdmin: true });
    await user.click(screen.getByRole("button", { name: /account menu/i }));
    expect(screen.getByRole("menuitem", { name: /intelligence/i })).toHaveAttribute("href", "/intelligence");
  });

  it("hides the admin section from everyone else", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: /account menu/i }));
    expect(screen.queryByRole("menuitem", { name: /intelligence/i })).not.toBeInTheDocument();
  });

  it("signs out", async () => {
    const user = userEvent.setup();
    const props = renderMenu();
    await user.click(screen.getByRole("button", { name: /account menu/i }));
    await user.click(screen.getByRole("menuitem", { name: /sign out/i }));
    expect(props.onSignOut).toHaveBeenCalledOnce();
  });

  it("runs a shortcut's action once the dropdown has closed", async () => {
    const user = userEvent.setup();
    const props = renderMenu();
    await user.click(screen.getByRole("button", { name: /account menu/i }));
    screen.getByRole("menuitem", { name: /keyboard shortcuts/i }).focus();
    await user.keyboard("{ArrowRight}");
    await user.click(await screen.findByRole("menuitem", { name: /^search/i }));
    await waitFor(() => expect(props.onOpenSearch).toHaveBeenCalledOnce());
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens from a custom trigger too (the sidebar's account row)", async () => {
    const user = userEvent.setup();
    renderMenu({ trigger: <button type="button">Aarav row</button>, triggerLabel: "Account menu" });
    await user.click(screen.getByRole("button", { name: /account menu/i }));
    expect(screen.getByRole("menu")).toHaveTextContent("aarav@x.dev");
  });
});
