import { decodeJwt } from "jose";
import { describe, expect, it } from "vitest";
import { LiveKitRoomAdmin, ROOM_EMPTY_TIMEOUT_SECONDS } from "../../src/integrations/livekit.js";
import { FakeFetch, json } from "../support/fakeFetch.js";

const SID = "11111111-1111-1111-1111-111111111111";
const SECRET = "secret-secret-secret-secret-secret-1";

describe("LiveKitRoomAdmin", () => {
  it("dispatches the interviewer into the session's room with the session id as metadata", async () => {
    const fake = new FakeFetch().on("POST", /AgentDispatchService\/CreateDispatch$/, {});
    await new LiveKitRoomAdmin("wss://x.livekit.cloud", "APIkey", SECRET, fake.fetch).dispatchAgent(SID);
    const call = fake.callsTo(/CreateDispatch/)[0]!;
    expect(call.url).toBe("https://x.livekit.cloud/twirp/livekit.AgentDispatchService/CreateDispatch");
    expect(call.json).toEqual({ room: `interview-${SID}`, agent_name: "interviewer", metadata: JSON.stringify({ session_id: SID }) });
    const claims = decodeJwt(call.headers.authorization!.replace("Bearer ", ""));
    expect(claims.video).toEqual({ roomAdmin: true, roomList: true, room: `interview-${SID}` });
  });

  it("creates the room with a long empty timeout before dispatching, so a waiting interviewer is not closed at LiveKit's five minutes", async () => {
    const fake = new FakeFetch().on("POST", /RoomService\/CreateRoom$/, {}).on("POST", /AgentDispatchService\/CreateDispatch$/, {});
    await new LiveKitRoomAdmin("wss://x.livekit.cloud", "APIkey", SECRET, fake.fetch).dispatchAgent(SID);
    expect(fake.calls.map((c) => c.url.split("/").pop())).toEqual(["CreateRoom", "CreateDispatch"]);
    const create = fake.callsTo(/CreateRoom/)[0]!;
    expect(create.json).toEqual({ name: `interview-${SID}`, empty_timeout: ROOM_EMPTY_TIMEOUT_SECONDS });
    expect(ROOM_EMPTY_TIMEOUT_SECONDS).toBeGreaterThan(15 * 60); // longer than the worker's own 15-minute wait for a candidate
    expect(decodeJwt(create.headers.authorization!.replace("Bearer ", "")).video).toMatchObject({ roomCreate: true, room: `interview-${SID}` });
    const dispatch = fake.callsTo(/CreateDispatch/)[0]!;
    expect(decodeJwt(dispatch.headers.authorization!.replace("Bearer ", "")).video).toEqual({ roomAdmin: true, roomList: true, room: `interview-${SID}` });
  });

  it("still dispatches when creating the room fails (CreateDispatch makes the room itself)", async () => {
    const fake = new FakeFetch()
      .on("POST", /RoomService\/CreateRoom$/, () => json({ code: "internal" }, 500))
      .on("POST", /AgentDispatchService\/CreateDispatch$/, {});
    await new LiveKitRoomAdmin("wss://x.livekit.cloud", "APIkey", SECRET, fake.fetch).dispatchAgent(SID);
    expect(fake.callsTo(/CreateDispatch/)).toHaveLength(1);
  });

  it("knows whether an agent is in the room", async () => {
    // FakeFetch: a later registration wins, so register the second answer first.
    const fake = new FakeFetch()
      .once("POST", /ListParticipants$/, { participants: [{ identity: "agent-1", kind: "AGENT" }] })
      .once("POST", /ListParticipants$/, { participants: [{ identity: "u1", kind: "STANDARD" }] });
    const admin = new LiveKitRoomAdmin("wss://x.livekit.cloud", "APIkey", SECRET, fake.fetch);
    expect(await admin.hasAgent(SID)).toBe(false);
    expect(await admin.hasAgent(SID)).toBe(true);
  });

  it("treats a room that does not exist yet as having no agent, but still fails on real errors", async () => {
    const missing = new FakeFetch().on("POST", /ListParticipants$/, () => json({ code: "not_found", msg: "requested room does not exist" }, 404));
    expect(await new LiveKitRoomAdmin("wss://x.livekit.cloud", "APIkey", SECRET, missing.fetch).hasAgent(SID)).toBe(false);
    const broken = new FakeFetch().on("POST", /ListParticipants$/, () => json({ code: "internal" }, 500));
    await expect(new LiveKitRoomAdmin("wss://x.livekit.cloud", "APIkey", SECRET, broken.fetch).hasAgent(SID)).rejects.toThrow();
  });

  describe("hasDispatch", () => {
    const admin = (answer: unknown) =>
      new LiveKitRoomAdmin("wss://x.livekit.cloud", "APIkey", SECRET, new FakeFetch().on("POST", /ListDispatch$/, answer).fetch);
    const dispatch = (jobs: unknown[], extra: Record<string, unknown> = {}) => ({
      agent_dispatches: [{ id: "AD_1", agent_name: "interviewer", room: `interview-${SID}`, state: { jobs }, ...extra }],
    });

    it("is true for a dispatch whose job has not started, or is still pending or running", async () => {
      expect(await admin(dispatch([])).hasDispatch(SID)).toBe(true);
      expect(await admin(dispatch([{ state: { status: "JS_PENDING" } }])).hasDispatch(SID)).toBe(true);
      expect(await admin(dispatch([{ state: { status: "JS_RUNNING" } }])).hasDispatch(SID)).toBe(true);
      expect(await admin(dispatch([{ state: { status: 1 } }])).hasDispatch(SID)).toBe(true);
    });

    it("is false once the job finished, the dispatch was deleted, or it belongs to another agent", async () => {
      expect(await admin(dispatch([{ state: { status: "JS_SUCCESS" } }])).hasDispatch(SID)).toBe(false);
      expect(await admin(dispatch([{ state: { status: "JS_FAILED" } }])).hasDispatch(SID)).toBe(false);
      expect(await admin(dispatch([{ state: { status: 2 } }])).hasDispatch(SID)).toBe(false);
      expect(await admin(dispatch([], { deleted_at: "1760000000" })).hasDispatch(SID)).toBe(false);
      expect(await admin(dispatch([], { agent_name: "someone-else" })).hasDispatch(SID)).toBe(false);
      expect(await admin({ agent_dispatches: [] }).hasDispatch(SID)).toBe(false);
      expect(await admin({}).hasDispatch(SID)).toBe(false);
    });

    it("ignores the room's unnamed default dispatch that LiveKit adds, and a never-deleted one reads as not deleted", async () => {
      const real = { agent_dispatches: [
        { id: "AD_0", agent_name: "", state: { jobs: [], deleted_at: "0" }, deleted_at: "0" },
        { id: "AD_1", agent_name: "interviewer", state: { jobs: [] }, deleted_at: "0" },
      ] };
      expect(await admin(real).hasDispatch(SID)).toBe(true);
      expect(await admin({ agent_dispatches: [real.agent_dispatches[0]] }).hasDispatch(SID)).toBe(false);
    });

    it("reads camelCase keys too", async () => {
      const camel = { agentDispatches: [{ id: "AD_1", agentName: "interviewer", state: { jobs: [] } }] };
      expect(await admin(camel).hasDispatch(SID)).toBe(true);
    });

    it("treats a room that does not exist as having no dispatch, but still fails on real errors", async () => {
      const missing = new FakeFetch().on("POST", /ListDispatch$/, () => json({ code: "not_found", msg: "requested room does not exist" }, 404));
      expect(await new LiveKitRoomAdmin("wss://x.livekit.cloud", "APIkey", SECRET, missing.fetch).hasDispatch(SID)).toBe(false);
      const broken = new FakeFetch().on("POST", /ListDispatch$/, () => json({ code: "internal" }, 500));
      await expect(new LiveKitRoomAdmin("wss://x.livekit.cloud", "APIkey", SECRET, broken.fetch).hasDispatch(SID)).rejects.toThrow();
    });
  });
});
