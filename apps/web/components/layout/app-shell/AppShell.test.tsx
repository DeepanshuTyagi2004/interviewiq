import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const currentUser = vi.hoisted(() => ({
  value: { user: { name: "Aarav Sharma", email: "a@x.dev", hasPassword: false, emailVerified: true }, isAdmin: false },
}));

vi.mock("@/lib/hooks/useCurrentUser", () => ({ useCurrentUser: () => currentUser.value }));
vi.mock("@/features/onboarding/hooks", () => ({
  useCandidateProfile: () => ({ data: { fullName: "Aarav Sharma", targetRole: "Meesho SDE I", level: "sde1" } }),
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
    window.localStorage.clear();
    currentUser.value = {
      user: { name: "Aarav Sharma", email: "a@x.dev", hasPassword: false, emailVerified: true },
      isAdmin: false,
    };
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders the page with the top bar's breadcrumb, sidebar toggle and avatar", () => {
    renderShell();
    expect(screen.getByText("Page body")).toBeInTheDocument();
    const topBar = screen.getByRole("banner");
    expect(within(topBar).getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent("Home");
    expect(within(topBar).getByRole("button", { name: /toggle sidebar/i })).toHaveAttribute("aria-expanded", "true");
    expect(within(topBar).getByRole("button", { name: /account menu/i })).toBeInTheDocument();
    expect(within(topBar).getByRole("link", { name: "Feedback" })).toHaveAttribute("href", "/contact");
  });

  it("lists the grouped destinations, marks the current one, and shows the readiness and level", () => {
    renderShell();
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Companies" })).toHaveAttribute("href", "/jobs");
    expect(within(nav).getByRole("link", { name: "My tracks" })).toHaveAttribute("href", "/loops");
    expect(within(nav).queryByRole("link", { name: "Practice" })).toBeNull();
    expect(screen.getByText("No official track started yet")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Sidebar")).getByRole("link", { name: "Help" })).toHaveAttribute("href", "/help");
    expect(within(screen.getByLabelText("Sidebar")).getByRole("button", { name: /account menu/i })).toHaveTextContent("Aarav Sharma");
  });

  it("collapses to the rail with M, remembers it, and keeps every destination reachable by name", async () => {
    const user = userEvent.setup();
    const { unmount } = renderShell();
    const aside = screen.getByLabelText("Sidebar");
    expect(aside).toHaveClass("w-[248px]");

    await user.keyboard("m");
    expect(aside).toHaveClass("w-16");
    expect(window.localStorage.getItem("iq.sidebar.collapsed")).toBe("1");
    expect(within(aside).getByRole("link", { name: "Companies" })).toHaveAttribute("href", "/jobs");
    expect(within(aside).queryByText("No official track started yet")).not.toBeInTheDocument();
    unmount();

    renderShell();
    await waitFor(() => expect(screen.getByLabelText("Sidebar")).toHaveClass("w-16"));
    await user.keyboard("m");
    expect(screen.getByLabelText("Sidebar")).toHaveClass("w-[248px]");
    expect(window.localStorage.getItem("iq.sidebar.collapsed")).toBe("0");
  });

  it("opens expanded when the saved value is garbage or storage throws", () => {
    window.localStorage.setItem("iq.sidebar.collapsed", "yes");
    const { unmount } = renderShell();
    expect(screen.getByLabelText("Sidebar")).toHaveClass("w-[248px]");
    unmount();

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderShell();
    expect(screen.getByLabelText("Sidebar")).toHaveClass("w-[248px]");
  });

  it("still toggles when storage cannot be written", async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderShell();
    await user.keyboard("m");
    expect(screen.getByLabelText("Sidebar")).toHaveClass("w-16");
  });

  it("opens search with Ctrl+K and ignores M while typing in it", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.keyboard("{Control>}k{/Control}");
    const input = await screen.findByRole("combobox");
    await user.type(input, "m");
    expect(screen.getByLabelText("Sidebar")).toHaveClass("w-[248px]");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("combobox")).not.toBeInTheDocument());
  });

  it("ignores M and Ctrl+K on the live interview screen", async () => {
    const user = userEvent.setup();
    pathname.value = "/interviews/abc123/live";
    try {
      renderShell();
      await user.keyboard("m");
      expect(screen.getByLabelText("Sidebar")).toHaveClass("w-[248px]");
      await user.keyboard("{Control>}k{/Control}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    } finally {
      pathname.value = "/dashboard";
    }
  });

  it("shows admin destinations only to admins", () => {
    const { unmount } = renderShell();
    const nav = () => screen.getByRole("navigation", { name: "Main" });
    expect(within(nav()).queryByRole("link", { name: /intelligence/i })).not.toBeInTheDocument();
    expect(within(nav()).queryByRole("link", { name: /validation controls/i })).not.toBeInTheDocument();
    unmount();

    currentUser.value = { ...currentUser.value, isAdmin: true };
    renderShell();
    expect(within(nav()).getByRole("link", { name: /intelligence/i })).toHaveAttribute("href", "/intelligence");
    expect(within(nav()).getByRole("link", { name: /validation controls/i })).toHaveAttribute("href", "/admin/settings");
  });

  it("asks unverified password accounts to confirm their email", () => {
    currentUser.value = {
      user: { name: "Aarav Sharma", email: "a@x.dev", hasPassword: true, emailVerified: false },
      isAdmin: false,
    };
    renderShell();
    expect(screen.getByText(/confirm your email/i)).toBeInTheDocument();
  });

  it("shows no announcement strip while there is none", () => {
    renderShell();
    expect(screen.queryByRole("region", { name: "Announcement" })).not.toBeInTheDocument();
  });

  it("lets the invite card be dismissed and remembers it", async () => {
    const user = userEvent.setup();
    const { unmount } = renderShell();
    const card = await screen.findByRole("link", { name: "Bring your college" });
    expect(card).toHaveAttribute("href", "/for-colleges");
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("link", { name: "Bring your college" })).not.toBeInTheDocument();
    unmount();

    renderShell();
    await waitFor(() => expect(window.localStorage.getItem("iq.invite.dismissed")).toBe("1"));
    expect(screen.queryByRole("link", { name: "Bring your college" })).not.toBeInTheDocument();
  });
});
