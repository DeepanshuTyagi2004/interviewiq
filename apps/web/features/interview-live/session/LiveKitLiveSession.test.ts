import { describe, expect, it, vi, beforeEach } from "vitest";

// a controllable fake Room
const handlers: Record<string, (...a: unknown[]) => void> = {};
const publishData = vi.fn();
const connect = vi.fn(async () => {});
const disconnect = vi.fn(async () => {});
vi.mock("livekit-client", () => ({
  Room: class {
    localParticipant = { publishData };
    on(event: string, cb: (...a: unknown[]) => void) { handlers[event] = cb; return this; }
    connect = connect;
    disconnect = disconnect;
  },
  RoomEvent: { DataReceived: "dataReceived", ConnectionStateChanged: "connectionStateChanged" },
  ConnectionState: { Connecting: "connecting", Connected: "connected", Reconnecting: "reconnecting", SignalReconnecting: "signalReconnecting", Disconnected: "disconnected" },
}));
vi.mock("@/features/interview/api", () => ({
  goLive: vi.fn(async () => ({ livekitUrl: "wss://x", token: "jwt", roomName: "interview-s1", status: "LIVE_IN_PROGRESS" })),
}));

import { LiveKitLiveSession } from "./LiveKitLiveSession";
import { goLive } from "@/features/interview/api";

describe("LiveKitLiveSession", () => {
  beforeEach(() => { for (const k in handlers) delete handlers[k]; vi.clearAllMocks(); });

  it("connect fetches a token, connects the room, and reports connected", async () => {
    const s = new LiveKitLiveSession();
    const seen: string[] = [];
    s.onConnectionChange((st) => seen.push(st));
    await s.connect("s1");
    expect(goLive).toHaveBeenCalledWith("s1");
    expect(connect).toHaveBeenCalledWith("wss://x", "jwt");
    expect(s.connectionState).toBe("connected");
    expect(seen).toContain("connecting");
    expect(seen).toContain("connected");
  });

  it("maps inbound data messages to onControl", async () => {
    const s = new LiveKitLiveSession();
    const got: unknown[] = [];
    s.onControl((c) => got.push(c));
    await s.connect("s1");
    const payload = new TextEncoder().encode(JSON.stringify({ type: "interviewer_utterance", text: "hi" }));
    handlers["dataReceived"](payload);
    expect(got).toContainEqual({ type: "interviewer_utterance", text: "hi" });
  });

  it("maps ConnectionStateChanged(reconnecting) to onConnectionChange", async () => {
    const s = new LiveKitLiveSession();
    const seen: string[] = [];
    await s.connect("s1");
    s.onConnectionChange((st) => seen.push(st));
    handlers["connectionStateChanged"]("reconnecting");
    expect(seen).toContain("reconnecting");
  });

  it("sendProctorEvent publishes a proctor message", async () => {
    const s = new LiveKitLiveSession();
    await s.connect("s1");
    s.sendProctorEvent({ type: "fullscreen_exit", at: 1 });
    const sent = JSON.parse(new TextDecoder().decode(publishData.mock.calls[0][0] as Uint8Array));
    expect(sent).toEqual({ type: "proctor", event: "fullscreen_exit" });
  });

  it("malformed inbound data does not throw", async () => {
    const s = new LiveKitLiveSession();
    await s.connect("s1");
    expect(() => handlers["dataReceived"](new TextEncoder().encode("not json"))).not.toThrow();
  });

  it("connect rejection resets connectionState to disconnected and rethrows", async () => {
    connect.mockRejectedValueOnce(new Error("room down"));
    const s = new LiveKitLiveSession();
    const seen: string[] = [];
    s.onConnectionChange((st) => seen.push(st));
    await expect(s.connect("s1")).rejects.toThrow("room down");
    expect(s.connectionState).toBe("disconnected");
    expect(seen).toContain("disconnected");
  });
});
