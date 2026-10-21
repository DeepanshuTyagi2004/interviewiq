import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client/client", () => ({ apiFetch: mocks.apiFetch }));
vi.mock("@/lib/auth/AuthProvider", () => ({ useAuth: () => ({ isAuthenticated: true }) }));

import { canInterviewRole, useCurrentUser } from "./useCurrentUser";

function renderForRole(role: string) {
  mocks.apiFetch.mockResolvedValue({ id: "u1", role });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => useCurrentUser(), { wrapper });
}

describe("canInterview", () => {
  it("is false while the user is still loading", () => {
    mocks.apiFetch.mockReturnValue(new Promise(() => {}));
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useCurrentUser(), { wrapper });
    expect(result.current.canInterview).toBe(false);
    // not blocked either: the note must not flash while we do not know the role yet
    expect(result.current.interviewBlocked).toBe(false);
  });

  it("is false for USER", async () => {
    const { result } = renderForRole("USER");
    await waitFor(() => expect(result.current.user).not.toBeNull());
    expect(result.current.canInterview).toBe(false);
    expect(result.current.interviewBlocked).toBe(true);
  });

  it("is true for CANDIDATE", async () => {
    const { result } = renderForRole("CANDIDATE");
    await waitFor(() => expect(result.current.user).not.toBeNull());
    expect(result.current.canInterview).toBe(true);
    expect(result.current.interviewBlocked).toBe(false);
  });

  it("is true for ADMIN", async () => {
    const { result } = renderForRole("ADMIN");
    await waitFor(() => expect(result.current.user).not.toBeNull());
    expect(result.current.canInterview).toBe(true);
    expect(result.current.interviewBlocked).toBe(false);
  });

  it("canInterviewRole is false for a missing role", () => {
    expect(canInterviewRole(undefined)).toBe(false);
    expect(canInterviewRole(null)).toBe(false);
  });
});
