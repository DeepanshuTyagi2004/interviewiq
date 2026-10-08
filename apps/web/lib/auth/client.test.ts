import { beforeEach, describe, expect, it, vi } from "vitest";
import { refresh, refreshSession } from "./client";
import { clearAccessToken, getAccessToken, setAccessToken } from "./token-store";

beforeEach(() => {
  vi.unstubAllGlobals();
  clearAccessToken();
});

describe("refresh", () => {
  it("stores the access token from a 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ accessToken: "fresh", expiresIn: 900 }), { status: 200 })));
    await expect(refresh()).resolves.toBe(true);
    expect(getAccessToken()).toBe("fresh");
  });

  it("treats a 204 (no session cookie at all) as signed out without reading a body", async () => {
    setAccessToken("stale", 900);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(refresh()).resolves.toBe(false);
    expect(getAccessToken()).toBeNull();
  });

  it("treats a 401 (a bad or expired cookie) as signed out", async () => {
    setAccessToken("stale", 900);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    await expect(refresh()).resolves.toBe(false);
    expect(getAccessToken()).toBeNull();
  });
});

describe("refreshSession", () => {
  it("keeps the token when the API can't answer: offline, restarting or a server error", async () => {
    setAccessToken("still-good", 900);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(refreshSession()).resolves.toBe("unreachable");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    await expect(refreshSession()).resolves.toBe("unreachable");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 429 })));
    await expect(refreshSession()).resolves.toBe("unreachable");
    expect(getAccessToken()).toBe("still-good");
  });

  it("separates no session from a bad one only by status, both signed out", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(refreshSession()).resolves.toBe("signed-out");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    await expect(refreshSession()).resolves.toBe("signed-out");
  });
});
