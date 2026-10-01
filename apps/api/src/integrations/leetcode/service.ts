import type { LeetCodeConnectionRow } from "../../db/pg/schema.js";
import type { BackgroundTasks } from "../../lib/background.js";
import { InvalidArgumentError } from "../../lib/errors.js";
import type { Logger } from "../../lib/logger.js";
import type { ProfileFragmentRepository } from "../../repositories/mongo.js";
import type { LeetCodeConnectionRepository } from "../../repositories/pg.js";
import type { LeetCodeCollector } from "./collector.js";
import { LeetCodeProfileError } from "./errors.js";

// Pulls the handle out of inputs like "https://leetcode.com/u/aakash_42/" or "leetcode.com/aakash_42".
const URL_HANDLE = /^(?:https?:\/\/)?(?:www\.)?leetcode\.com\/(?:u\/)?([^/?#\s]+).*$/;

/**
 * Reduce raw input to a bare LeetCode handle: strip a pasted profile URL, a leading '@',
 * surrounding whitespace. Backend defense-in-depth — the UI also strips.
 */
export function normalizeLeetCodeUsername(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return "";
  let value = raw.trim();
  const m = URL_HANDLE.exec(value);
  if (m) value = m[1]!;
  if (value.startsWith("@")) value = value.slice(1);
  return value.trim();
}

/**
 * Runs LeetCode collection off the request path and records the outcome on the connection:
 * success → SYNCED + lastRefreshedAt; null user → DEGRADED (last-known-good fragment kept);
 * any error → FAILED (fragment untouched). Also called directly by the weekly refresh job.
 */
export class LeetCodeCollectionJob {
  constructor(
    private readonly connections: LeetCodeConnectionRepository,
    private readonly collector: LeetCodeCollector,
    private readonly log: Logger,
  ) {}

  async runForConnectionId(connectionId: string): Promise<void> {
    const connection = await this.connections.findById(connectionId);
    if (!connection) {
      this.log.warn(`LeetCode collection skipped: connection ${connectionId} no longer exists`);
      return;
    }
    await this.refresh(connection);
  }

  /** Never throws. */
  async refresh(connection: LeetCodeConnectionRow): Promise<void> {
    let patch: Partial<Pick<LeetCodeConnectionRow, "status" | "lastRefreshedAt">>;
    try {
      const result = await this.collector.collectAndStore(connection);
      if (result === "NULL_USER") {
        patch = { status: "DEGRADED" };
        this.log.warn(`LeetCode profile '${connection.username}' returned null (private/removed); keeping last-known-good data`);
      } else {
        patch = { status: "SYNCED", lastRefreshedAt: new Date() };
      }
    } catch (err) {
      patch = { status: "FAILED" };
      if (err instanceof LeetCodeProfileError) {
        this.log.warn(`LeetCode collection failed for '${connection.username}' (${err.code}): ${err.message}`);
      } else {
        this.log.warn({ err }, `LeetCode collection failed unexpectedly for '${connection.username}'`);
      }
    }
    try {
      await this.connections.update(connection.id, patch);
    } catch (err) {
      this.log.warn({ err }, `could not record LeetCode sync status for '${connection.username}'`);
    }
  }
}

/**
 * Connection lifecycle: validate the username synchronously (so a bad handle is rejected on the
 * connect call), persist the connection, and kick off background collection.
 */
export class LeetCodeService {
  constructor(
    private readonly connections: LeetCodeConnectionRepository,
    private readonly fragments: ProfileFragmentRepository,
    private readonly collector: LeetCodeCollector,
    private readonly job: LeetCodeCollectionJob,
    private readonly background: BackgroundTasks,
  ) {}

  /**
   * Returns immediately with the connection in SYNCING; the UI polls the profile for the terminal
   * state. Throws LeetCodeProfileError (not found / private / unreachable) or InvalidArgumentError.
   */
  async connect(userId: string, rawUsername: string | null | undefined): Promise<LeetCodeConnectionRow> {
    const username = normalizeLeetCodeUsername(rawUsername);
    if (username === "") throw new InvalidArgumentError("LeetCode username is required");

    // Synchronous existence/public check — fails fast so the UI can show a precise error.
    await this.collector.validateProfile(username);

    const connection = await this.connections.upsertSyncing(userId, username);
    this.background.run(`leetcode-collect:${connection.id}`, () => this.job.runForConnectionId(connection.id));
    return connection;
  }

  /** Delete the connection and the LeetCode fragment. Idempotent. */
  async disconnect(userId: string): Promise<void> {
    await this.connections.deleteByUserId(userId);
    await this.fragments.deleteByUserIdAndSource(userId, "LEETCODE");
  }
}
