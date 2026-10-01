import { AccessToken } from "livekit-server-sdk";

const TOKEN_TTL_SECONDS = 60 * 60; // 1h

/**
 * Mints LiveKit join tokens. The API does NOT create rooms or dispatch agents: LiveKit
 * auto-creates the room on first join and the Python worker uses automatic dispatch, parsing the
 * sessionId from the room name "interview-{sessionId}".
 */
export class LiveKitTokenService {
  constructor(
    private readonly url: string,
    private readonly apiKey: string,
    private readonly apiSecret: string,
  ) {}

  roomName(sessionId: string): string {
    return `interview-${sessionId}`;
  }

  livekitUrl(): string {
    return this.url;
  }

  mintCandidateToken(sessionId: string, candidateId: string): Promise<string> {
    const token = new AccessToken(this.apiKey, this.apiSecret, {
      identity: candidateId,
      name: candidateId,
      ttl: TOKEN_TTL_SECONDS,
    });
    token.addGrant({ roomJoin: true, room: this.roomName(sessionId) });
    return token.toJwt();
  }
}
