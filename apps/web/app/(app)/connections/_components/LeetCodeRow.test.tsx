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

  describe("status dot", () => {
    /** The row's dot: its sr-only label and the dot span before it. */
    function dot(label: string) {
      const text = screen.getAllByText(label).find((el) => el.classList.contains("sr-only"));
      expect(text).toBeDefined();
      return text!.previousElementSibling as HTMLElement;
    }

    /** The row's StatusDot (the status chip carries no dot of its own). */
    function hudDot(container: HTMLElement) {
      const el = container.querySelector("span.inline-flex > [aria-hidden].h-1\\.5");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    }

    it("pulses only while the import is really syncing, without repeating the pill to screen readers", () => {
      withSource({ connected: true, status: "SYNCING" }, { username: "asha" });
      const { container } = render(<LeetCodeRow provider={provider} />);
      expect(hudDot(container)).toHaveAttribute("data-motion");
      // The visible "Syncing" pill says it; the dot adds no sr-only "Syncing" of its own.
      expect(screen.getAllByText("Syncing")).toHaveLength(1);
      expect(screen.getByText("Syncing")).not.toHaveClass("sr-only");
    });

    it("is steady once synced", () => {
      withSource({ connected: true, status: "SYNCED" }, { username: "asha" });
      render(<LeetCodeRow provider={provider} />);
      expect(dot("Connected")).not.toHaveAttribute("data-motion");
    });

    it("shows an error for a failed sync, leaving the 'Sync failed' pill to say so", () => {
      withSource({ connected: true, status: "FAILED" }, { username: "asha" });
      const { container } = render(<LeetCodeRow provider={provider} />);
      expect(hudDot(container)).toHaveClass("bg-destructive");
      expect(screen.getByText("Sync failed")).not.toHaveClass("sr-only");
      expect(screen.queryByText("Sync error")).toBeNull();
    });

    it("labels an errored connect as a failed connection, not a sync error", () => {
      withSource({ connected: false });
      render(<LeetCodeRow provider={provider} errored />);
      expect(dot("Connection failed")).toHaveClass("bg-destructive");
      expect(screen.queryByText("Sync error")).toBeNull();
    });

    it("is idle when not connected", () => {
      withSource({ connected: false });
      render(<LeetCodeRow provider={provider} />);
      expect(dot("Not connected")).not.toHaveAttribute("data-motion");
    });
  });
});
