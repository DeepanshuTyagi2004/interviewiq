import { describe, expect, it, vi, beforeEach } from "vitest";

// a controllable fake Room
const handlers: Record<string, (...a: unknown[]) => void> = {};
const publishData = vi.fn();
const connect = vi.fn(async () => {});
const disconnect = vi.fn(async () => {});
const setMicrophoneEnabled = vi.fn(async () => {});
const startAudio = vi.fn(async () => {});
vi.mock("livekit-client", () => ({
  Room: class {
    localParticipant = { publishData, setMicrophoneEnabled };
    on(event: string, cb: (...a: unknown[]) => void) { handlers[event] = cb; return this; }
    connect = connect;
    disconnect = disconnect;
    startAudio = startAudio;
  },
  RoomEvent: { DataReceived: "dataReceived", ConnectionStateChanged: "connectionStateChanged", TrackSubscribed: "trackSubscribed" },
  ConnectionState: { Connecting: "connecting", Connected: "connected", Reconnecting: "reconnecting", SignalReconnecting: "signalReconnecting", Disconnected: "disconnected" },
  Track: { Kind: { Audio: "audio", Video: "video" } },
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

  it("a goLive() rejection also resets connectionState to disconnected and rethrows", async () => {
    vi.mocked(goLive).mockRejectedValueOnce(new Error("network down"));
    const s = new LiveKitLiveSession();
    const seen: string[] = [];
    s.onConnectionChange((st) => seen.push(st));

    await expect(s.connect("s1")).rejects.toThrow("network down");

    expect(s.connectionState).toBe("disconnected");
    expect(seen).toContain("disconnected");
    // never got far enough to touch the room
    expect(connect).not.toHaveBeenCalled();
  });

  it("does not force-set 'connected' if a truer connection state already arrived before the trailing set", async () => {
    // Deterministically simulating the exact getUserMedia-await race is brittle (fake timers
    // don't interleave real microtask-based mocks reliably), so — per the task's documented
    // fallback — we instead prove the guard itself: have the room's own
    // ConnectionStateChanged handler report a drop (same mock shape as the "maps
    // ConnectionStateChanged(reconnecting)" test above) before room.connect() resolves, then
    // assert the trailing unconditional set is skipped because connectionState is no longer
    // 'connecting' by the time it would run.
    connect.mockImplementationOnce(async () => {
      handlers["connectionStateChanged"]("disconnected")
    });
    const s = new LiveKitLiveSession();
    const seen: string[] = [];
    s.onConnectionChange((st) => seen.push(st));

    await s.connect("s1");

    // the trailing unconditional setConn('connected') must have been skipped since
    // connectionState was already 'disconnected' (not 'connecting') by the time it ran.
    expect(s.connectionState).toBe("disconnected");
    expect(seen).not.toContain("connected");
  });

  it("publishes the candidate mic on connect", async () => {
    const s = new LiveKitLiveSession();
    await s.connect("s1");
    expect(setMicrophoneEnabled).toHaveBeenCalledWith(true);
  });

  it("attaches and plays a subscribed AI audio track", async () => {
    const s = new LiveKitLiveSession();
    await s.connect("s1");
    const attach = vi.fn(() => document.createElement("audio"));
    const fakeTrack = { kind: "audio", attach, detach: vi.fn() };
    handlers["trackSubscribed"](fakeTrack);
    expect(attach).toHaveBeenCalled();
  });

  it("ignores subscribed non-audio tracks", async () => {
    const s = new LiveKitLiveSession();
    await s.connect("s1");
    const attach = vi.fn(() => document.createElement("video"));
    handlers["trackSubscribed"]({ kind: "video", attach, detach: vi.fn() });
    expect(attach).not.toHaveBeenCalled();
  });

  it("calls startAudio (best-effort) on connect", async () => {
    const s = new LiveKitLiveSession();
    await s.connect("s1");
    expect(startAudio).toHaveBeenCalled();
  });

  it("connect still succeeds if startAudio/mic publish reject", async () => {
    setMicrophoneEnabled.mockRejectedValueOnce(new Error("no mic"));
    startAudio.mockRejectedValueOnce(new Error("autoplay blocked"));
    const s = new LiveKitLiveSession();
    await expect(s.connect("s1")).resolves.toBeUndefined();
    expect(s.connectionState).toBe("connected");
  });

  it("detaches attached audio on disconnect", async () => {
    const s = new LiveKitLiveSession();
    await s.connect("s1");
    const detach = vi.fn();
    const el = document.createElement("audio");
    handlers["trackSubscribed"]({ kind: "audio", attach: () => el, detach });
    await s.disconnect();
    expect(detach).toHaveBeenCalled();
  });
});
