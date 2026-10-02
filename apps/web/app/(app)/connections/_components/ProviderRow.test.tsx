import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/profile", () => ({
  useDisconnectGithub: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-client/client", () => ({ apiFetch: vi.fn() }));

import { ProviderRow } from "./ProviderRow";
import { PROVIDERS } from "./providers";

const github = PROVIDERS.find((p) => p.source === "GITHUB")!;

describe("ProviderRow status dot", () => {
  it("reads a failed OAuth connect as 'Connection failed', not a sync error", () => {
    render(<ProviderRow provider={github} connected={false} errored />);

    const label = screen.getByText("Connection failed");
    expect(label).toHaveClass("sr-only");
    expect(label.previousElementSibling).toHaveClass("bg-destructive");
    expect(screen.queryByText("Sync error")).toBeNull();
  });

  it("keeps the default label when the connection is fine", () => {
    render(<ProviderRow provider={github} connected summary="@asha · 3 public repos" />);
    expect(screen.getByText("Connected")).toHaveClass("sr-only");
    expect(screen.queryByText("Connection failed")).toBeNull();
  });
});
