import { describe, expect, it, vi, beforeEach } from "vitest";
import { goLive, getLive } from "./api";
import * as client from "@/lib/api-client/client";
import { INTERVIEW_ENDPOINTS } from "@/lib/constants/interview";

describe("live api", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("goLive POSTs to the live endpoint", async () => {
    const spy = vi.spyOn(client, "apiFetch").mockResolvedValue({
      livekitUrl: "wss://x", token: "jwt", roomName: "interview-s1", status: "LIVE_IN_PROGRESS",
    } as never);
    const res = await goLive("s1");
    expect(spy).toHaveBeenCalledWith(INTERVIEW_ENDPOINTS.live("s1"), { method: "POST" });
    expect(res.token).toBe("jwt");
  });

  it("getLive GETs the live endpoint", async () => {
    const spy = vi.spyOn(client, "apiFetch").mockResolvedValue({
      livekitUrl: null, token: null, roomName: null, status: "PREP_READY",
    } as never);
    const res = await getLive("s1");
    expect(spy).toHaveBeenCalledWith(INTERVIEW_ENDPOINTS.live("s1"));
    expect(res.status).toBe("PREP_READY");
  });
});
