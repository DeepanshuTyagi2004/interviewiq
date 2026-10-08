import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SETTINGS_TABS, SettingsNav } from "./SettingsNav";

const pathname = vi.hoisted(() => ({ current: "/settings/privacy" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

describe("SettingsNav", () => {
  it("lists every settings section and marks the current one", () => {
    render(<SettingsNav />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(SETTINGS_TABS.map((t) => t.label));
    expect(screen.getByRole("link", { name: "Privacy & data" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Account" })).not.toHaveAttribute("aria-current");
  });
});
