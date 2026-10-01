import { decodeJwt, decodeProtectedHeader, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import { LiveKitTokenService } from "../../src/integrations/livekit.js";

/** Ported from integrations/livekit/LiveKitTokenServiceTest.java. */

// >= 32 chars so HS256 accepts the key
const API_KEY = "APItestkey";
const API_SECRET = "test-secret-0123456789-0123456789-abc";

const SID = "11111111-1111-1111-1111-111111111111";
const CID = "22222222-2222-2222-2222-222222222222";

describe("LiveKitTokenService (ported from LiveKitTokenServiceTest)", () => {
  const svc = new LiveKitTokenService("wss://x.livekit.cloud", API_KEY, API_SECRET);

  it("roomNameIsDerivedFromSessionId", () => {
    expect(svc.roomName(SID)).toBe("interview-11111111-1111-1111-1111-111111111111");
  });

  it("mintedTokenIsSignedAndCarriesJoinGrant", async () => {
    const jwt = await svc.mintCandidateToken(SID, CID);

    // token must be HS256-signed with the api secret
    expect(decodeProtectedHeader(jwt).alg).toBe("HS256");
    const { payload: verified } = await jwtVerify(jwt, new TextEncoder().encode(API_SECRET), { algorithms: ["HS256"] });

    const claims = decodeJwt(jwt);
    expect(claims).toEqual(verified);
    expect(claims.iss).toBe(API_KEY); // LiveKit: iss = api key
    expect(claims.sub).toBe(CID); // sub = participant identity
    expect(claims.name).toBe(CID);
    expect(claims.exp).toBeTypeOf("number");

    // the "video" claim is LiveKit's VideoGrant: {"roomJoin": true, "room": "interview-<sessionId>"}
    const video = claims.video as Record<string, unknown> | undefined;
    expect(video).toBeDefined();
    expect(video!.room).toBe(`interview-${SID}`); // grant must scope to the session's room
    expect(video!.roomJoin).toBe(true); // grant must allow joining the room
    expect(video).toEqual({ roomJoin: true, room: `interview-${SID}` }); // and nothing broader
  });

  it("token expires ~1h after minting", async () => {
    const before = Math.floor(Date.now() / 1000);
    const claims = decodeJwt(await svc.mintCandidateToken(SID, CID));
    const after = Math.ceil(Date.now() / 1000);
    expect(claims.exp!).toBeGreaterThanOrEqual(before + 3600 - 1);
    expect(claims.exp!).toBeLessThanOrEqual(after + 3600 + 1);
    expect(claims.exp! - claims.nbf!).toBe(3600);
  });

  it("a token signed with a different secret does not verify", async () => {
    const other = new LiveKitTokenService("wss://x.livekit.cloud", API_KEY, "another-secret-0123456789-0123456789-xyz");
    const jwt = await other.mintCandidateToken(SID, CID);
    await expect(jwtVerify(jwt, new TextEncoder().encode(API_SECRET), { algorithms: ["HS256"] })).rejects.toThrow();
  });

  it("livekitUrlIsExposed", () => {
    expect(svc.livekitUrl()).toBe("wss://x.livekit.cloud");
  });
});
