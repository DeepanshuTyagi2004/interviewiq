import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ValidationControlsPanel } from "./ValidationControlsPanel";
import { getValidationControls, patchValidationControl } from "@/features/admin-validation-controls/api";

vi.mock("@/features/admin-validation-controls/api", () => ({
  getValidationControls: vi.fn(),
  patchValidationControl: vi.fn(),
}));

vi.mock("@/components/auth/RequireAdmin", () => ({
  RequireAdmin: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { name: "Ada Admin", email: "ada@example.com" } }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const defaults = {
  linkedinImportEnabled: true,
  requireSectionReview: true,
};

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ValidationControlsPanel />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.clearAllMocks());

describe("ValidationControlsPanel", () => {
  it("renders GET settings, admin copy, persisted metadata, and accessible switches", async () => {
    vi.mocked(getValidationControls).mockResolvedValue({ settings: defaults, updatedAt: "2026-10-04T12:00:00.000Z", updatedBy: null });
    renderPanel();

    expect(await screen.findByRole("heading", { name: "Validation controls" })).toBeInTheDocument();
    expect(screen.getByText("Admin only")).toBeInTheDocument();
    expect(await screen.findByRole("switch", { name: "LinkedIn import enabled" })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: /Firecrawl|duplicate scrape|Canonical LinkedIn URL/ })).not.toBeInTheDocument();
    expect(screen.getByText(/current API response/)).toBeInTheDocument();
    expect(screen.getByText(/Turning this flag off does not auto-confirm/)).toBeInTheDocument();
  });

  it("PATCHes only the changed boolean and keeps the persisted response", async () => {
    vi.mocked(getValidationControls).mockResolvedValue({ settings: defaults, updatedAt: null, updatedBy: null });
    vi.mocked(patchValidationControl).mockResolvedValue({
      settings: { ...defaults, requireSectionReview: false },
      updatedAt: "2026-10-04T12:01:00.000Z",
      updatedBy: null,
    });
    renderPanel();

    const user = userEvent.setup();
    await user.click(await screen.findByRole("switch", { name: "Section review required" }));
    await waitFor(() => expect(patchValidationControl).toHaveBeenCalledWith("requireSectionReview", false));
    expect(screen.getByText("Section review required saved.")).toBeInTheDocument();
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });

  it("rolls the switch back and shows an inline error when PATCH fails", async () => {
    vi.mocked(getValidationControls).mockResolvedValue({ settings: defaults, updatedAt: null, updatedBy: null });
    vi.mocked(patchValidationControl).mockRejectedValue(new Error("Server rejected update"));
    renderPanel();

    const user = userEvent.setup();
    const control = await screen.findByRole("switch", { name: "Section review required" });
    expect(control).toHaveAttribute("aria-checked", "true");
    await user.click(control);
    await waitFor(() => expect(control).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByRole("alert")).toHaveTextContent("Server rejected update");
  });

  it("requires explicit confirmation before disabling LinkedIn import", async () => {
    vi.mocked(getValidationControls).mockResolvedValue({ settings: defaults, updatedAt: null, updatedBy: null });
    vi.mocked(patchValidationControl).mockResolvedValue({
      settings: { ...defaults, linkedinImportEnabled: false },
      updatedAt: "2026-10-04T12:02:00.000Z",
      updatedBy: null,
    });
    renderPanel();

    const user = userEvent.setup();
    await user.click(await screen.findByRole("switch", { name: "LinkedIn import enabled" }));
    expect(screen.getByRole("dialog", { name: /disable linkedin import enabled/i })).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByText(/stops all new LinkedIn PDF imports/)).toBeInTheDocument();
    expect(patchValidationControl).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Disable control" }));
    await waitFor(() => expect(patchValidationControl).toHaveBeenCalledWith("linkedinImportEnabled", false));
  });
});
