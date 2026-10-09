import { decodeJwt } from "jose";
import { describe, expect, it } from "vitest";
import { LiveKitRoomAdmin } from "../../src/integrations/livekit.js";
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
});
