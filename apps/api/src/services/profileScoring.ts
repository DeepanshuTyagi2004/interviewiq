import { createHmac, randomUUID } from "node:crypto";
import { buildScoringInput, effectiveDeclaredLevel, validTimestamp } from "../domain/profileScoring/adapters.js";
import { isEngineeringLevel } from "../domain/engineeringLevels.js";
import { DEFAULT_SCORING_CONFIG, SCORING_ENGINE_REVISION, supportsLinkedIn, validateScoringConfig } from "../domain/profileScoring/config.js";
import { evaluateProfile } from "../domain/profileScoring/engine.js";
import type { DiagnosticCheck, EngineDebugEvent, ProfileAssessmentStatus, EngineeringLevel, LiveTraceEvent, ProfileTraceLlmCall, SemanticItemAssessment, SemanticItemType, ProfileDiagnosticsResponse, ProfileLeaderboardResponse, ProfileLiveTraceResponse, ProfileScoreResponse, ProfileScoreSnapshot, ProfileScoringJobStatus, ProfileScoringSettings, ProfileTraceComponent, ProfileTraceProviderCheck, ProfileTraceSource, ProfileTraceStage, ScoreEvaluation, ScoreEvidence, ScoringConfig, ScoringInput } from "../domain/profileScoring/types.js";
import { canonicalize, sha256Hex } from "../lib/canonicalJson.js";
import { cleanText, list, object } from "../domain/profileScoring/sanitization.js";
import { ApiError } from "../lib/errors.js";
import type { CandidateProfileRepository, ProfileFragmentRepository } from "../repositories/mongo.js";
import type { GitHubConnectionRepository, LeetCodeConnectionRepository, UserRepository } from "../repositories/pg.js";
import { ProfileScoringRepository, type ProfileScoreDoc, type ProfileScoringJobDoc } from "../repositories/profileScoring.js";
import type { PreferencesService } from "./preferencesService.js";
import type { AiServiceClient } from "../integrations/aiService/client.js";
import { scoringIdentities, sanitizeProfile } from "../domain/profileScoring/adapters.js";
import { assessmentContextHash, buildItemAssessmentRequest, profileItems, toSemanticAssessment } from "../domain/profileScoring/semantic.js";
import { readmeTemplate } from "../domain/profileScoring/readmeTemplates.js";
import { companyContextFromEntry, companyKey, type CompanyKnowledgeBaseEntry } from "../domain/profileScoring/company.js";
import { experienceMonths } from "../domain/profileScoring/experience.js";
import { hashJson } from "../domain/profileScoring/sanitization.js";
import type { CompanyRow, PlatformConnectionRow } from "../db/pg/schema.js";
import { CODING_PLATFORMS } from "../domain/enums.js";
import type { CandidateProfileDoc } from "../db/mongo/client.js";
import type { BackgroundTasks } from "../lib/background.js";
import type { ProfileAssessmentRunRepository } from "../repositories/profileScoring.js";
import type { CompanyKnowledgeDoc, SemanticAssessmentDoc } from "../repositories/profileScoring.js";

export function scoringWeek(now: Date): string {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day.toISOString().slice(0, 10);
}
/** AI assessment runs a user may start per rolling week (automatic first run included); decided 2026-10-23. */
export const RECALCULATION_LIMIT = 3;
const RECALCULATION_WINDOW_MS = 7 * 24 * 3_600_000;
/** An in-flight marker older than this belongs to a replica that died; the run may be started again. */
const ASSESSMENT_RUN_TTL_MS = 10 * 60_000;
const AUTO_RETRY_MS = 6 * 3_600_000;
const FAILED_RUN_COOLDOWN_MS = 10 * 60_000;
const nextWeek = (now: Date) => new Date(new Date(`${scoringWeek(now)}T00:00:00.000Z`).getTime() + 604_800_000).toISOString();
const digest = (v: unknown) => sha256Hex(canonicalize(v));

interface Deps {
  repo: ProfileScoringRepository;
  users: UserRepository;
  profiles: CandidateProfileRepository;
  fragments: ProfileFragmentRepository;
  github: GitHubConnectionRepository;
  leetcode: LeetCodeConnectionRepository;
  /** Coding-platform connections; when absent, platform fragments are taken as connected. */
  platforms?: { findByUserId(userId: string): Promise<PlatformConnectionRow[]> };
  preferences: PreferencesService;
  pseudonymKey: string;
  schedulerEnabled: boolean;
  /** Optional: without it, semantic item assessment is unavailable and scoring stays deterministic-only. */
  aiService?: Pick<AiServiceClient, "assessProfileScoring" | "companyContext">;
  /** Researched company catalogue: preferred over model knowledge for company context. */
  companies?: { findAll(): Promise<CompanyRow[]> };
  /** Upper bound on LLM calls in one scoring batch (cost discipline). */
  semanticCallsPerBatch?: number;
  /** Per-user run ledger (rolling-week limit, in-flight marker). Without it Recalculate stays deterministic-only. */
  runs?: Pick<ProfileAssessmentRunRepository, "usage" | "reserve" | "release" | "begin" | "end" | "extend" | "markAssessed">;
  /** Where assessments run so a request never waits on the model; without it they run inline. */
  background?: Pick<BackgroundTasks, "run">;
  /** First assessment for a user who has never had one (after onboarding, or the first score view). */
  autoAssess?: boolean;
  config?: ScoringConfig;
  now?: () => Date;
}

export interface SemanticRefreshResult { assessed: number; reused: number; skipped: number; failed: number; budgetExhausted: boolean }
/** How a company's engineering context was resolved (admin live trace). */
export interface CompanyResolution { path: "cached" | "catalogue" | "model" | "web" | "unknown" | "failed"; value: number | null; reason?: string; facts?: Record<string, unknown>; evidenceUrls?: string[]; error?: unknown }
/** Progress of the semantic producer, reported to the admin live trace. Never changes what is stored. */
export type SemanticObserverEvent =
  | { type: "start"; level: EngineeringLevel; items: number; context: Record<string, unknown>; promptVersion: string; force: boolean }
  | { type: "item"; status: "skipped" | "reused" | "budget"; itemType: SemanticItemType; title: string; reason: string; features?: { key: string; value: number }[]; companyContext?: unknown }
  | { type: "call-start"; callId: string; itemType: SemanticItemType; title: string; request: unknown }
  | { type: "call-done"; callId: string; itemType: SemanticItemType; title: string; durationMs: number; response: unknown; kept: { key: string; value: number; excerpts: number }[]; dropped: string[] }
  | { type: "call-failed"; callId: string; itemType: SemanticItemType; title: string; durationMs: number; error: unknown }
  | ({ type: "company"; itemType: SemanticItemType; title: string; company: string; durationMs: number } & CompanyResolution)
  | { type: "readme"; title: string; repo: string | null; template: string | null; excerpts: string[] }
  | { type: "done"; result: SemanticRefreshResult };
export type SemanticObserver = (event: SemanticObserverEvent) => void;
const COMPANY_KB_TTL_MS = 180 * 86_400_000;

interface State { input: ScoringInput; settings: ProfileScoringSettings; fingerprint: string; visibility: "name" | "anonymous" | "hidden"; name: string; identities: string[] }
interface Ranked { doc: ProfileScoreDoc; displayName: string; rank: number; percentile: number | null }
interface Calculation { state: State; doc: ProfileScoreDoc; evaluation: ScoreEvaluation }

function evaluationFromSnapshot(snapshot: ProfileScoreSnapshot): ScoreEvaluation {
  const { id: _id, week: _week, calculatedAt: _calculatedAt, rank: _rank, percentile: _percentile, cohortSize: _cohortSize, ...evaluation } = snapshot;
  return evaluation;
}

/** Deterministic beta scoring over local data only. No collection, AI, provider or interview side effects. */
export class ProfileScoringService {
  readonly config: ScoringConfig;
  private readonly now: () => Date;
  constructor(private readonly d: Deps) {
    this.config = structuredClone(d.config ?? DEFAULT_SCORING_CONFIG);
    validateScoringConfig(this.config);
    this.now = d.now ?? (() => new Date());
  }

  private async state(userId: string, asOf: string): Promise<State> {
    const [user, profile, fragments, storedSettings, settingsRevision, github, leetcode, preferences, semantic, platforms] = await Promise.all([
      this.d.users.findById(userId), this.d.profiles.findByUserId(userId), this.d.fragments.findByUserId(userId), this.d.repo.settings(userId),
      this.d.repo.settingsRevision(userId), this.d.github.findByUserId(userId), this.d.leetcode.findByUserId(userId), this.d.preferences.get(userId),
      // Stored, previously produced item assessments: a local read, never an LLM call.
      this.config.v5Policy ? this.d.repo.semanticAssessments(userId) : Promise.resolve([] as SemanticAssessmentDoc[]),
      this.d.platforms ? this.d.platforms.findByUserId(userId) : Promise.resolve(null),
    ]);
    if (!user) throw new ApiError(404, "user_not_found", "no such user");
    const settings = { ...storedSettings, declaredLevel: effectiveDeclaredLevel(profile, storedSettings.declaredLevel) };
    // A leftover fragment after disconnect/reconnect is not evidence of the new connection.
    const connected = fragments.filter((f) => {
      if (f.source === "GITHUB") return !!github && f.fetchedAt >= github.connectedAt;
      if (f.source === "LEETCODE") return !!leetcode && ["SYNCED", "DEGRADED"].includes(leetcode.status) && f.fetchedAt >= leetcode.connectedAt;
      if ((CODING_PLATFORMS as readonly string[]).includes(f.source) && platforms) {
        const row = platforms.find((p) => p.platform === f.source);
        return !!row && ["SYNCED", "DEGRADED"].includes(row.status) && f.fetchedAt >= row.connectedAt;
      }
      // Legacy holistic assessments were stored as a fragment (and leaked into the profile API); ignore.
      return String(f.source) !== "LLM_ASSESSMENT";
    });
    const input = buildScoringInput(profile, connected, { asOf, declaredLevel: settings.declaredLevel, version: this.config.version, identities: [user.name, user.email],
      semanticAssessments: semantic.map(({ _id, userId: _userId, contextHash: _contextHash, updatedAt: _updatedAt, ...assessment }) => assessment) });
    const { asOf: _asOf, ...stableInput } = input;
    return { input, settings, name: user.name, identities: [user.name, user.email, profile?.fullName, profile?.email, profile?.phone].filter((value): value is string => typeof value === "string"), visibility: preferences.privacy.leaderboardVisibility,
      fingerprint: digest({ engine: SCORING_ENGINE_REVISION, input: stableInput, settings, settingsRevision, profileRevision: profile?.updatedAt.toISOString() ?? null,
        privacyRevision: preferences.updatedAt, visibility: preferences.privacy.leaderboardVisibility,
        // Connection identifiers never enter the frozen scoring input, but do invalidate reconnections.
        connections: [github?.id ?? null, github?.githubLogin ?? null, leetcode?.id ?? null, leetcode?.username ?? null, leetcode?.status ?? null,
          ...(platforms ?? []).map((p) => `${p.platform}:${p.id}:${p.handle}:${p.status}`)],
        // Source revision/removal/reimport invalidates live cohorts even if minimized claims are identical.
        ...(supportsLinkedIn(this.config.version) ? { linkedinRevision: connected.filter((f) => f.source === "LINKEDIN")
          .map((f) => ({ id: f._id, version: f.version, fetchedAt: f.fetchedAt })) } : {}) }),
    };
  }

  private asOf(now: Date): string { return now.toISOString(); }

  /** Cached for unchanged local input/settings/config/week. asOf is excluded from the key and frozen on first creation. */
  private async calculate(userId: string, now: Date, stages?: ProfileTraceStage[]): Promise<Calculation> {
    const record = (id: string, startedAt: Date, detail: string, status: "completed" | "failed" = "completed") => {
      const finishedAt = this.now();
      stages?.push({ id, status, startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()), detail });
    };
    const stateStarted = this.now();
    const state = await this.state(userId, this.asOf(now));
    record("local-state", stateStarted, "Read current profile, fragments, scoring settings and connection fences from local storage.");
    const week = scoringWeek(now);
    const id = digest({ userId, week, configHash: digest(this.config), fingerprint: state.fingerprint });
    const cached = await this.d.repo.findSnapshot(id);
    if (cached) {
      record("evaluation", this.now(), "Resolved the deterministic evaluation from current local input and configuration.");
      record("snapshot", this.now(), "Resolved the deterministic current profile score snapshot.");
      return { state, doc: cached, evaluation: evaluationFromSnapshot(cached.snapshot) };
    }
    const evaluationStarted = this.now();
    const evaluation = evaluateProfile(state.input, this.config);
    record("evaluation", evaluationStarted, "Evaluated the sanitized local scoring input with the current deterministic engine and configuration.");
    const snapshot: ProfileScoreSnapshot = { ...evaluation, id, week, calculatedAt: now.toISOString(), rank: null, percentile: null, cohortSize: 0 };
    const saved = await this.d.repo.save({ _id: id, userId, fingerprint: state.fingerprint, input: state.input, config: structuredClone(this.config), snapshot });
    record("snapshot", this.now(), "Resolved the deterministic current profile score snapshot.");
    // Paired with deletion's final purge: a batch that raced account deletion cannot resurrect documents.
    if (!(await this.d.users.findById(userId))) {
      await this.d.repo.deleteByUserId(userId);
      throw new ApiError(404, "user_not_found", "no such user");
    }
    return { state, doc: saved, evaluation };
  }

  async get(userId: string): Promise<ProfileScoreResponse> {
    const now = this.now();
    try {
      const { doc } = await this.calculate(userId, now);
      return this.response(userId, doc, now);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) await this.d.repo.deleteByUserId(userId);
      throw err;
    }
  }

  /**
   * Recalculate: re-run the AI assessment for new or changed items (unchanged ones reuse their stored result), then
   * score. The model work runs in the background, so this returns at once with `assessment.inProgress` set and the
   * score card polls until the new snapshot is there. Limited to RECALCULATION_LIMIT runs per user in a rolling
   * week, enforced in Mongo so restarts and replicas share it. Without assessments enabled it only recomputes
   * the deterministic score, which is idempotent for the same week, configuration and input.
   */
  async recalculate(userId: string): Promise<ProfileScoreResponse> {
    if (this.assessmentEnabled()) {
      const outcome = await this.startAssessment(userId, false);
      if (outcome === "cooldown") {
        throw new ApiError(429, "profile_scoring_recalculation_cooldown", "The last assessment could not be completed. Please try again in a few minutes; it did not use one of your recalculations.");
      }
      if (outcome === "limit") {
        const status = await this.assessmentStatus(userId, this.now());
        throw new ApiError(429, "profile_scoring_recalculation_limit", status.nextAvailableAt
          ? `You've used all ${RECALCULATION_LIMIT} recalculations for this week. The next one is available ${status.nextAvailableAt}.`
          : `You've used all ${RECALCULATION_LIMIT} recalculations for this week.`);
      }
    }
    return this.get(userId);
  }

  /**
   * First assessment for someone who has never had one, so a new user does not wait for the weekly batch. Called after
   * onboarding completes and on the first score view; it counts as one of the user's weekly runs. Returns at once.
   */
  async autoAssessIfFirst(userId: string): Promise<void> {
    if (!this.d.autoAssess || !this.assessmentEnabled()) return;
    const now = this.now();
    const usage = await this.d.runs!.usage(userId, now, RECALCULATION_WINDOW_MS);
    if (usage.everAssessed || (usage.assessingUntil && usage.assessingUntil > now)) return;
    // A failed automatic try is not repeated on every page view.
    if (usage.autoTriedAt && now.getTime() - usage.autoTriedAt.getTime() < AUTO_RETRY_MS) return;
    if ((await this.d.repo.semanticAssessments(userId)).length) { await this.d.runs!.markAssessed(userId); return; }
    await this.startAssessment(userId, true);
  }

  private assessmentEnabled(): boolean { return Boolean(this.d.runs && this.d.aiService && this.config.v5Policy); }

  /** Take a slot and start the run. "busy" = one is already in flight (nothing new is taken); "limit" = no slot left. */
  private async startAssessment(userId: string, auto: boolean): Promise<"started" | "busy" | "limit" | "cooldown"> {
    const runs = this.d.runs!, now = this.now();
    const usage = await runs.usage(userId, now, RECALCULATION_WINDOW_MS);
    if (usage.assessingUntil && usage.assessingUntil > now) return "busy";
    if (usage.cooldownUntil && usage.cooldownUntil > now) return "cooldown";
    if (!(await runs.reserve(userId, now, RECALCULATION_LIMIT, RECALCULATION_WINDOW_MS, auto))) return "limit";
    if (!(await runs.begin(userId, now, ASSESSMENT_RUN_TTL_MS))) { await runs.release(userId, now); return "busy"; }
    const task = async () => {
      let assessed = 0, failed = 0;
      try {
        // A long run (many items, slow free-tier providers) keeps its marker alive between model calls.
        const result = await this.refreshSemanticAssessments(userId, { renew: async () => { await runs.extend(userId, new Date(this.now().getTime() + ASSESSMENT_RUN_TTL_MS)); return true; } });
        assessed = result.assessed; failed = result.failed;
        await this.calculate(userId, this.now());
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 404)) throw err;
      } finally {
        // A run that stored nothing (everything reused, no items, or every call failed) does not use up a slot.
        if (assessed === 0) await runs.release(userId, now);
        // When every call failed, hold new runs for a while so a failing provider chain is not retried in a loop.
        await runs.end(userId, assessed > 0, assessed === 0 && failed > 0 ? new Date(this.now().getTime() + FAILED_RUN_COOLDOWN_MS) : null);
      }
    };
    if (this.d.background) this.d.background.run("profile-score-assess", task); else await task().catch(() => undefined);
    return "started";
  }

  private async assessmentStatus(userId: string, now: Date): Promise<ProfileAssessmentStatus> {
    if (!this.assessmentEnabled()) return { available: false, inProgress: false, limit: RECALCULATION_LIMIT, remaining: RECALCULATION_LIMIT, nextAvailableAt: null };
    const usage = await this.d.runs!.usage(userId, now, RECALCULATION_WINDOW_MS);
    const remaining = Math.max(0, RECALCULATION_LIMIT - usage.used);
    return { available: true, inProgress: Boolean(usage.assessingUntil && usage.assessingUntil > now), limit: RECALCULATION_LIMIT, remaining,
      nextAvailableAt: remaining === 0 && usage.oldest ? new Date(usage.oldest.getTime() + RECALCULATION_WINDOW_MS).toISOString() : null };
  }

  async updateSettings(userId: string, patch: Partial<ProfileScoringSettings>): Promise<ProfileScoreResponse> {
    if (!(await this.d.users.findById(userId))) throw new ApiError(404, "user_not_found", "no such user");
    if (Object.hasOwn(patch, "declaredLevel") && patch.declaredLevel !== null && !isEngineeringLevel(patch.declaredLevel)) {
      throw new ApiError(400, "invalid_profile_scoring_request", "Choose one of the eight supported engineering levels.");
    }
    const current = await this.d.repo.settings(userId);
    const settingsPatch = { ...patch };
    if (Object.hasOwn(patch, "declaredLevel")) {
      const profile = await this.d.profiles.findByUserId(userId);
      if (profile) {
        if (!Object.hasOwn(profile, "level") || profile.level !== patch.declaredLevel) await this.d.profiles.patchLevel(userId, patch.declaredLevel!);
        // Existing compatibility scalar is cleared, not maintained as a second user choice.
        settingsPatch.declaredLevel = null;
      }
      // Pre-profile drafts may retain the compatibility value until a profile owns a level field.
    }
    if (Object.entries(settingsPatch).some(([key, value]) => current[key as keyof ProfileScoringSettings] !== value)) {
      await this.d.repo.patchSettings(userId, settingsPatch, this.now());
    }
    return this.get(userId);
  }

  /**
   * Producer for per-item semantic sub-features. Runs outside the deterministic engine: in the
   * scoring batch or on an explicit request. An item is (re)assessed only when its content, the
   * user's rubric level, the prompt version or its README context changed; everything else reuses
   * the stored assessment. A judgment is never carried over when a fresh one was needed: when the
   * call fails (or the batch budget runs out first) the item's older assessment is deleted, so the
   * item is unassessed and the engine counts everything judged from it as 0 until it succeeds.
   */
  async refreshSemanticAssessments(userId: string, opts: { budget?: { remaining: number }; renew?: () => Promise<boolean>; force?: boolean; observer?: SemanticObserver } = {}): Promise<SemanticRefreshResult> {
    const result: SemanticRefreshResult = { assessed: 0, reused: 0, skipped: 0, failed: 0, budgetExhausted: false };
    const policy = this.config.v5Policy?.semantic, ai = this.d.aiService, observe = opts.observer ?? (() => {});
    if (!policy || !ai) return result;
    const now = this.now(), state = await this.state(userId, this.asOf(now));
    const [user, profile, stored, fragments] = await Promise.all([this.d.users.findById(userId), this.d.profiles.findByUserId(userId), this.d.repo.semanticAssessments(userId), this.d.fragments.findByUserId(userId)]);
    if (!user) throw new ApiError(404, "user_not_found", "no such user");
    // Same rubric level the engine will use (declared, else the deterministic evidence floor).
    const level = evaluateProfile({ ...state.input, semanticAssessments: [] }, this.config).level;
    const items = profileItems(state.input.profile);
    const companies = this.companiesByItem(profile, scoringIdentities(profile, this.config.version, [user.name, user.email]));
    const readmes = readmeIndex(fragments.find((f) => f.source === "GITHUB")?.data);
    const context = { targetRole: profile?.targetRole ?? null, level, specialization: null,
      yearsExperience: Math.round(experienceMonths(state.input.profile, state.input.asOf).months / 12 * 10) / 10 };
    const perType = { project: 0, experience: 0, internship: 0 }, keep: string[] = [], drop = new Set<string>();
    let catalogue: CompanyRow[] | null = null;
    observe({ type: "start", level, items: items.length, context, promptVersion: policy.promptVersion, force: opts.force === true });
    for (const item of items) {
      if (!item.text.length || perType[item.type] >= policy.maximumItems[item.type]) {
        result.skipped++;
        observe({ type: "item", status: "skipped", itemType: item.type, title: item.title, reason: !item.text.length ? "no text to assess" : `over the ${policy.maximumItems[item.type]}-item limit for ${item.type}` });
        continue;
      }
      perType[item.type]++;
      const id = hashJson({ userId, itemType: item.type, itemHash: item.hash, level });
      keep.push(id);
      const readme = item.type === "project" ? readmes(item.title) : null;
      if (readme) observe({ type: "readme", title: item.title, ...readme });
      const request = buildItemAssessmentRequest(item, context, policy, readme?.excerpts ?? []);
      const contextHash = assessmentContextHash(request, policy.promptVersion);
      const existing = stored.find((doc) => doc._id === id);
      const company = companies.get(item.hash);
      if (!opts.force && existing && existing.contextHash === contextHash && existing.promptVersion === policy.promptVersion && (!company || existing.companyContext)) {
        result.reused++;
        observe({ type: "item", status: "reused", itemType: item.type, title: item.title, reason: "unchanged item, level and prompt version: stored assessment reused (no LLM call)",
          features: existing.features.map((f) => ({ key: f.key, value: f.value })), companyContext: existing.companyContext ?? null });
        continue;
      }
      if (opts.budget && opts.budget.remaining <= 0) {
        result.budgetExhausted = true;
        if (existing) drop.add(id);
        observe({ type: "item", status: "budget", itemType: item.type, title: item.title, reason: `batch LLM budget exhausted${existing ? "; the outdated stored assessment is removed (counts as 0)" : ""}` });
        continue;
      }
      if (opts.renew && !(await opts.renew())) throw new Error("lease lost");
      const callId = randomUUID();
      const callStarted = Date.now();
      try {
        const current = !opts.force && existing && existing.contextHash === contextHash && existing.promptVersion === policy.promptVersion;
        let assessment: SemanticItemAssessment;
        if (current) assessment = { ...existing };
        else {
          observe({ type: "call-start", callId, itemType: item.type, title: item.title, request });
          const response = await ai.assessProfileScoring(request);
          assessment = toSemanticAssessment(response, item, level, policy);
          observe({ type: "call-done", callId, itemType: item.type, title: item.title, durationMs: Date.now() - callStarted, response,
            kept: assessment.features.map((f) => ({ key: f.key, value: f.value, excerpts: f.excerpts.length })),
            dropped: request.requestedFeatures.map((f) => typeof f === "string" ? f : f.key).filter((key) => !assessment.features.some((f) => f.key === key)) });
        }
        if (!current && opts.budget) opts.budget.remaining--;
        if (company && item.type !== "project") {
          catalogue ??= await this.d.companies?.findAll().catch(() => [] as CompanyRow[]) ?? [];
          const companyStarted = Date.now();
          assessment.companyContext = await this.resolveCompanyContext(company, catalogue, (info) => observe({ type: "company", itemType: item.type, title: item.title, company, durationMs: Date.now() - companyStarted, ...info }), opts.force === true)
            .catch((err: unknown) => { observe({ type: "company", itemType: item.type, title: item.title, company, durationMs: Date.now() - companyStarted, path: "failed", value: null, error: err }); return null; });
        }
        const { _id: _ignoredId, userId: _ignoredUser, contextHash: _ignoredHash, updatedAt: _ignoredAt, ...plain } = assessment as SemanticAssessmentDoc;
        await this.d.repo.saveSemanticAssessment({ ...plain, _id: id, userId, contextHash, updatedAt: this.now() });
        result.assessed++;
      } catch (err) {
        if (err instanceof Error && err.message === "lease lost") throw err;
        result.failed++;
        // No fallback to an older judgment: the item is unassessed until a call succeeds.
        drop.add(id);
        observe({ type: "call-failed", callId, itemType: item.type, title: item.title, durationMs: Date.now() - callStarted, error: err });
      }
    }
    // Keep other-level assessments for current items; drop items that were edited or removed.
    const currentHashes = new Set(items.map((item) => item.hash));
    await this.d.repo.pruneSemanticAssessments(userId, [...keep, ...stored.filter((doc) => currentHashes.has(doc.itemHash)).map((doc) => doc._id)].filter((id) => !drop.has(id)));
    observe({ type: "done", result });
    return result;
  }

  /** Item hash -> employer name, rebuilt from the raw profile with the engine's own redaction. */
  private companiesByItem(profile: CandidateProfileDoc | null, identities: string[]): Map<string, string> {
    const out = new Map<string, string>();
    for (const entry of profile?.experience ?? []) {
      if (!entry.company?.trim()) continue;
      const sanitized = sanitizeProfile({ headline: null, education: [], experience: [entry], projects: [], skills: [], achievements: [] }, identities);
      const item = profileItems(sanitized).find((x) => x.type !== "project");
      if (item) out.set(item.hash, entry.company.trim());
    }
    return out;
  }

  /** Catalogue research first, then the shared knowledge base, then model knowledge (cached 180 days). */
  private async resolveCompanyContext(name: string, catalogue: CompanyRow[], report: (info: CompanyResolution) => void = () => {}, refresh = false): Promise<{ value: number; source: string } | null> {
    const key = companyKey(name);
    if (!key) { report({ path: "unknown", value: null, reason: "company name is empty after normalization" }); return null; }
    const now = this.now();
    let doc: CompanyKnowledgeDoc | null = await this.d.repo.company(key);
    let path: CompanyResolution["path"] = "cached";
    if (refresh || !doc || now.getTime() - doc.updatedAt.getTime() > COMPANY_KB_TTL_MS) {
      const row = catalogue.find((company) => [company.name, ...company.aliases].some((alias) => companyKey(alias) === key));
      if (row) {
        path = "catalogue";
        doc = { _id: key, source: "catalogue", updatedAt: now, name: row.name, industry: row.sector, companySize: row.headcountBand, engineeringSize: null, productType: row.businessModel,
          technicalDomains: [], knownTechnologies: [], internshipProgram: null, internshipSelectivity: null, geographicScope: null, companyStage: row.fundingStage,
          evidenceSources: ["company-catalogue"], observedAt: now.toISOString() };
      } else if (this.d.aiService) {
        const known = await this.d.aiService.companyContext(name.slice(0, 120));
        // The AI service falls back to cited web search when the model does not know the company.
        path = known.basis === "web_search" ? "web" : "model";
        const entry: CompanyKnowledgeBaseEntry = { name: name.slice(0, 120), industry: known.industry, companySize: known.companySize, engineeringSize: known.engineeringSize,
          companyHeadcount: known.companyHeadcount ?? null, engineeringHeadcount: known.engineeringHeadcount ?? null, sizeEvidence: known.sizeEvidence ?? null,
          productType: known.productType, technicalDomains: known.technicalDomains, knownTechnologies: known.knownTechnologies, internshipProgram: known.internshipProgram,
          internshipSelectivity: known.internshipSelectivity, geographicScope: known.geographicScope, companyStage: known.companyStage,
          evidenceSources: known.basis === "web_search" ? (known.evidenceUrls ?? []).map((url) => `web:${url}`) : [`model:${known.model}`], observedAt: known.generatedAt };
        doc = { ...entry, _id: key, source: known.basis === "web_search" ? "web" : "llm", updatedAt: now };
      } else { report({ path: "unknown", value: null, reason: "not in the catalogue and no AI service configured" }); return null; }
      await this.d.repo.saveCompany(doc);
    }
    const scored = companyContextFromEntry(doc);
    const label = doc.source === "catalogue" ? "company catalogue" : doc.source === "web" ? "web search" : "model knowledge";
    report({ path, value: scored?.value ?? null, reason: scored ? `${label} facts` : "no engineering facts known for this company",
      evidenceUrls: doc.evidenceSources.filter((source) => source.startsWith("web:")).map((source) => source.slice(4)),
      facts: { industry: doc.industry, companySize: doc.companySize, companyHeadcount: doc.companyHeadcount ?? null, engineeringSize: doc.engineeringSize, engineeringHeadcount: doc.engineeringHeadcount ?? null,
        sizeEvidence: doc.sizeEvidence ?? null, productType: doc.productType, companyStage: doc.companyStage, technicalDomains: doc.technicalDomains } });
    return scored ? { value: scored.value, source: doc.source === "catalogue" ? "company-catalogue" : doc.source === "web" ? "company-web-search" : "company-model-knowledge" } : null;
  }

  /**
   * Admin live trace for one user, streamed step by step through `emit` (NDJSON on the wire). It runs
   * what the weekly batch runs for that user: the semantic producer (AI-service calls for new or
   * edited items, or for every item with `forceReassess`), the snapshot write, and the deterministic
   * engine with a debug sink over exactly the input that snapshot froze, so the trace explains the
   * stored score. Source collectors are never called: fragments are read as stored. The trace keeps
   * full detail (names, contacts, employers, raw profile and source data) for debugging; only
   * credential-looking strings are scrubbed. A failure is emitted with its stack, then rethrown.
   */
  async inspectLive(userId: string, opts: { emit?: (event: LiveTraceEvent) => void; forceReassess?: boolean } = {}): Promise<ProfileLiveTraceResponse> {
    const traceId = randomUUID(), startedAt = this.now(), started = Date.now();
    const stages: ProfileTraceStage[] = [], llmCalls: ProfileTraceLlmCall[] = [];
    let seq = 0, current = "user";
    // Full detail for debugging (names, contacts, employers included); only credentials are scrubbed.
    const scrub = <T>(value: T) => scrubTrace(value) as T;
    const emit = (kind: LiveTraceEvent["kind"], level: LiveTraceEvent["level"], message: string, data?: unknown) => {
      if (!opts.emit) return;
      const event: LiveTraceEvent = { seq: ++seq, ts: new Date().toISOString(), elapsedMs: Date.now() - started, kind, stage: current, level, message: scrub(message), ...(data === undefined ? {} : { data: scrub(data) }) };
      try { opts.emit(event); } catch { /* a closed client never breaks the run */ }
    };
    const stage = async <T>(id: string, label: string, run: () => Promise<T>, describe: (value: T) => string = () => label): Promise<T> => {
      current = id;
      const t0 = this.now();
      emit("stage", "info", `${label}...`, { id, status: "running" });
      try {
        const value = await run();
        const t1 = this.now(), durationMs = Math.max(0, t1.getTime() - t0.getTime()), detail = describe(value);
        stages.push({ id, status: "completed", startedAt: t0.toISOString(), finishedAt: t1.toISOString(), durationMs, detail: scrub(detail) });
        emit("stage", "info", `${label}: done in ${durationMs} ms. ${detail}`, { id, status: "completed", durationMs });
        return value;
      } catch (err) {
        const t1 = this.now(), durationMs = Math.max(0, t1.getTime() - t0.getTime()), error = errorDetail(err);
        stages.push({ id, status: "failed", startedAt: t0.toISOString(), finishedAt: t1.toISOString(), durationMs, detail: scrub(`${label} failed: ${error.message}`) });
        emit("stage", "error", `${label}: FAILED after ${durationMs} ms`, { id, status: "failed", durationMs });
        emit("error", "error", `${error.name}: ${error.message}`, error);
        throw err;
      }
    };
    const skip = (id: string, label: string, reason: string) => {
      current = id;
      const at = this.now().toISOString();
      stages.push({ id, status: "skipped", startedAt: at, finishedAt: at, durationMs: 0, detail: reason });
      emit("stage", "warn", `${label}: skipped. ${reason}`, { id, status: "skipped", reason });
    };

    emit("log", "info", `Live profile trace ${traceId} for user ${userId}`, { traceId, userId, algorithm: this.config.version, forceReassess: opts.forceReassess === true, aiServiceConfigured: Boolean(this.d.aiService) });
    await stage("user", "Load user", async () => {
      const found = await this.d.users.findById(userId);
      if (!found) throw new ApiError(404, "user_not_found", "no such user");
      // Never the password hash or OAuth subject: account identity only.
      emit("log", "info", `User ${found.name} <${found.email}>`, { user: { id: found.id, name: found.name, email: found.email, role: found.role } });
      return found;
    }, () => "User loaded.");

    const { fragments } = await stage("sources", "Read stored profile and sources", async () => {
      const [state, all, stored] = await Promise.all([this.state(userId, this.asOf(startedAt)), this.d.fragments.findByUserId(userId), this.d.profiles.findByUserId(userId)]);
      const used = new Set(state.input.fragments.map((fragment) => fragment.source));
      const profile = state.input.profile;
      emit("log", "info", `Resume profile: ${profile ? `${profile.experience.length} experience, ${profile.projects.length} project(s), ${profile.skills.length} skill(s), ${profile.achievements.length} achievement(s)` : "none"}; level ${state.settings.declaredLevel ?? "not selected"}`,
        { declaredLevel: state.settings.declaredLevel, leaderboardOptIn: state.settings.leaderboardOptIn, storedProfile: stored, scoringInput: profile });
      for (const fragment of all) {
        const isUsed = used.has(fragment.source.toLowerCase());
        emit("log", isUsed ? "info" : "warn", `${fragment.source}: ${isUsed ? "used" : "EXCLUDED"} (v${fragment.version}, fetched ${fragment.fetchedAt.toISOString()})`, {
          source: fragment.source, used: isUsed, version: fragment.version, fetchedAt: fragment.fetchedAt, contentHash: fragment.contentHash, data: fragment.data,
          reason: isUsed ? null : String(fragment.source) === "LLM_ASSESSMENT" ? "legacy assessment fragment; ignored" : "no live connection, the connection is not SYNCED/DEGRADED, or the fragment predates the current connection",
        });
      }
      return { state, fragments: all };
    }, (value) => `${value.state.input.fragments.length} of ${value.fragments.length} stored fragment(s) used.`);

    let semantic: SemanticRefreshResult | null = null;
    if (!this.config.v5Policy) skip("semantic", "AI item assessment", `Policy ${this.config.version} has no semantic layer (set PROFILE_SCORING_POLICY=v5).`);
    else if (!this.d.aiService) skip("semantic", "AI item assessment", "No AI service is configured, so items stay unassessed (unknown, not zero).");
    else {
      const observe: SemanticObserver = (event) => {
        if (event.type === "start") {
          emit("log", "info", `Assessing ${event.items} resume item(s) at ${event.level} with ${event.promptVersion}${event.force ? " (forced: every item is re-sent to the LLM)" : ""}`, { context: event.context, level: event.level, promptVersion: event.promptVersion });
        } else if (event.type === "item") {
          llmCalls.push({ callId: randomUUID(), call: "item-assessment", status: event.status === "reused" ? "reused" : "skipped", itemType: event.itemType, itemTitle: scrub(event.title), durationMs: null, detail: scrub(event.reason), error: null });
          emit("llm", event.status === "budget" ? "warn" : "info", `${event.itemType} "${event.title}": ${event.status} (${event.reason})`, event);
        } else if (event.type === "call-start") {
          emit("llm", "info", `-> LLM item-assessment for ${event.itemType} "${event.title}"`, { callId: event.callId, request: event.request });
        } else if (event.type === "call-done") {
          llmCalls.push({ callId: event.callId, call: "item-assessment", status: "completed", itemType: event.itemType, itemTitle: scrub(event.title), durationMs: event.durationMs,
            detail: scrub(`${event.kept.length} feature(s) kept${event.dropped.length ? `, ${event.dropped.length} without a verbatim quote (unavailable): ${event.dropped.join(", ")}` : ""}`), error: null });
          emit("llm", "info", `<- ${event.itemType} "${event.title}" in ${event.durationMs} ms: ${event.kept.map((f) => `${f.key}=${f.value}`).join(", ") || "no quoted feature"}`, event);
        } else if (event.type === "call-failed") {
          const error = errorDetail(event.error);
          llmCalls.push({ callId: event.callId, call: "item-assessment", status: "failed", itemType: event.itemType, itemTitle: scrub(event.title), durationMs: event.durationMs, detail: scrub(error.message), error: scrub(error) });
          emit("llm", "error", `x ${event.itemType} "${event.title}" failed after ${event.durationMs} ms: ${error.name}: ${error.message}`, { callId: event.callId, durationMs: event.durationMs, error });
        } else if (event.type === "readme") {
          emit("log", "info", event.repo === null ? `project "${event.title}": no matching public repository README`
            : event.template ? `project "${event.title}": README of ${event.repo} is the unchanged ${event.template} starter text; treated as no README`
            : `project "${event.title}": README of ${event.repo} sent as ${event.excerpts.length} excerpt(s)`, event);
        } else if (event.type === "company") {
          const error = event.error === undefined ? null : errorDetail(event.error);
          llmCalls.push({ callId: randomUUID(), call: "company-context", status: event.path === "failed" ? "failed" : event.path === "model" || event.path === "web" ? "completed" : "reused", itemType: event.itemType, itemTitle: scrub(event.title),
            durationMs: event.durationMs, detail: scrub(`${event.path}: ${event.reason ?? ""} -> ${event.value ?? "no value"}`), error: error ? scrub(error) : null });
          emit(event.path === "model" || event.path === "web" ? "llm" : "log", error ? "error" : "info", `Company context for ${event.company} (${event.itemType} "${event.title}"): ${event.path} -> ${event.value ?? "unknown"} (${event.durationMs} ms)`, { ...event, error });
        } else {
          emit("log", event.result.failed ? "warn" : "info", `Assessment summary: ${event.result.assessed} assessed, ${event.result.reused} reused, ${event.result.skipped} skipped, ${event.result.failed} failed${event.result.budgetExhausted ? ", budget exhausted" : ""}`, event.result);
        }
      };
      semantic = await stage("semantic", "AI item assessment", () => this.refreshSemanticAssessments(userId, { force: opts.forceReassess === true, observer: observe }),
        (result) => `${result.assessed} assessed, ${result.reused} reused, ${result.skipped} skipped, ${result.failed} failed.`);
    }

    const calculation = await stage("snapshot", "Calculate and persist the weekly snapshot", () => this.calculate(userId, startedAt), (value) => {
      const reused = value.doc.snapshot.calculatedAt !== startedAt.toISOString();
      emit("log", "info", reused ? `Reused this week's snapshot ${value.doc._id} (input unchanged; frozen asOf ${value.doc.input.asOf})` : `Saved a new snapshot ${value.doc._id}`, { snapshotId: value.doc._id, reused, asOf: value.doc.input.asOf, fingerprint: value.doc.fingerprint });
      return reused ? "Unchanged input: this week's snapshot was reused." : "New snapshot saved.";
    });

    const { evaluation, breakdown } = await stage("engine", "Deterministic engine (debug)", async () => {
      const subFeatures = new Map<string, ProfileTraceComponent["subFeatures"]>();
      // The frozen input of the persisted snapshot, so every step below explains the stored score.
      const result = evaluateProfile(calculation.doc.input, this.config, (event: EngineDebugEvent) => {
        if (event.step === "composite") subFeatures.set(String(event.detail.component), (event.detail.used as ProfileTraceComponent["subFeatures"]) ?? []);
        emit("engine", event.step === "eligibility" && event.detail.eligible === false ? "warn" : ["input", "composite", "formula", "eligibility", "open-source"].includes(event.step) ? "info" : "debug", `[${event.step}] ${event.message}`, event.detail);
      });
      if (result.score !== calculation.evaluation.score) emit("log", "warn", `Debug evaluation scored ${result.score} but the snapshot holds ${calculation.evaluation.score}; the snapshot was written by a different engine build`, { debug: result.score, snapshot: calculation.evaluation.score });
      return { evaluation: result, breakdown: subFeatures };
    }, (value) => `Score ${value.evaluation.score ?? "none"}, coverage ${value.evaluation.coverage}%, ${value.evaluation.evidence.length} evidence item(s).`);

    current = "trace";
    const usedSources = new Set(calculation.doc.input.fragments.map((fragment) => fragment.source));
    const sourceTraces: ProfileTraceSource[] = [
      { source: "RESUME", status: calculation.doc.input.profile ? "available" : "missing", fetchedAt: null, ageDays: null, contentHash: calculation.doc.input.profile ? hashJson(calculation.doc.input.profile) : null,
        extractedFieldCounts: Object.fromEntries(Object.entries(calculation.doc.input.profile ?? {}).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, (value as unknown[]).length])), safeSummary: { profilePresent: calculation.doc.input.profile !== null } },
      ...fragments.filter((fragment) => String(fragment.source) !== "LLM_ASSESSMENT").map((fragment): ProfileTraceSource => {
        const name = fragment.source.toLowerCase(), evaluated = evaluation.sources.find((entry) => entry.source === name), stored = calculation.doc.input.fragments.find((entry) => entry.source === name);
        const data = object(stored?.data ?? {});
        return { source: fragment.source, status: usedSources.has(name) ? evaluated?.status ?? "available" : "excluded", fetchedAt: fragment.fetchedAt.toISOString(), ageDays: evaluated?.ageDays ?? null, contentHash: evaluated?.contentHash ?? stored?.contentHash ?? null,
          extractedFieldCounts: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, Array.isArray(value) ? value.length : value && typeof value === "object" ? Object.keys(value).length : 1])),
          safeSummary: { used: usedSources.has(name), version: fragment.version, partial: data.partial === true } };
      }),
    ];
    const itemCalls = llmCalls.filter((call) => call.call === "item-assessment"), companyCalls = llmCalls.filter((call) => call.call === "company-context");
    const providerChecks: ProfileTraceProviderCheck[] = [
      { provider: "AI service: item assessment", mode: this.config.v5Policy?.semantic.promptVersion ?? "not in this policy", configured: Boolean(this.d.aiService && this.config.v5Policy),
        used: itemCalls.some((call) => call.status === "completed" || call.status === "failed"), status: itemCalls.some((call) => call.status === "failed") ? "failed" : itemCalls.some((call) => call.status === "completed") ? "used" : "not_used", retrievedAt: null,
        reason: semantic ? `${semantic.assessed} assessed, ${semantic.reused} reused, ${semantic.skipped} skipped, ${semantic.failed} failed`
          : !this.config.v5Policy ? `Not run: the API is scoring with ${this.config.version}, which has no AI layer. Set PROFILE_SCORING_POLICY=v5 (the default) and restart the API.`
          : "Not run: no AI service is configured (AI_SERVICE_BASE_URL)." },
      { provider: "AI service: company context", mode: "Catalogue first, then cached knowledge base, then model knowledge", configured: Boolean(this.d.aiService), used: companyCalls.some((call) => call.status === "completed"),
        status: companyCalls.some((call) => call.status === "failed") ? "failed" : companyCalls.some((call) => call.status === "completed") ? "used" : "not_used", retrievedAt: null,
        reason: companyCalls.length ? `${companyCalls.length} employer lookup(s): ${companyCalls.map((call) => call.detail).join("; ")}` : "No employer lookups were needed." },
      { provider: "Source collectors", mode: "GitHub, LeetCode, coding platforms, LinkedIn import", configured: true, used: false, status: "not_used", retrievedAt: null,
        reason: "Stored fragments are read as-is. Collectors refresh on connect and weekly; the trace never calls them." },
    ];
    // Weighted sum: the weight that has evidence (of 100); older v5 policies: the core weight in the base; older still: parts with evidence.
    const availableWeight = evaluation.components.filter((component) => this.config.v5Policy?.formula === "weighted_sum" ? component.score !== null : component.role ? component.role === "core" && component.counted : component.score !== null).reduce((sum, component) => sum + component.weight, 0);
    const components: ProfileTraceComponent[] = evaluation.components.map((component) => ({
      ...component, availableWeight, formulaInput: component.score === null ? null : { score: component.score, weight: component.weight }, subFeatures: breakdown.get(component.id) ?? [],
    }));
    const finishedAt = this.now();
    stages.push({ id: "trace", status: "completed", startedAt: finishedAt.toISOString(), finishedAt: finishedAt.toISOString(), durationMs: 0, detail: "Assembled the redacted trace." });
    const stackTrace = [
      "PROFILE_SCORING_TRACE",
      `trace ${traceId} user ${userId} algorithm=${evaluation.algorithmVersion} config=${evaluation.configHash} input=${evaluation.inputHash}`,
      ...stages.map((entry) => `stage ${entry.id} ${entry.status} ${entry.durationMs}ms ${entry.detail}`),
      ...llmCalls.map((call) => `llm ${call.call} ${call.status} ${call.itemType ?? "-"} "${call.itemTitle ?? "-"}" ${call.durationMs ?? "-"}ms ${call.detail}${call.error ? ` ERROR ${call.error.message}` : ""}`),
      ...components.map((component) => `component ${component.id} weight=${component.weight} score=${component.score ?? "null"}${component.subFeatures.length ? ` [${component.subFeatures.map((row) => `${row.key}=${row.value}@${row.weight}`).join(", ")}]` : ""}`),
      `score value=${evaluation.score ?? "null"} coverage=${evaluation.coverage} level=${evaluation.level} eligible=${evaluation.eligibility.eligible}${evaluation.eligibility.reasons.length ? ` (${evaluation.eligibility.reasons.join("; ")})` : ""}`,
      "END_PROFILE_SCORING_TRACE",
    ].map((line) => scrub(line)).join("\n");
    const response: ProfileLiveTraceResponse = scrub({
      traceId, userId, startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), stages, sources: sourceTraces, providerChecks,
      score: evaluation.score, confidence: evaluation.confidence, coverage: evaluation.coverage, classification: structuredClone(evaluation.classification),
      algorithm: { version: evaluation.algorithmVersion, configHash: evaluation.configHash, inputHash: evaluation.inputHash }, components,
      evidence: evaluation.evidence, eligibility: structuredClone(evaluation.eligibility), warnings: [...evaluation.warnings],
      formula: { expression: this.config.v5Policy?.formula === "weighted_sum"
        ? "score = sum(weight x part score / 100) over every part at the level; a missing, failed or unassessed part counts as 0"
        : this.config.v5Policy?.missingCountsAsZero
        ? "base = sum(core score x weight) / core weight (a missing, failed or unassessed core part = 0); score = min(100, base + (100 - base) x sum(bonus weight/100 x bonus score/100))"
        : "base = sum(core score x weight) / core weight (missing core = 0, pending left out); score = base + (100 - base) x sum(bonus weight/100 x bonus score/100)", availableWeight, inputs: components }, snapshot: calculation.doc.snapshot, llmCalls, stackTrace, copyText: stackTrace,
    });
    emit("result", "info", `Done in ${Date.now() - started} ms: score ${evaluation.score ?? "none"}, coverage ${evaluation.coverage}%, ${evaluation.eligibility.eligible ? "leaderboard-eligible" : "not leaderboard-eligible"}`, response);
    return response;
  }

  private async response(userId: string, doc: ProfileScoreDoc | null, now: Date): Promise<ProfileScoreResponse> {
    const [history, storedSettings, profile] = await Promise.all([this.d.repo.history(userId), this.d.repo.settings(userId), this.d.profiles.findByUserId(userId)]);
    const settings = { ...storedSettings, declaredLevel: effectiveDeclaredLevel(profile, storedSettings.declaredLevel) };
    let current = doc?.snapshot ?? null;
    if (doc && doc.snapshot.week === scoringWeek(now)) {
      const cohort = await this.cohort(doc.snapshot.level, now, doc.snapshot.configHash, doc.snapshot.algorithmVersion);
      const live = cohort.find((e) => e.doc._id === doc._id);
      // Live decoration is ephemeral; historical snapshots retain their finalized weekly ranks.
      current = { ...doc.snapshot, rank: live?.rank ?? null, percentile: live?.percentile ?? null, cohortSize: live ? cohort.length : 0 };
    }
    return { current, history: history.map((d) => d.snapshot), settings, assessment: await this.assessmentStatus(userId, now) };
  }

  private async cohort(level: EngineeringLevel, now: Date, configHash: string, version: string): Promise<Ranked[]> {
    const docs = await this.d.repo.latestForWeek(scoringWeek(now));
    const entries: Ranked[] = [];
    for (const candidate of docs) {
      try {
        const state = await this.state(candidate.userId, candidate.input.asOf);
        if (!state.settings.leaderboardOptIn || state.visibility === "hidden") continue;
        // Timestamps can tie (or a clock can move backwards). Hash ordering is not edit ordering:
        // use the current input fingerprint, never permanently hide a valid newer assessment.
        const doc = candidate.fingerprint === state.fingerprint && candidate.snapshot.configHash === configHash ? candidate
          : await this.d.repo.findCurrentFingerprint(candidate.userId, scoringWeek(now), state.fingerprint, configHash);
        if (!doc) continue;
        const s = doc.snapshot;
        if (s.level !== level || s.configHash !== configHash || s.algorithmVersion !== version || !s.eligibility.eligible || s.score === null || !Number.isFinite(s.score)) continue;
        const displayName = state.visibility === "name" ? state.name : `Engineer ${createHmac("sha256", this.d.pseudonymKey).update(doc.userId).digest("hex").slice(0, 10)}`;
        entries.push({ doc, displayName, rank: 0, percentile: null });
      } catch (err) { if (!(err instanceof ApiError && err.status === 404)) throw err; }
    }
    entries.sort((a, b) => b.doc.snapshot.score! - a.doc.snapshot.score! || a.doc._id.localeCompare(b.doc._id));
    const n = entries.length;
    for (let i = 0; i < n; i++) {
      const e = entries[i]!;
      const score = e.doc.snapshot.score!;
      const above = entries.filter((r) => r.doc.snapshot.score! > score).length;
      const equal = entries.filter((r) => r.doc.snapshot.score === score).length;
      e.rank = above + 1;
      e.percentile = n >= this.config.thresholds.minimumCohort && n > 1 ? Math.round(1000 * (n - above - equal + (equal - 1) / 2) / (n - 1)) / 10 : null;
    }
    return entries;
  }

  async leaderboard(level: EngineeringLevel, limit: number): Promise<ProfileLeaderboardResponse> {
    const now = this.now();
    const evaluation = evaluateProfile({ asOf: this.asOf(now), declaredLevel: null, profile: null, fragments: [] }, this.config);
    const cohort = await this.cohort(level, now, evaluation.configHash, evaluation.algorithmVersion);
    return { level, algorithmVersion: evaluation.algorithmVersion, week: scoringWeek(now), total: cohort.length,
      entries: cohort.slice(0, limit).map((e) => ({ rank: e.rank, displayName: e.displayName, score: e.doc.snapshot.score!, confidence: e.doc.snapshot.confidence, percentile: e.percentile })) };
  }

  async jobStatus(jobId?: string): Promise<ProfileScoringJobStatus> {
    const now = this.now();
    const configHash = evaluateProfile({ asOf: this.asOf(now), declaredLevel: null, profile: null, fragments: [] }, this.config).configHash;
    const [job, lease, currentWeek] = await Promise.all([jobId ? this.d.repo.job(jobId) : this.d.repo.latestJob(), this.d.repo.lease(), this.d.repo.job(`weekly:${scoringWeek(now)}:${configHash}`)]);
    const expired = job?.status === "running" && (!lease?.owner || lease.expiresAt <= now);
    return { enabled: this.d.schedulerEnabled, status: expired ? "failed" : job?.status ?? "idle", lastStartedAt: job?.startedAt.toISOString() ?? null,
      lastCompletedAt: job?.completedAt?.toISOString() ?? null, lastError: expired ? "Previous scoring run lost its lease; next scheduled poll retries." : job?.error ?? null,
      nextDueAt: this.d.schedulerEnabled ? currentWeek?.status === "completed" ? nextWeek(now) : `${scoringWeek(now)}T00:00:00.000Z` : null, processed: job?.processed ?? 0, failed: job?.failed ?? 0 };
  }

  /** Global durable lease serializes admin and weekly batches across replicas. Completed weeks are skipped. */
  async runBatch(kind: "weekly" | "manual", userId?: string): Promise<ProfileScoringJobStatus> {
    if (userId && !(await this.d.users.findById(userId))) throw new ApiError(404, "user_not_found", "no such user");
    const now = this.now();
    const week = scoringWeek(now);
    const evaluation = evaluateProfile({ asOf: this.asOf(now), declaredLevel: null, profile: null, fragments: [] }, this.config);
    const id = kind === "weekly" ? `weekly:${week}:${evaluation.configHash}` : `manual:${randomUUID()}`;
    if (kind === "weekly" && (await this.d.repo.job(id))?.status === "completed") return this.jobStatus(id);
    const owner = randomUUID();
    if (!(await this.d.repo.acquireLease(owner, now))) {
      if (kind === "weekly") return this.jobStatus();
      throw new ApiError(409, "profile_scoring_busy", "A profile scoring batch is already running.");
    }
    const receipt: ProfileScoringJobDoc = { _id: id, kind, ...(userId ? { userId } : {}), week, configHash: evaluation.configHash, status: "running", startedAt: now, completedAt: null, processed: 0, failed: 0, error: null, leaseOwner: owner };
    try {
      // Recheck after acquiring: another replica may have completed while we waited.
      if (kind === "weekly" && (await this.d.repo.job(id))?.status === "completed") return this.jobStatus(id);
      const prior = kind === "weekly" ? await this.d.repo.job(id) : null;
      if (prior?.rankPlan) receipt.rankPlan = prior.rankPlan;
      await this.d.repo.saveJob(receipt, true);
      const users = userId ? [await this.d.users.findById(userId)].filter((u) => u !== null) : await this.d.users.findAll();
      if (userId && !users.length) throw new ApiError(404, "user_not_found", "no such user");
      const budget = { remaining: this.d.semanticCallsPerBatch ?? 200 };
      for (const user of users) {
        if (!(await this.d.repo.renewLease(owner, this.now()))) throw new Error("lease lost");
        // Refresh changed item assessments first (bounded, best-effort); scoring itself stays local.
        try { await this.refreshSemanticAssessments(user.id, { budget, renew: () => this.d.repo.renewLease(owner, this.now()) }); }
        catch (err) { if (err instanceof Error && err.message === "lease lost") throw err; }
        try { await this.calculate(user.id, now); receipt.processed++; }
        catch (err) {
          if (userId && err instanceof ApiError && err.status === 404) throw err;
          receipt.failed++; receipt.error = "One or more local profile evaluations failed; retry the batch.";
        }
        await this.d.repo.saveJob(receipt);
      }
      // Finalize only once during the calendar-week generation, never on GET or manual recalculation.
      if (kind === "weekly" && receipt.failed === 0) {
        if (!receipt.rankPlan) {
          const plan: NonNullable<ProfileScoringJobDoc["rankPlan"]> = [];
          for (const level of Object.keys(this.config.weights) as EngineeringLevel[]) {
            if (!(await this.d.repo.renewLease(owner, this.now()))) throw new Error("lease lost");
            const cohort = await this.cohort(level, now, evaluation.configHash, evaluation.algorithmVersion);
            plan.push(...cohort.map((entry) => ({ id: entry.doc._id, rank: entry.rank, percentile: entry.percentile, cohortSize: cohort.length })));
          }
          if (!(await this.d.repo.renewLease(owner, this.now()))) throw new Error("lease lost");
          receipt.rankPlan = plan;
          await this.d.repo.saveJob(receipt);
        }
        for (const entry of receipt.rankPlan) {
          if (!(await this.d.repo.renewLease(owner, this.now()))) throw new Error("lease lost");
          await this.d.repo.finalizeRank(entry.id, entry.rank, entry.percentile, entry.cohortSize, this.now());
        }
      }
      receipt.status = receipt.failed ? "failed" : "completed";
      receipt.completedAt = this.now();
      await this.d.repo.saveJob(receipt);
    } catch (err) {
      if (userId && !(await this.d.users.findById(userId))) {
        await this.d.repo.deleteByUserId(userId);
        throw new ApiError(404, "user_not_found", "no such user");
      }
      receipt.status = "failed";
      receipt.error = "Scoring batch failed or lost its lease; safe to retry.";
      receipt.completedAt = this.now();
      await this.d.repo.saveJob(receipt);
      if (err instanceof ApiError) throw err;
    } finally { await this.d.repo.releaseLease(owner); }
    return this.jobStatus(id);
  }

  async diagnostics(userId?: string): Promise<ProfileDiagnosticsResponse> {
    const now = this.now();
    const checks: DiagnosticCheck[] = [];
    let score: ProfileScoreResponse | null = null;
    let jobs: ProfileScoringJobStatus = { enabled: this.d.schedulerEnabled, status: "idle", lastStartedAt: null, lastCompletedAt: null, lastError: null, nextDueAt: this.d.schedulerEnabled ? nextWeek(now) : null, processed: 0, failed: 0 };
    try { await this.d.repo.checkAccess(); checks.push({ id: "storage", label: "Local scoring storage", status: "pass", detail: "Read access to settings, frozen snapshots, durable receipts and lease verified; no writes performed." }); }
    catch { checks.push({ id: "storage", label: "Local scoring storage", status: "fail", detail: "Scoring collection read failed; database access needs investigation." }); }
    try { validateScoringConfig(this.config); checks.push({ id: "methodology", label: "Version, weights and normalizers", status: "pass", detail: "Configuration validates all level weights, positive normalizers and eligibility/cohort thresholds." }); }
    catch { checks.push({ id: "methodology", label: "Version, weights and normalizers", status: "fail", detail: "Scoring configuration validation failed." }); }
    try {
      jobs = await this.jobStatus();
      checks.push({ id: "weekly-job", label: "Weekly scoring job", status: jobs.status === "failed" ? "fail" : jobs.status === "idle" ? "warning" : "pass", detail: jobs.lastError ?? (jobs.status === "idle" ? "No scoring batch receipt yet." : `${jobs.status}; processed ${jobs.processed}, failed ${jobs.failed}.`) });
      if (userId) {
        const state = await this.state(userId, this.asOf(now));
        const history = await this.d.repo.history(userId);
        const doc = history[0] ?? null;
        score = await this.response(userId, doc, now);
        if (doc) {
          const replay = evaluateProfile(doc.input, doc.config);
          const { id: _id, week: _week, calculatedAt: _calculatedAt, rank: _rank, percentile: _percentile, cohortSize: _cohortSize, ...frozenEvaluation } = doc.snapshot;
          checks.push({ id: "replay", label: "Frozen snapshot replay", status: canonicalize(replay) === canonicalize(frozenEvaluation) ? "pass" : "fail", detail: "Re-evaluated the saved minimal input with its exact saved config and asOf; ranking is checked separately." });
          const fresh = doc.fingerprint === state.fingerprint && doc.snapshot.week === scoringWeek(now) && doc.snapshot.configHash === evaluateProfile(state.input, this.config).configHash;
          checks.push({ id: "freshness", label: "Input hashes and freshness", status: fresh ? "pass" : "warning", detail: fresh ? "Current local source/profile/settings fingerprint and calendar week match." : "Snapshot is stale for current input, configuration or week; next score read/recalculation refreshes it." });
          const e = doc.snapshot;
          const bounds = [e.confidence, e.coverage, e.classification.confidence].every((v) => Number.isFinite(v) && v >= 0 && v <= 100)
            && (e.score === null || Number.isFinite(e.score) && e.score >= 0 && e.score <= 100)
            && e.components.every((c) => Number.isFinite(c.weight) && c.weight >= 0 && (c.score === null || Number.isFinite(c.score) && c.score >= 0 && c.score <= 100));
          // v5 (core/bonus): the score is the sum of the counted contributions; older snapshots: weighted mean of parts with evidence.
          const availableWeight = e.components.filter((c) => c.score !== null).reduce((sum, c) => sum + c.weight, 0);
          const weighted = e.components.reduce((sum, c) => sum + (c.score ?? 0) * c.weight, 0);
          const contributions = e.components.reduce((sum, c) => sum + (c.contribution ?? 0), 0);
          const formula = e.score === null || (e.components.some((c) => c.role) ? Math.abs(e.score - contributions) <= 0.11
            : availableWeight > 0 && Math.abs(e.score - weighted / availableWeight) <= 0.11);
          checks.push({ id: "features", label: "Feature bounds and weighted formula", status: bounds && formula ? "pass" : "fail", detail: "Checks finite bounded features and observed-weight score reconstruction (rounding tolerance 0.11)." });
          const rankValid = (e.rank === null || Number.isInteger(e.rank) && e.rank >= 1 && e.rank <= e.cohortSize && e.eligibility.eligible)
            && (e.percentile === null || e.cohortSize >= doc.config.thresholds.minimumCohort && e.cohortSize > 1 && e.percentile >= 0 && e.percentile <= 100);
          checks.push({ id: "ranking", label: "Eligibility and rank constraints", status: rankValid ? "pass" : "fail", detail: "Historical rank must belong to an eligible cohort; percentiles require the frozen config's minimum cohort and more than one member." });
          const staleSource = e.sources.some((s) => s.ageDays !== null && s.ageDays > (s.source === "github" ? 7 : 14));
          checks.push({ id: "sources", label: "Source support and evidence", status: staleSource || e.sources.some((s) => s.status !== "available") || e.status === "insufficient_evidence" ? "warning" : "pass", detail: e.sources.map((s) => `${s.source}: ${s.status}${s.ageDays === null ? "" : `, ${s.ageDays} days old`}${s.source === "linkedin" && s.importMethod !== undefined ? `, ${s.importMethod ?? "unknown method"}, imported ${s.importedAt ?? "unknown"}${s.importMethod === "url" ? `, provider ${s.provider ?? "unknown"}, retrieved ${s.retrievedAt ?? "unknown"}; public partial snapshot` : ""}; self-reported, receipt is not employment verification; ${e.evidence.filter((x) => x.source === "linkedin" || x.paths?.some((p) => p.startsWith("fragments.linkedin."))).length} deduplicated semantic/context claims` : ""}`).join("; ") || "No supported evidence available; missing evidence is unknown." });
        } else checks.push({ id: "replay", label: "Frozen snapshot replay", status: "untested", detail: "No stored score snapshot for this user. Diagnostics do not create one." });
      } else checks.push({ id: "replay", label: "Per-user frozen replay", status: "untested", detail: "Choose a userId to check its stored snapshot, local sources and rank constraints." });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) throw err;
      checks.push({ id: "local-evaluation", label: "Local evaluation checks", status: "fail", detail: "A local snapshot/source/job read or replay failed; no provider health is inferred." });
    }
    for (const [id, label] of [["live-provider", "Live GitHub/LeetCode/provider access"], ["interview-prep", "Interview blueprint preparation"], ["voice", "Voice, LiveKit and live interview pipeline"]]) {
      checks.push({ id: id!, label: label!, status: "untested", detail: "Not exercised by deterministic profile diagnostics. Use the relevant integration/test bench for an end-to-end check." });
    }
    return { checkedAt: now.toISOString(), checks, score, jobs, methodology: structuredClone(this.config) };
  }
}

/** The README of the public repository matching a resume project (GitHub fragment), as excerpts. */
interface ProjectReadme { repo: string | null; template: string | null; excerpts: string[] }

/**
 * README excerpts for a resume project whose name matches a public repository. A README that is still
 * its starter tool's default text (create-next-app, Vite, Flutter...) says nothing about the project,
 * so it is treated as no README: no excerpts, with the template named for the trace.
 */
function readmeIndex(data: Record<string, unknown> | undefined): (projectName: string) => ProjectReadme {
  const norm = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const repos = Array.isArray(data?.readmes) ? data.readmes as { repo?: unknown; text?: unknown }[] : [];
  return (projectName) => {
    const target = norm(projectName);
    if (target.length < 3) return { repo: null, template: null, excerpts: [] };
    const repo = repos.find((entry) => typeof entry.repo === "string" && typeof entry.text === "string" && (norm(entry.repo) === target || norm(entry.repo).includes(target) || target.includes(norm(entry.repo))));
    const text = typeof repo?.text === "string" ? repo.text.replace(/\s+/g, " ").trim() : "";
    if (!repo || !text) return { repo: null, template: null, excerpts: [] };
    const template = readmeTemplate(text);
    return { repo: String(repo.repo), template, excerpts: template ? [] : sentenceChunks(text, 800, 2).filter((chunk) => chunk.length > 40) };
  };
}

/** Up to `count` chunks of at most `max` characters, cut at a sentence end (else a word break) so a quoted sentence stays in one chunk. */
function sentenceChunks(text: string, max: number, count: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest && out.length < count) {
    if (rest.length <= max) { out.push(rest); break; }
    const window = rest.slice(0, max + 1);
    const sentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "));
    const space = window.lastIndexOf(" ");
    const cut = sentence > max / 2 ? sentence + 1 : space > max / 2 ? space : max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  return out;
}

/** A thrown value as plain, serializable data (the stack is kept for the admin trace). */
export function errorDetail(err: unknown): { name: string; message: string; stack: string | null; status?: number; code?: string } {
  if (err instanceof Error) {
    const extra = err as Error & { status?: unknown; code?: unknown };
    return { name: err.name, message: err.message, stack: err.stack ?? null, ...(typeof extra.status === "number" ? { status: extra.status } : {}), ...(typeof extra.code === "string" ? { code: extra.code } : {}) };
  }
  return { name: "NonError", message: String(err), stack: null };
}

const SECRET = /\b(?:bearer\s+[\w.-]+|(?:api[_ -]?key|(?:access[_ -]?)?token|private[_ -]?key|password|secret)\s*[:=]\s*\S+)|\b(?:gh[pousr]_|sk[_-]|glpat-)[\w-]+/gi;

/**
 * Prepare a trace value for the admin stream: values are kept exactly (no truncation, personal
 * details included on purpose for admin debugging); only credential-looking strings are scrubbed.
 */
export function scrubTrace(value: unknown): unknown {
  if (typeof value === "string") return value.replace(SECRET, "[redacted secret]");
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => scrubTrace(item));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubTrace(item)]));
}
