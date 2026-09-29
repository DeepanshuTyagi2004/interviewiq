import { describe, expect, it } from "vitest";
import { render, act } from "@testing-library/react";
import { useEffect } from "react";
import type { ConnState, ControlSignal, LiveSession } from "./types";
import { LiveSessionProvider, useLiveSession } from "./LiveSessionProvider";

class StubLiveSession implements LiveSession {
  connectionState: ConnState = "connected";
  private cc = new Set<(s: ConnState) => void>();
  emitConn(s: ConnState) { this.connectionState = s; this.cc.forEach((cb) => cb(s)); }
  async connect() {} async disconnect() {}
  getLocalStream() { return null; } setMicEnabled() {} setCameraEnabled() {}
  sendArtifact() {} sendProctorEvent() {}
  onControl(_cb: (c: ControlSignal) => void) { return () => {}; }
  onConnectionChange(cb: (s: ConnState) => void) { this.cc.add(cb); return () => this.cc.delete(cb); }
}

function Probe({ onState }: { onState: (s: string) => void }) {
  const { state, send } = useLiveSession();
  useEffect(() => { onState(state); });
  // drive to live so RECONNECTING is a legal transition
  useEffect(() => { send({ type: "START_CHECKS" }); send({ type: "CHECKS_PASSED" }); send({ type: "CONNECTED" }); }, [send]);
  return null;
}

describe("provider connection bridge", () => {
  it("reconnecting ConnState drives the machine to reconnecting and back", () => {
    const session = new StubLiveSession();
    const states: string[] = [];
    render(
      <LiveSessionProvider sessionId="s1" session={session}>
        <Probe onState={(s) => states.push(s)} />
      </LiveSessionProvider>,
    );
    act(() => session.emitConn("reconnecting"));
    expect(states).toContain("reconnecting");
    act(() => session.emitConn("connected"));
    expect(states.at(-1)).toBe("live");
  });
});
