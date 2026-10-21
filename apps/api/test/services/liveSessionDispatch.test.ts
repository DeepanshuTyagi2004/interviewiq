import { describe, expect, it } from "vitest";
import { LiveKitTokenService, type AgentRooms } from "../../src/integrations/livekit.js";
import { LiveAvailability } from "../../src/services/liveAvailability.js";
import { LiveSessionService } from "../../src/services/liveSessions.js";

/**
 * The interviewer dispatch on its own: a fake room admin and a capturing logger, no database. Covers what the log says (which
 * caller, and why a dispatch was or was not made) and that the two presence checks run side by side, not one after the other.
 */

const ME = "u1";
const SID = "s1";

function build(rooms: Partial<AgentRooms> & { calls?: string[] } = {}) {
  const calls: string[] = rooms.calls ?? [];
  const row = { id: SID, candidateId: ME, status: "PREP_READY", liveStartedAt: null } as never;
  const sessions = {
    findByIdAndCandidateId: async (_id: string, candidate: string) => (candidate === ME ? row : null),
    transitionStatus: async () => ({ ...(row as object), status: "LIVE_IN_PROGRESS" }),
  } as never;
  const fake: AgentRooms = {
    dispatchAgent: rooms.dispatchAgent ?? (async () => { calls.push("dispatch"); }),
    hasAgent: rooms.hasAgent ?? (async () => false),
    hasDispatch: rooms.hasDispatch ?? (async () => false),
  };
  const lines: string[] = [];
  const log = { info: (m: string) => lines.push(`info ${m}`), warn: (m: string) => lines.push(`warn ${m}`) } as never;
  const service = new LiveSessionService(
    sessions,
    new LiveKitTokenService("wss://x", "k", "secret-secret-secret-secret-secret-1"),
    { recordSeen: async () => {} } as never,
    new LiveAvailability(true),
    fake,
    null,
    log,
    null,
    null,
    { assertCanInterview: async () => {} } as never,
  );
  return { service, lines, calls };
}
const interviewerLines = (lines: string[]) => lines.filter((l) => l.includes("interviewer for session"));

describe("the interviewer dispatch log", () => {
  it("says who asked, and that it dispatched because nobody was there", async () => {
    const { service, lines } = build();
    await service.warm(ME, SID);
    expect(interviewerLines(lines)).toEqual([`info interviewer for session ${SID} (warm): dispatched, none in the room`]);
  });

  it("says go-live asked, and why it did not dispatch: the interviewer is already in the room", async () => {
    const { service, lines } = build({ hasAgent: async () => true });
    await service.startLive(ME, SID);
    expect(interviewerLines(lines)).toEqual([`info interviewer for session ${SID} (go-live): skipped, interviewer in the room`]);
  });

  it("says skipped because a dispatch is pending, and because one went out under 30 seconds ago", async () => {
    const pending = build({ hasDispatch: async () => true });
    await pending.service.warm(ME, SID);
    expect(interviewerLines(pending.lines)).toEqual([`info interviewer for session ${SID} (warm): skipped, interviewer dispatch pending`]);

    const recent = build();
    await recent.service.warm(ME, SID); // dispatches
    await recent.service.startLive(ME, SID); // the warm-up dispatched a moment ago
    expect(interviewerLines(recent.lines)).toEqual([
      `info interviewer for session ${SID} (warm): dispatched, none in the room`,
      `info interviewer for session ${SID} (go-live): skipped, dispatched under 30 s ago`,
    ]);
  });

  it("says when LiveKit refused the dispatch", async () => {
    const { service, lines } = build({ dispatchAgent: async () => { throw new Error("500"); } });
    await service.warm(ME, SID);
    expect(interviewerLines(lines)).toContain(`info interviewer for session ${SID} (warm): failed, LiveKit refused the dispatch`);
  });
});

describe("the presence checks before a dispatch", () => {
  it("run side by side, not one after the other", async () => {
    let inFlight = 0;
    let most = 0;
    const slow = (answer: boolean) => async () => {
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight--;
      return answer;
    };
    const { service } = build({ hasAgent: slow(false), hasDispatch: slow(false) });
    await service.warm(ME, SID);
    expect(most).toBe(2);
  });

  it("a failed check does not hide a positive one: the interviewer is not dispatched twice", async () => {
    const { service, calls, lines } = build({ hasAgent: async () => { throw new Error("500"); }, hasDispatch: async () => true });
    expect(await service.warm(ME, SID)).toEqual({ warming: true });
    expect(calls).toEqual([]); // no dispatch
    expect(lines.filter((l) => l.startsWith("warn"))).toHaveLength(1);
  });

  it("two failed checks still dispatch, with one warning that names both", async () => {
    const { service, calls, lines } = build({
      hasAgent: async () => { throw new Error("a"); },
      hasDispatch: async () => { throw new Error("b"); },
    });
    expect(await service.warm(ME, SID)).toEqual({ warming: true });
    expect(calls).toEqual(["dispatch"]);
    expect(lines.filter((l) => l.startsWith("warn"))).toHaveLength(1);
  });
});
