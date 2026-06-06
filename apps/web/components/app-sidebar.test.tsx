import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// NavUser sources its display name/avatar from useProfile.
vi.mock("@/features/profile", () => ({
  useProfile: () => ({
    data: {
      user: { name: "Aisha Verma", headline: null },
      fragments: { github: { avatarUrl: "https://example.com/a.png" } },
    },
  }),
}));

// NavUser also reads useAuth().logout and the router; stub both.
vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ logout: vi.fn() }),
}));
vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>(
    "next/navigation",
  );
  return {
    ...actual,
    usePathname: () => "/dashboard",
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  };
});

import { AppSidebar } from "./app-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";

function renderSidebar() {
  return render(
    <SidebarProvider>
      <AppSidebar />
    </SidebarProvider>,
  );
}

describe("AppSidebar", () => {
  it("renders the three primary nav links with correct hrefs", () => {
    renderSidebar();
    expect(screen.getByRole("link", { name: /dashboard/i })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    expect(screen.getByRole("link", { name: /profile/i })).toHaveAttribute(
      "href",
      "/profile",
    );
    expect(screen.getByRole("link", { name: /connections/i })).toHaveAttribute(
      "href",
      "/connections",
    );
  });

  it("binds NavUser to the profile-derived name", () => {
    renderSidebar();
    expect(screen.getByText("Aisha Verma")).toBeInTheDocument();
  });
});
