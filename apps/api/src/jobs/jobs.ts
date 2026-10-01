import type { LeetCodeCollectionJob } from "../integrations/leetcode/service.js";
import { errorMessage } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import type { GitHubConnectionRepository, InterviewSessionRepository, LeetCodeConnectionRepository } from "../repositories/pg.js";
import type { InterviewPrepService } from "../services/interviewPrep.js";
import type { ProfileService } from "../services/profileService.js";

/**
 * The prep trigger: a configurable lead time before each slot, pick up SCHEDULED sessions due
 * within that window and build their plan. Each session is CLAIMED with a compare-and-set
 * (SCHEDULED → PREP_QUEUED) first, so parallel API replicas never prepare the same session twice.
 */
export class InterviewPrepJob {
  constructor(
    private readonly sessions: InterviewSessionRepository,
    private readonly prep: InterviewPrepService,
    private readonly leadTimeMinutes: number,
    private readonly log: Logger,
  ) {}

  async prepareDueSessions(): Promise<void> {
    const cutoff = new Date(Date.now() + this.leadTimeMinutes * 60_000);
    const due = await this.sessions.findByStatusAndScheduledAtLessThanEqual("SCHEDULED", cutoff);
    if (due.length === 0) return;
    this.log.info(`Interview prep: ${due.length} session(s) due within ${this.leadTimeMinutes}-min lead time`);
    for (const session of due) {
      try {
        const claimed = await this.sessions.transitionStatus(session.id, "SCHEDULED", "PREP_QUEUED", { prepError: null });
        if (!claimed) continue; // another replica (or a manual regenerate) got it first
        await this.prep.generatePrep(session.id);
      } catch (err) {
        // generatePrep records PREP_FAILED itself; keep going for the rest.
        this.log.warn(`Interview prep failed for session ${session.id}: ${errorMessage(err)}`);
      }
    }
    this.log.info("Interview prep poll complete");
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
