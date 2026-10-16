import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const currentUser = vi.hoisted(() => ({
  value: { user: { name: "Aarav Sharma", email: "a@x.dev", hasPassword: false, emailVerified: true }, isAdmin: false },
}));

vi.mock("@/lib/hooks/useCurrentUser", () => ({ useCurrentUser: () => currentUser.value }));
vi.mock("@/features/onboarding/hooks", () => ({
  useCandidateProfile: () => ({ data: { fullName: "Aarav Sharma", targetRole: "Meesho SDE I" } }),
}));
vi.mock("@/features/jobs", () => ({ useJds: () => ({ data: [], isLoading: false }) }));
vi.mock("@/features/loops", async (original) => ({ ...(await original<typeof import("@/features/loops")>()), useLoops: () => ({ data: [] }) }));
vi.mock("@/lib/auth/AuthProvider", () => ({ useAuth: () => ({ logout: vi.fn() }) }));
vi.mock("@/components/layout/ThemeToggle", () => ({ ThemeToggle: () => null }));
const pathname = { value: "/dashboard" };
vi.mock("next/navigation", () => ({
  usePathname: () => pathname.value,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { AppShell } from "./AppShell";

function renderShell() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AppShell>
        <p>Page body</p>
      </AppShell>
    </QueryClientProvider>,
  );
}

describe("AppShell", () => {
  beforeEach(() => {
    currentUser.value = {
      user: { name: "Aarav Sharma", email: "a@x.dev", hasPassword: false, emailVerified: true },
      isAdmin: false,
    };
  });

  it("renders the page and titles it from the route in the top bar", () => {
    renderShell();
    expect(screen.getByText("Page body")).toBeInTheDocument();
    const topBar = screen.getByRole("banner");
    expect(within(topBar).getByText("Dashboard")).toBeInTheDocument();
    expect(within(topBar).getByRole("button", { name: /open menu/i })).toBeInTheDocument();
    expect(within(topBar).getByRole("button", { name: /account menu/i })).toHaveTextContent("AS");
  });

  it("keeps the menu hidden until the toggle is pressed", async () => {
    const user = userEvent.setup();
    renderShell();
    const toggle = screen.getByRole("button", { name: /open menu/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /companies/i })).toHaveAttribute("href", "/jobs");
    expect(screen.getByRole("link", { name: /dashboard/i })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Target · Meesho SDE I")).toBeInTheDocument();
  });

  it("toggles with M and closes with Escape", async () => {
    const user = userEvent.setup();
    renderShell();
    const toggle = screen.getByRole("button", { name: /open menu/i });
    await user.keyboard("m");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("ignores M and Ctrl+K on the live interview screen", async () => {
    const user = userEvent.setup();
    pathname.value = "/interviews/abc123/live";
    try {
      renderShell();
      const toggle = screen.getByRole("button", { name: /open menu/i });
      await user.keyboard("m");
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      await user.keyboard("{Control>}k{/Control}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    } finally {
      pathname.value = "/dashboard";
    }
  });

  it("shows admin destinations only to admins", async () => {
    const user = userEvent.setup();
    const { unmount } = renderShell();
    await user.keyboard("m");
    expect(screen.queryByRole("link", { name: /intelligence/i })).not.toBeInTheDocument();
    unmount();

    currentUser.value = { ...currentUser.value, isAdmin: true };
    renderShell();
    await user.keyboard("m");
    expect(screen.getByRole("link", { name: /intelligence/i })).toHaveAttribute("href", "/intelligence");
  });

  it("asks unverified password accounts to confirm their email", () => {
    currentUser.value = {
      user: { name: "Aarav Sharma", email: "a@x.dev", hasPassword: true, emailVerified: false },
      isAdmin: false,
    };
    renderShell();
    expect(screen.getByText(/confirm your email/i)).toBeInTheDocument();
  });
});
