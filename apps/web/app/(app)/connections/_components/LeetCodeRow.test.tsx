import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { connectMutate, disconnectMutate, profileState } = vi.hoisted(() => ({
  connectMutate: vi.fn(),
  disconnectMutate: vi.fn(),
  profileState: { data: undefined as unknown },
}));

vi.mock("@/features/profile", () => ({
  useProfile: () => profileState,
  useConnectLeetCode: () => ({ mutate: connectMutate, isPending: false }),
  useDisconnectLeetCode: () => ({ mutate: disconnectMutate, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-client/client", () => {
  class ApiFetchError extends Error {
    constructor(
      readonly status: number,
      readonly code: string | undefined,
      message: string,
    ) {
      super(message);
    }
  }
  return { ApiFetchError };
});

import { ApiFetchError } from "@/lib/api-client/client";
import { LeetCodeRow } from "./LeetCodeRow";
import { PROVIDERS } from "./providers";

const provider = PROVIDERS.find((p) => p.source === "LEETCODE")!;

function withSource(source: Record<string, unknown> | null, leetcode?: Record<string, unknown>) {
  profileState.data = {
    sources: source ? [{ source: "LEETCODE", ...source }] : [],
    fragments: leetcode ? { leetcode } : {},
  };
}

describe("LeetCodeRow", () => {
  beforeEach(() => {
    connectMutate.mockReset();
    disconnectMutate.mockReset();
  });

  it("opens the username form from Connect and submits the normalised handle", async () => {
    withSource({ connected: false });
    const user = userEvent.setup();
    render(<LeetCodeRow provider={provider} />);

    // The form is collapsed until the row's Connect is pressed.
    expect(screen.getByLabelText(/leetcode username/i)).not.toBeVisible();
    await user.click(screen.getByRole("button", { name: /connect leetcode/i }));
    expect(screen.getByLabelText(/leetcode username/i)).toBeVisible();

    await user.type(screen.getByLabelText(/leetcode username/i), "https://leetcode.com/u/asha_rao/");
    await user.click(screen.getByRole("button", { name: /^connect leetcode$/i }));

    expect(connectMutate).toHaveBeenCalledWith("asha_rao", expect.any(Object));
  });

  it("submits on Enter, like a form, without being a nested <form>", async () => {
    withSource({ connected: false });
    const user = userEvent.setup();
    const { container } = render(<LeetCodeRow provider={provider} />);
    await user.click(screen.getByRole("button", { name: /connect leetcode/i }));
    await user.type(screen.getByLabelText(/leetcode username/i), "@asha{Enter}");

    expect(connectMutate).toHaveBeenCalledWith("asha", expect.any(Object));
    expect(container.querySelector("form")).toBeNull();
  });

  it("shows the mapped message when the profile is private", async () => {
    withSource({ connected: false });
    connectMutate.mockImplementation((_handle: string, opts: { onError: (e: unknown) => void }) =>
      opts.onError(new ApiFetchError(422, "leetcode_profile_private", "private")),
    );
    const user = userEvent.setup();
    render(<LeetCodeRow provider={provider} />);
    await user.click(screen.getByRole("button", { name: /connect leetcode/i }));
    await user.type(screen.getByLabelText(/leetcode username/i), "asha");
    await user.click(screen.getByRole("button", { name: /^connect leetcode$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/profile is private/i);
  });

  it("describes a synced connection with counts only and disconnects", async () => {
    withSource(
      { connected: true, status: "SYNCED", lastRefreshedAt: new Date().toISOString() },
      { username: "asha", solved: { easy: 1, medium: 2, hard: 3, total: 6 }, byTopic: [] },
    );
    const user = userEvent.setup();
    render(<LeetCodeRow provider={provider} />);

    expect(screen.getByText(/@asha · 6 solved · synced/)).toBeInTheDocument();
    expect(screen.getByText("Synced")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /disconnect/i }));
    expect(disconnectMutate).toHaveBeenCalledTimes(1);
  });

  it("offers Retry after a failed sync", async () => {
    withSource({ connected: true, status: "FAILED" }, { username: "asha", solved: { easy: 0, medium: 0, hard: 0 }, byTopic: [] });
    const user = userEvent.setup();
    render(<LeetCodeRow provider={provider} />);

    expect(screen.getByRole("alert")).toHaveTextContent(/last import failed/i);
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(connectMutate).toHaveBeenCalledWith("asha", expect.any(Object));
  });
});
