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

/**
 * How long LiveKit keeps the room open while nobody has joined it. A room that holds only the interviewer counts as empty (an
 * agent does not keep it open; checked on the real project), and LiveKit's default is 5 minutes, so a candidate who reads the
 * instructions longer would find the interviewer gone. Longer than the worker's own 15-minute wait for a candidate.
 */
export const ROOM_EMPTY_TIMEOUT_SECONDS = 20 * 60;

/** Room-level operations the live session service needs from LiveKit. */
export interface AgentRooms {
  dispatchAgent(sessionId: string): Promise<void>;
  hasAgent(sessionId: string): Promise<boolean>;
  /** An interviewer dispatch for the room that has not finished: its job not started yet, or still pending or running. */
  hasDispatch(sessionId: string): Promise<boolean>;
}

interface DispatchRecord {
  agent_name?: string;
  agentName?: string;
  deleted_at?: string | number;
  deletedAt?: string | number;
  state?: { jobs?: { state?: { status?: string | number } }[] };
}
/** A job that is over (LiveKit's JobStatus: JS_SUCCESS, JS_FAILED), by name or by number. */
const FINISHED_JOB = new Set<string | number>(["JS_SUCCESS", "JS_FAILED", 2, 3]);

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

  private async call(service: string, method: string, room: string, body: Record<string, unknown>, extraGrant: { roomCreate?: boolean } = {}): Promise<unknown> {
    const token = new AccessToken(this.apiKey, this.apiSecret, { ttl: 600 });
    token.addGrant({ roomAdmin: true, roomList: true, room, ...extraGrant });
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
    await this.createRoom(room);
    await this.call("AgentDispatchService", "CreateDispatch", room, {
      room, agent_name: this.agentName, metadata: JSON.stringify({ session_id: sessionId }),
    });
  }

  /** Best effort: if LiveKit refuses, CreateDispatch below makes the room itself (with its 5-minute default). An existing room is left as it is. */
  private async createRoom(room: string): Promise<void> {
    try {
      await this.call("RoomService", "CreateRoom", room, { name: room, empty_timeout: ROOM_EMPTY_TIMEOUT_SECONDS }, { roomCreate: true });
    } catch {
      // not fatal
    }
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

  async hasDispatch(sessionId: string): Promise<boolean> {
    const room = `interview-${sessionId}`;
    try {
      const res = (await this.call("AgentDispatchService", "ListDispatch", room, { room })) as {
        agent_dispatches?: DispatchRecord[];
        agentDispatches?: DispatchRecord[];
      };
      return (res.agent_dispatches ?? res.agentDispatches ?? []).some((d) => {
        if ((d.agent_name ?? d.agentName) !== this.agentName) return false;
        if (Number(d.deleted_at ?? d.deletedAt ?? 0) > 0) return false;
        const jobs = d.state?.jobs ?? [];
        return jobs.length === 0 || jobs.some((j) => !FINISHED_JOB.has(j.state?.status ?? "JS_PENDING"));
      });
    } catch (err) {
      // No room yet means no dispatch yet.
      if (isUpstreamStatus(err, 404)) return false;
      throw err;
    }
  }
}
