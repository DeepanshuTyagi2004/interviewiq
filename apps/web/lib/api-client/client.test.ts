import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./client";
import { refresh } from "@/lib/auth/client";

vi.mock("@/lib/auth/client", () => ({ refresh: vi.fn() }));
vi.mock("@/lib/auth/token-store", () => ({ getAccessToken: () => "access-token" }));

beforeEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });
describe("authenticated fetch mutation retry opt-out", () => {
  it("does not refresh or repeat a consequential LinkedIn request after a 401", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "unauthorized", message: "Expired" }), { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    await expect(apiFetch("/api/v1/users/me/linkedin/imports", { method: "POST", json: { url: "https://www.linkedin.com/in/me", consent: true }, retryAuth: false })).rejects.toMatchObject({ status: 401 });
    expect(fetch).toHaveBeenCalledTimes(1); expect(refresh).not.toHaveBeenCalled();
    expect(fetch.mock.calls[0][1]).not.toHaveProperty("retryAuth");
  });
  it("preserves the existing silent refresh for ordinary reads", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 401 })).mockResolvedValueOnce(new Response(JSON.stringify({ connected: false }), { status: 200 }));
    vi.stubGlobal("fetch", fetch); vi.mocked(refresh).mockResolvedValue(true);
    await expect(apiFetch("/api/v1/users/me/linkedin")).resolves.toEqual({ connected: false });
    expect(refresh).toHaveBeenCalledTimes(1); expect(fetch).toHaveBeenCalledTimes(2);
  });
});
