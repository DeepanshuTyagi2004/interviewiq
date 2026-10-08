import { CODING_PLATFORMS, type CodingPlatform } from "../../domain/enums.js";
import type { PlatformConnectionRow } from "../../db/pg/schema.js";
import type { BackgroundTasks } from "../../lib/background.js";
import { InvalidArgumentError } from "../../lib/errors.js";
import type { Logger } from "../../lib/logger.js";
import type { ProfileFragmentRepository } from "../../repositories/mongo.js";
import type { LeetCodeConnectionRepository, PlatformConnectionRepository } from "../../repositories/pg.js";
import { normalizePlatformHandle, PlatformProfileError, storeFragment, type LinkedProfile, type PlatformCollector } from "./common.js";

export function parseCodingPlatform(raw: string | null | undefined): CodingPlatform | null {
  const value = (raw ?? "").trim().toUpperCase();
  return (CODING_PLATFORMS as readonly string[]).includes(value) ? value as CodingPlatform : null;
}

interface Deps {
  connections: PlatformConnectionRepository;
  fragments: ProfileFragmentRepository;
  collectors: PlatformCollector[];
  background: BackgroundTasks;
  log: Logger;
  /** Linked LeetCode handles are connected through the existing LeetCode flow. */
  leetcode?: { connections: LeetCodeConnectionRepository; connect(userId: string, username: string): Promise<unknown> };
  now?: () => Date;
}

/**
 * Handle-based coding-platform connections (Codeforces, CodeChef, AtCoder, TUF).
 * Connect validates the handle synchronously, then collects in the background (202 SYNCING; the UI
 * polls the profile). The weekly refresh job calls `refresh` for every connection.
 */
export class PlatformConnectionService {
  private readonly collectors: Map<CodingPlatform, PlatformCollector>;
  private readonly now: () => Date;

  constructor(private readonly d: Deps) {
    this.collectors = new Map(d.collectors.map((collector) => [collector.platform, collector]));
    this.now = d.now ?? (() => new Date());
  }

  supported(): CodingPlatform[] {
    return [...this.collectors.keys()].sort();
  }

  list(userId: string): Promise<PlatformConnectionRow[]> {
    return this.d.connections.findByUserId(userId);
  }

  async connect(userId: string, platform: CodingPlatform, rawHandle: string | null | undefined): Promise<PlatformConnectionRow> {
    const collector = this.collectors.get(platform);
    if (!collector) throw new InvalidArgumentError(`${platform} is not supported`);
    const handle = normalizePlatformHandle(platform, rawHandle);
    if (!handle) throw new PlatformProfileError("INVALID_HANDLE", `Not a valid ${platform.toLowerCase()} handle or profile URL`);
    await collector.validate(handle);
    const connection = await this.d.connections.upsertSyncing(userId, platform, handle);
    this.d.background.run(`platform-collect:${connection.id}`, () => this.runForConnectionId(connection.id));
    return connection;
  }

  /** Delete the connection and its fragment. Idempotent. */
  async disconnect(userId: string, platform: CodingPlatform): Promise<void> {
    await this.d.connections.deleteByUserAndPlatform(userId, platform);
    await this.d.fragments.deleteByUserIdAndSource(userId, platform);
  }

  async runForConnectionId(connectionId: string): Promise<void> {
    const connection = await this.d.connections.findById(connectionId);
    if (!connection) return;
    await this.refresh(connection);
  }

  /**
   * Collect, store with hash-skip and record the outcome. Never throws: an unknown handle is
   * DEGRADED (last good fragment kept), any other failure FAILED (fragment untouched).
   */
  async refresh(connection: PlatformConnectionRow): Promise<void> {
    const collector = this.collectors.get(connection.platform);
    if (!collector) {
      // A platform that is no longer supported: remove the connection and its data.
      await this.disconnect(connection.userId, connection.platform);
      this.d.log.info(`removed ${connection.platform} connection: the platform is no longer supported`);
      return;
    }
    let patch: Partial<Pick<PlatformConnectionRow, "status" | "lastRefreshedAt">>;
    let linked: LinkedProfile[] = [];
    try {
      const now = this.now();
      const snapshot = await collector.collect(connection.handle, now);
      await storeFragment(this.d.fragments, connection.userId, connection.platform, snapshot.data, now);
      linked = snapshot.linkedProfiles;
      patch = { status: "SYNCED", lastRefreshedAt: now };
    } catch (err) {
      const notFound = err instanceof PlatformProfileError && err.reason === "NOT_FOUND";
      patch = { status: notFound ? "DEGRADED" : "FAILED" };
      this.d.log.warn(`${connection.platform} collection failed for '${connection.handle}': ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      await this.d.connections.update(connection.id, patch);
    } catch (err) {
      this.d.log.warn({ err }, `could not record ${connection.platform} sync status for '${connection.handle}'`);
    }
    if (linked.length) await this.discover(connection.userId, linked, connection.platform);
  }

  /**
   * Connect handles another profile links to, only where the user has no connection for that
   * platform yet: a connection the user made themselves is never replaced.
   */
  async discover(userId: string, linked: LinkedProfile[], from: CodingPlatform): Promise<void> {
    for (const profile of linked) {
      try {
        if (profile.platform === "LEETCODE") {
          if (this.d.leetcode && !(await this.d.leetcode.connections.findByUserId(userId))) await this.d.leetcode.connect(userId, profile.handle);
          continue;
        }
        if (profile.platform === from || !this.collectors.has(profile.platform)) continue;
        const created = await this.d.connections.insertIfAbsent(userId, profile.platform, profile.handle, from);
        if (created) this.d.background.run(`platform-collect:${created.id}`, () => this.runForConnectionId(created.id));
      } catch (err) {
        this.d.log.warn(`linked ${profile.platform} profile from ${from} not connected: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}
