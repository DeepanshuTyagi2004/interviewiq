import type { LeetCodeCollectionJob } from "../integrations/leetcode/service.js";
import { errorMessage } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import type { PlatformConnectionService } from "../integrations/platforms/service.js";
import type { GitHubConnectionRepository, InterviewSessionRepository, LeetCodeConnectionRepository, PlatformConnectionRepository } from "../repositories/pg.js";
import type { BlueprintPrepService } from "../services/blueprintPrep.js";
import type { ProfileService } from "../services/profileService.js";

/**
 * Blueprint prep reconcile (spec §5.4), every minute. Self-healing, no callbacks:
 *  1. start: SCHEDULED/PREP_QUEUED sessions with no run (booking's own start may have failed);
 *  2. collect: sessions with a run, applying finished ones and timing out stuck ones;
 *  3. refresh (every Nth tick): ready sessions more than the cutoff ahead whose inputs changed.
 * Starts are claimed per session (`attachRun` only attaches when no run is set), so replicas are safe.
 */
export class BlueprintReconcileJob {
  private ticks = 0;

  constructor(
    private readonly sessions: InterviewSessionRepository,
    private readonly prep: BlueprintPrepService,
    private readonly opts: { refreshEveryTicks: number; refreshCutoffMinutes: number },
    private readonly log: Logger,
  ) {}

  async tick(): Promise<void> {
    this.ticks++;
    const now = Date.now();
    const work = await this.sessions.findPrepWork(new Date(now - 60 * 60_000));
    for (const session of work) {
      try {
        if (session.prepRunId) {
          await this.prep.collect(session);
        } else if (session.status === "SCHEDULED") {
          const queued = await this.sessions.transitionStatus(session.id, "SCHEDULED", "PREP_QUEUED", { prepErrorCode: null });
          if (queued) await this.prep.start(queued, "reconcile");
        } else if (session.status === "PREP_QUEUED") {
          await this.prep.start(session, "reconcile");
        }
      } catch (err) {
        this.log.warn(`Blueprint reconcile failed for session ${session.id}: ${errorMessage(err)}`);
      }
    }
    if (this.ticks % this.opts.refreshEveryTicks !== 0) return;
    const ready = await this.sessions.findRefreshCandidates(new Date(now + this.opts.refreshCutoffMinutes * 60_000));
    let refreshed = 0;
    for (const session of ready) {
      try {
        if (await this.prep.refreshIfChanged(session)) refreshed++;
      } catch (err) {
        this.log.warn(`Blueprint refresh check failed for session ${session.id}: ${errorMessage(err)}`);
      }
    }
    if (refreshed) this.log.info(`Blueprint refresh: ${refreshed} of ${ready.length} ready session(s) re-preparing`);
  }
}

export const SWEEP_GRACE_MINUTES = 30;
export const CEILING_FACTOR = 1.5;

/**
 * Backstop for a worker that died without ending its session (spec §8.4): a session still live past
 * 1.5x its duration plus 30 minutes is aborted as technical. A running round is never touched.
 */
export class LiveSessionSweepJob {
  constructor(
    private readonly sessions: InterviewSessionRepository,
    private readonly log: Logger,
    private readonly clock: () => number = Date.now,
  ) {}

  async tick(): Promise<number> {
    const now = this.clock();
    let swept = 0;
    for (const s of await this.sessions.findLiveStartedBefore(new Date(now - SWEEP_GRACE_MINUTES * 60_000))) {
      const minutes = s.prepBriefing?.duration_mins ?? 60;
      const deadline = (s.liveStartedAt?.getTime() ?? now) + (CEILING_FACTOR * minutes + SWEEP_GRACE_MINUTES) * 60_000;
      if (now < deadline) continue;
      const row = await this.sessions.transitionStatus(s.id, "LIVE_IN_PROGRESS", "ABORTED_TECHNICAL", {
        liveEndedAt: new Date(now),
        endedReason: "technical",
      });
      if (row) swept++;
    }
    if (swept) this.log.info(`Live sweep: aborted ${swept} stuck live session(s)`);
    return swept;
  }
}

/** Weekly background refresh of every GitHub connection. */
export class GitHubRefreshJob {
  constructor(
    private readonly connections: GitHubConnectionRepository,
    private readonly profiles: ProfileService,
    private readonly log: Logger,
  ) {}

  async refreshAll(): Promise<void> {
    const all = await this.connections.findAll();
    this.log.info(`Weekly GitHub refresh starting for ${all.length} connection(s)`);
    for (const connection of all) {
      try {
        await this.profiles.refreshGitHub(connection);
      } catch (err) {
        // never log the token; only the (non-sensitive) login + message
        this.log.warn(`GitHub refresh failed for login=${connection.githubLogin}: ${errorMessage(err)}`);
      }
    }
    this.log.info("Weekly GitHub refresh complete");
  }
}

/** Weekly background refresh of every LeetCode connection. */
export class LeetCodeRefreshJob {
  constructor(
    private readonly connections: LeetCodeConnectionRepository,
    private readonly job: LeetCodeCollectionJob,
    private readonly log: Logger,
  ) {}

  async refreshAll(): Promise<void> {
    const all = await this.connections.findAll();
    this.log.info(`Weekly LeetCode refresh starting for ${all.length} connection(s)`);
    for (const connection of all) {
      await this.job.refresh(connection); // records its own status and never throws
    }
    this.log.info("Weekly LeetCode refresh complete");
  }
}

/** Weekly background refresh of every coding-platform connection (Codeforces, CodeChef, AtCoder, TUF). */
export class PlatformRefreshJob {
  constructor(
    private readonly connections: PlatformConnectionRepository,
    private readonly platforms: PlatformConnectionService,
    private readonly log: Logger,
  ) {}

  async refreshAll(): Promise<void> {
    const all = await this.connections.findAll();
    this.log.info(`Weekly coding-platform refresh starting for ${all.length} connection(s)`);
    for (const connection of all) {
      await this.platforms.refresh(connection); // records its own status and never throws
    }
    this.log.info("Weekly coding-platform refresh complete");
  }
}
