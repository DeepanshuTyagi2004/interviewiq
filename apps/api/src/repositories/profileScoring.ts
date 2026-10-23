import type { MongoCollections } from "../db/mongo/client.js";
import type { ProfileScoreSnapshot, ProfileScoringSettings, ScoringConfig, ScoringInput, SemanticItemAssessment } from "../domain/profileScoring/types.js";
import type { CompanyKnowledgeBaseEntry } from "../domain/profileScoring/company.js";
import { normalizeLegacyLevel } from "../domain/engineeringLevels.js";

export interface ProfileScoringSettingsDoc extends ProfileScoringSettings { _id: string; updatedAt: Date }
export interface ProfileScoreDoc {
  _id: string;
  userId: string;
  fingerprint: string;
  input: ScoringInput;
  config: ScoringConfig;
  snapshot: ProfileScoreSnapshot;
  rankFinalizedAt?: Date;
}
export interface ProfileScoringJobDoc {
  _id: string;
  kind: "weekly" | "manual";
  userId?: string;
  week: string;
  configHash: string;
  status: "running" | "completed" | "failed";
  startedAt: Date;
  completedAt: Date | null;
  processed: number;
  failed: number;
  error: string | null;
  leaseOwner: string;
  /** Frozen cohort plan; retries finish the same generation rather than mixing live cohort sizes. */
  rankPlan?: { id: string; rank: number; percentile: number | null; cohortSize: number }[];
}
export interface ProfileScoringLeaseDoc { _id: string; owner: string | null; expiresAt: Date }
/** One stored per-item semantic assessment. Scoring-owned: never a profile fragment or summary input. */
export interface SemanticAssessmentDoc extends SemanticItemAssessment { _id: string; userId: string; contextHash: string; updatedAt: Date }
/** Global company knowledge base (no user data). Keyed by normalized company name. */
export interface CompanyKnowledgeDoc extends CompanyKnowledgeBaseEntry { _id: string; source: "catalogue" | "llm" | "web"; updatedAt: Date }

/**
 * Per-user ledger of the AI assessment runs a person started (automatic or by Recalculate). The rolling-week
 * limit and the "being assessed" marker live here, in Mongo, so they hold across restarts and API replicas.
 */
export interface AssessmentRunsDoc {
  _id: string; // userId
  /** Start times of runs inside (or just outside) the rolling window; pruned on every reservation. */
  runs: Date[];
  /** Set while a run is in flight; expires on its own if the replica running it dies. */
  assessingUntil: Date | null;
  /** True once an assessment has actually been stored for this user (the "first assessment" is done). */
  everAssessed: boolean;
  /** Last automatic attempt, so a failing first run is not retried on every page view. */
  autoTriedAt: Date | null;
  /** After a run in which every model call failed: no new run until then, so an outage is not hammered. */
  cooldownUntil?: Date | null;
}
export interface AssessmentUsage { used: number; oldest: Date | null; assessingUntil: Date | null; everAssessed: boolean; autoTriedAt: Date | null; cooldownUntil: Date | null }

export const DEFAULT_SCORING_SETTINGS: ProfileScoringSettings = { declaredLevel: null, leaderboardOptIn: false };

/** Only this repository touches scoring collections; diagnostics use reads, never a ping/write probe. */
export class ProfileScoringRepository {
  constructor(private readonly c: MongoCollections) {}

  async settings(userId: string): Promise<ProfileScoringSettings> {
    const doc = await this.c.profileScoringSettings.findOne({ _id: userId });
    return doc ? { declaredLevel: normalizeLegacyLevel(doc.declaredLevel), leaderboardOptIn: doc.leaderboardOptIn } : { ...DEFAULT_SCORING_SETTINGS };
  }

  async settingsRevision(userId: string): Promise<string | null> {
    return (await this.c.profileScoringSettings.findOne({ _id: userId }))?.updatedAt.toISOString() ?? null;
  }

  async patchSettings(userId: string, patch: Partial<ProfileScoringSettings>, now: Date): Promise<void> {
    const defaults = Object.fromEntries(Object.entries(DEFAULT_SCORING_SETTINGS).filter(([key]) => !(key in patch)));
    await this.c.profileScoringSettings.updateOne({ _id: userId }, { $set: { ...patch, updatedAt: now }, $setOnInsert: defaults }, { upsert: true });
  }

  async save(doc: ProfileScoreDoc): Promise<ProfileScoreDoc> {
    // _id is the deterministic user/week/config/input key. Concurrent replicas converge without replacing frozen inputs.
    try { await this.c.profileScoreSnapshots.updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true }); }
    catch (err) { if ((err as { code?: number }).code !== 11000) throw err; }
    return (await this.c.profileScoreSnapshots.findOne({ _id: doc._id }))!;
  }

  history(userId: string, limit = 52): Promise<ProfileScoreDoc[]> {
    return this.c.profileScoreSnapshots.find({ userId }).sort({ "snapshot.calculatedAt": -1, _id: -1 }).limit(limit).toArray();
  }

  findSnapshot(id: string): Promise<ProfileScoreDoc | null> { return this.c.profileScoreSnapshots.findOne({ _id: id }); }

  findCurrentFingerprint(userId: string, week: string, fingerprint: string, configHash: string): Promise<ProfileScoreDoc | null> {
    return this.c.profileScoreSnapshots.findOne({ userId, fingerprint, "snapshot.week": week, "snapshot.configHash": configHash });
  }

  async latestForWeek(week: string): Promise<ProfileScoreDoc[]> {
    // Select latest BEFORE filtering cohort/level: an older level must never resurrect.
    return this.c.profileScoreSnapshots.aggregate<ProfileScoreDoc>([
      { $match: { "snapshot.week": week } },
      { $sort: { "snapshot.calculatedAt": -1, _id: -1 } },
      { $group: { _id: "$userId", doc: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$doc" } },
    ]).toArray();
  }

  async finalizeRank(id: string, rank: number, percentile: number | null, cohortSize: number, now: Date): Promise<void> {
    await this.c.profileScoreSnapshots.updateOne({ _id: id, rankFinalizedAt: { $exists: false } }, {
      $set: { "snapshot.rank": rank, "snapshot.percentile": percentile, "snapshot.cohortSize": cohortSize, rankFinalizedAt: now },
    });
  }

  async acquireLease(owner: string, now: Date): Promise<boolean> {
    try { await this.c.profileScoringLeases.updateOne({ _id: "global" }, { $setOnInsert: { owner: null, expiresAt: new Date(0) } }, { upsert: true }); }
    catch (err) { if ((err as { code?: number }).code !== 11000) throw err; }
    const result = await this.c.profileScoringLeases.updateOne({ _id: "global", expiresAt: { $lte: now } }, { $set: { owner, expiresAt: new Date(now.getTime() + 300_000) } });
    return result.modifiedCount === 1;
  }

  async renewLease(owner: string, now: Date): Promise<boolean> {
    const r = await this.c.profileScoringLeases.updateOne({ _id: "global", owner, expiresAt: { $gt: now } }, { $set: { expiresAt: new Date(now.getTime() + 300_000) } });
    return r.matchedCount === 1;
  }

  async releaseLease(owner: string): Promise<void> {
    await this.c.profileScoringLeases.updateOne({ _id: "global", owner }, { $set: { owner: null, expiresAt: new Date(0) } });
  }

  job(id: string): Promise<ProfileScoringJobDoc | null> { return this.c.profileScoringJobs.findOne({ _id: id }); }
  async saveJob(doc: ProfileScoringJobDoc, start = false): Promise<void> {
    if (start) { await this.c.profileScoringJobs.replaceOne({ _id: doc._id }, doc, { upsert: true }); return; }
    // Fence abandoned replicas: an expired owner may never overwrite its replacement's receipt/plan.
    const r = await this.c.profileScoringJobs.replaceOne({ _id: doc._id, leaseOwner: doc.leaseOwner }, doc);
    if (!r.matchedCount) throw new Error("Scoring receipt ownership lost");
  }
  latestJob(): Promise<ProfileScoringJobDoc | null> { return this.c.profileScoringJobs.find().sort({ startedAt: -1 }).limit(1).next(); }
  lease(): Promise<ProfileScoringLeaseDoc | null> { return this.c.profileScoringLeases.findOne({ _id: "global" }); }

  semanticAssessments(userId: string): Promise<SemanticAssessmentDoc[]> {
    return this.c.profileScoringSemantic.find({ userId }).sort({ _id: 1 }).limit(200).toArray();
  }

  async saveSemanticAssessment(doc: SemanticAssessmentDoc): Promise<void> {
    await this.c.profileScoringSemantic.replaceOne({ _id: doc._id, userId: doc.userId }, doc, { upsert: true });
  }

  /** Drop assessments for items that no longer exist in the profile (edited or removed). */
  async pruneSemanticAssessments(userId: string, keepIds: string[]): Promise<void> {
    await this.c.profileScoringSemantic.deleteMany({ userId, _id: { $nin: keepIds } });
  }

  company(key: string): Promise<CompanyKnowledgeDoc | null> { return this.c.profileScoringCompanies.findOne({ _id: key }); }

  async saveCompany(doc: CompanyKnowledgeDoc): Promise<void> {
    await this.c.profileScoringCompanies.replaceOne({ _id: doc._id }, doc, { upsert: true });
  }

  async checkAccess(): Promise<void> {
    await Promise.all([this.c.profileScoringSettings.findOne({}), this.c.profileScoreSnapshots.findOne({}), this.c.profileScoringJobs.findOne({}), this.lease()]);
  }

  async export(userId: string) {
    const [settings, snapshots] = await Promise.all([
      this.settings(userId), this.c.profileScoreSnapshots.find({ userId }).sort({ "snapshot.calculatedAt": -1 }).toArray(),
    ]);
    const ownIds = snapshots.map((s) => s._id);
    const jobs = await this.c.profileScoringJobs.find({ $or: [{ userId }, { "rankPlan.id": { $in: ownIds } }] }).toArray();
    const semantic = (await this.semanticAssessments(userId)).map(({ _id, userId: _userId, ...assessment }) => assessment);
    return { settings, semanticAssessments: semantic, snapshots: snapshots.map(({ input, config, snapshot }) => ({ input, config, snapshot })), jobs: jobs.map(({ _id, userId: _userId, leaseOwner: _leaseOwner, rankPlan, ...receipt }) => ({ id: _id, ...receipt, ...(rankPlan ? { rankPlan: rankPlan.filter((r) => ownIds.includes(r.id)) } : {}) })) };
  }

  async deleteByUserId(userId: string): Promise<void> {
    const snapshots = await this.c.profileScoreSnapshots.find({ userId }, { projection: { _id: 1 } }).toArray();
    if (snapshots.length) {
      await this.c.profileScoringJobs.updateMany({ "rankPlan.id": { $in: snapshots.map((s) => s._id) } }, { $pull: { rankPlan: { id: { $in: snapshots.map((s) => s._id) } } } });
    }
    await Promise.all([this.c.profileScoringAssessmentRuns.deleteOne({ _id: userId }), this.c.profileScoringSettings.deleteOne({ _id: userId }), this.c.profileScoreSnapshots.deleteMany({ userId }), this.c.profileScoringJobs.deleteMany({ userId }),
      this.c.profileScoringSemantic.deleteMany({ userId })]);
  }
}

export class ProfileAssessmentRunRepository {
  constructor(private readonly c: MongoCollections) {}

  async usage(userId: string, now: Date, windowMs: number): Promise<AssessmentUsage> {
    const doc = await this.c.profileScoringAssessmentRuns.findOne({ _id: userId });
    const cutoff = now.getTime() - windowMs;
    const runs = (doc?.runs ?? []).filter((at) => at.getTime() > cutoff).sort((a, b) => a.getTime() - b.getTime());
    return { used: runs.length, oldest: runs[0] ?? null, assessingUntil: doc?.assessingUntil ?? null, everAssessed: doc?.everAssessed ?? false, autoTriedAt: doc?.autoTriedAt ?? null, cooldownUntil: doc?.cooldownUntil ?? null };
  }

  /**
   * Take one slot in the rolling window, atomically: the upsert only matches while fewer than `limit` runs are
   * recorded, so two replicas can never both take the last slot (the loser hits the duplicate _id).
   */
  async reserve(userId: string, now: Date, limit: number, windowMs: number, auto: boolean): Promise<boolean> {
    await this.c.profileScoringAssessmentRuns.updateOne({ _id: userId }, { $pull: { runs: { $lte: new Date(now.getTime() - windowMs) } } } as never);
    try {
      const r = await this.c.profileScoringAssessmentRuns.updateOne(
        { _id: userId, [`runs.${limit - 1}`]: { $exists: false } },
        { $push: { runs: now }, ...(auto ? { $set: { autoTriedAt: now } } : {}), $setOnInsert: { assessingUntil: null, everAssessed: false, ...(auto ? {} : { autoTriedAt: null }) } } as never,
        { upsert: true });
      return r.matchedCount + r.upsertedCount > 0;
    } catch (err) {
      if ((err as { code?: number }).code === 11000) return false;
      throw err;
    }
  }

  async release(userId: string, at: Date): Promise<void> {
    await this.c.profileScoringAssessmentRuns.updateOne({ _id: userId }, { $pull: { runs: at } });
  }

  /** Mark a run in flight. False when another is already running (its marker has not expired). */
  async begin(userId: string, now: Date, ttlMs: number): Promise<boolean> {
    const r = await this.c.profileScoringAssessmentRuns.updateOne(
      { _id: userId, $or: [{ assessingUntil: null }, { assessingUntil: { $lte: now } }] },
      { $set: { assessingUntil: new Date(now.getTime() + ttlMs) } });
    return r.modifiedCount === 1;
  }

  /** Push the in-flight marker out while a long run is still working, so it never reads as finished early. */
  async extend(userId: string, until: Date): Promise<void> {
    await this.c.profileScoringAssessmentRuns.updateOne({ _id: userId }, { $set: { assessingUntil: until } });
  }

  async end(userId: string, assessed: boolean, cooldownUntil: Date | null = null): Promise<void> {
    await this.c.profileScoringAssessmentRuns.updateOne({ _id: userId }, { $set: { assessingUntil: null, cooldownUntil, ...(assessed ? { everAssessed: true } : {}) } });
  }

  /** Record once that this user already has assessments (e.g. from the weekly batch), so views skip the check. */
  async markAssessed(userId: string): Promise<void> {
    await this.c.profileScoringAssessmentRuns.updateOne({ _id: userId }, { $set: { everAssessed: true }, $setOnInsert: { runs: [], assessingUntil: null, autoTriedAt: null } }, { upsert: true });
  }
}
