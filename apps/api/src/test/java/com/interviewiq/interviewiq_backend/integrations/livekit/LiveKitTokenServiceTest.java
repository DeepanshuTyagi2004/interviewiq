package com.interviewiq.interviewiq_backend.integrations.livekit;

import com.nimbusds.jose.crypto.MACVerifier;
import com.nimbusds.jwt.SignedJWT;
import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class LiveKitTokenServiceTest {

    // >= 32 chars so HS256 accepts the key
    private static final String API_KEY = "APItestkey";
    private static final String API_SECRET = "test-secret-0123456789-0123456789-abc";

    private final LiveKitTokenService svc =
            new LiveKitTokenService("wss://x.livekit.cloud", API_KEY, API_SECRET);

    @Test
    void roomNameIsDerivedFromSessionId() {
        UUID sid = UUID.fromString("11111111-1111-1111-1111-111111111111");
        assertEquals("interview-11111111-1111-1111-1111-111111111111", svc.roomName(sid));
    }

    @Test
    void mintedTokenIsSignedAndCarriesJoinGrant() throws Exception {
        UUID sid = UUID.fromString("11111111-1111-1111-1111-111111111111");
        UUID cid = UUID.fromString("22222222-2222-2222-2222-222222222222");

        String jwt = svc.mintCandidateToken(sid, cid);

        SignedJWT parsed = SignedJWT.parse(jwt);
        assertTrue(parsed.verify(new MACVerifier(API_SECRET.getBytes())),
                "token must be HS256-signed with the api secret");
        var claims = parsed.getJWTClaimsSet();
        assertEquals(API_KEY, claims.getIssuer());          // LiveKit: iss = api key
        assertEquals(cid.toString(), claims.getSubject());   // sub = participant identity
        assertNotNull(claims.getExpirationTime());

        // the "video" claim is LiveKit's VideoGrant, serialized as a nested object:
        // {"roomJoin": true, "room": "interview-<sessionId>"}
        Map<String, Object> videoGrant = claims.getJSONObjectClaim("video");
        assertNotNull(videoGrant, "video grant object must be present");
        assertEquals("interview-" + sid, videoGrant.get("room"), "grant must scope to the session's room");
        assertEquals(Boolean.TRUE, videoGrant.get("roomJoin"), "grant must allow joining the room");
    }

    @Test
    void livekitUrlIsExposed() {
        assertEquals("wss://x.livekit.cloud", svc.livekitUrl());
    }
}
