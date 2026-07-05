package com.interviewiq.interviewiq_backend.integrations.livekit;

import io.livekit.server.AccessToken;
import io.livekit.server.RoomJoin;
import io.livekit.server.RoomName;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.UUID;

/** Mints LiveKit join tokens. The backend does NOT create rooms or dispatch agents:
 *  LiveKit auto-creates the room on first join and the Python worker uses automatic
 *  dispatch (parsing the sessionId from the room name "interview-{sessionId}"). */
@Service
public class LiveKitTokenService {

    private static final long TOKEN_TTL_MS = 60 * 60 * 1000L; // 1h

    private final String url;
    private final String apiKey;
    private final String apiSecret;

    public LiveKitTokenService(
            @Value("${livekit.url}") String url,
            @Value("${livekit.api-key}") String apiKey,
            @Value("${livekit.api-secret}") String apiSecret) {
        this.url = url;
        this.apiKey = apiKey;
        this.apiSecret = apiSecret;
    }

    public String roomName(UUID sessionId) {
        return "interview-" + sessionId;
    }

    public String livekitUrl() {
        return url;
    }

    public String mintCandidateToken(UUID sessionId, UUID candidateId) {
        AccessToken token = new AccessToken(apiKey, apiSecret);
        token.setIdentity(candidateId.toString());
        token.setName(candidateId.toString());
        token.setTtl(TOKEN_TTL_MS);
        token.addGrants(new RoomJoin(true), new RoomName(roomName(sessionId)));
        return token.toJwt();
    }
}
