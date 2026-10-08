import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthProvider";
import { refreshSession } from "./client";

vi.mock("./client", () => ({
  refreshSession: vi.fn(),
  loginWithGoogle: vi.fn(),
  loginWithPassword: vi.fn(),
  logout: vi.fn(),
  registerWithPassword: vi.fn(),
}));

function Status() {
  return <p data-testid="status">{useAuth().status}</p>;
}

function renderProvider() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider>
        <Status />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("AuthProvider", () => {
  it("does not sign anyone out while the API is unreachable, and recovers when it answers", async () => {
    vi.mocked(refreshSession).mockResolvedValueOnce("unreachable").mockResolvedValueOnce("ok");
    renderProvider();
    await act(async () => {});
    expect(screen.getByTestId("status")).toHaveTextContent("loading");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(refreshSession).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
  });

  it("signs out when the API says there is no session", async () => {
    vi.mocked(refreshSession).mockResolvedValueOnce("signed-out");
    renderProvider();
    await act(async () => {});
    expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated");
  });
});
