import { AccessToken } from "livekit-server-sdk";
import { isUpstreamStatus, requestJson, type FetchLike } from "../lib/http.js";

const TOKEN_TTL_SECONDS = 60 * 60; // 1h

/**
 * Mints LiveKit join tokens. Rooms are auto-created on first join; the interviewer agent is
 * dispatched explicitly by LiveKitRoomAdmin (below), never automatically.
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

export const INTERVIEWER_AGENT = "interviewer";

/** Room-level operations the live session service needs from LiveKit. */
export interface AgentRooms {
  dispatchAgent(sessionId: string): Promise<void>;
  hasAgent(sessionId: string): Promise<boolean>;
}

/**
 * LiveKit's server API (Twirp over HTTPS) through the injectable fetch: explicit dispatch of the
 * interviewer agent into `interview-{sessionId}` (spec §8.1), and whether an agent is in the room.
 * Dispatch needs `roomAdmin`; listing participants needs `roomList` (LiveKit's documented grants).
 */
export class LiveKitRoomAdmin implements AgentRooms {
  constructor(
    private readonly url: string,
    private readonly apiKey: string,
    private readonly apiSecret: string,
    private readonly fetchImpl: FetchLike,
    private readonly agentName = INTERVIEWER_AGENT,
  ) {}

  private base(): string {
    return this.url.replace(/^ws(s?):\/\//, "http$1://").replace(/\/+$/, "");
  }

  private async call(service: string, method: string, room: string, body: Record<string, unknown>): Promise<unknown> {
    const token = new AccessToken(this.apiKey, this.apiSecret, { ttl: 600 });
    token.addGrant({ roomAdmin: true, roomList: true, room });
    return requestJson(this.fetchImpl, {
      method: "POST",
      url: `${this.base()}/twirp/livekit.${service}/${method}`,
      headers: { Authorization: `Bearer ${await token.toJwt()}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      timeoutMs: 10_000,
    });
  }

  async dispatchAgent(sessionId: string): Promise<void> {
    const room = `interview-${sessionId}`;
    await this.call("AgentDispatchService", "CreateDispatch", room, {
      room, agent_name: this.agentName, metadata: JSON.stringify({ session_id: sessionId }),
    });
  }

  async hasAgent(sessionId: string): Promise<boolean> {
    const room = `interview-${sessionId}`;
    try {
      const res = (await this.call("RoomService", "ListParticipants", room, { room })) as { participants?: { kind?: string | number }[] };
      return (res.participants ?? []).some((p) => p.kind === "AGENT" || p.kind === 4);
    } catch (err) {
      // A room is created when its first participant joins: before that LiveKit answers 404, which is "no agent yet".
      if (isUpstreamStatus(err, 404)) return false;
      throw err;
    }
  }
}
