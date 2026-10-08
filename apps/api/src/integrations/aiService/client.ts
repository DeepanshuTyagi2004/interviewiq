import type { Logger } from "../../lib/logger.js";
import {
  type FetchLike,
  isUpstreamStatus,
  type OutboundRequest,
  parseJsonBody,
  requestText,
  UpstreamError,
  UpstreamMalformedError,
  UpstreamHttpError,
  UpstreamTransportError,
} from "../../lib/http.js";
import { asString, isObject, path } from "../../lib/json.js";
import type { BlueprintRunRequest, ProfileScoringAssessmentRequest, ProfileScoringAssessmentResponse } from "./types.js";
import { companyContextRequestSchema, parseCompanyContextResponse, parseProfileScoringAssessmentRequest, parseProfileScoringAssessmentResponse, type CompanyContextResponse } from "./profileAssessment.js";

/**
 * HTTP client for interviewiq-ai-service — the home of all LLM logic. This API never calls an LLM
 * itself. Most responses are passed through as parsed JSON (the brief/run shapes are rich and
 * owned by the AI service). Every call carries the shared `X-Internal-Api-Key`.
 *
 * Failure contract (unchanged from the Spring client):
 *  - "lookup" calls (fetchBrief, listBriefSummaries, listQuestions) never throw — a degraded AI
 *    service must not break the JD pages; they resolve to null.
 *  - everything else throws UpstreamError (UpstreamHttpError carries the status for 404/422/429).
 */
export class AiServiceClient {
  constructor(
    private readonly baseUrl: string,
    private readonly internalApiKey: string,
    private readonly fetchImpl: FetchLike,
    private readonly log: Logger,
    private readonly timeoutMs = 120_000,
  ) {}

  // --- briefs --------------------------------------------------------------------------------

  /** Full brief for one JD (company+role+level+specialization); null when absent or on failure. */
  async fetchBrief(company: string, role: string, level: string, specialization: string | null, options?: { timeoutMs?: number; strict?: boolean }): Promise<unknown | null> {
    try {
      return await this.getJson(`/briefs/${seg(company)}/${seg(role)}/${seg(level)}/${seg(specialization)}`, options?.timeoutMs);
    } catch (err) {
      if (isUpstreamStatus(err, 404)) return null;
      if (options?.strict) throw err;
      if (err instanceof UpstreamError) {
        this.log.warn({ err: err.message }, `AI service brief fetch failed for ${company}/${role}/${level}/${specialization}`);
        return null;
      }
      throw err;
    }
  }

  /** Status summary of all briefs `{briefs: [...]}`; null on failure. */
  async listBriefSummaries(): Promise<unknown | null> {
    try {
      return await this.getJson("/briefs");
    } catch (err) {
      if (err instanceof UpstreamError) {
        this.log.warn({ err: err.message }, "AI service brief summaries fetch failed");
        return null;
      }
      throw err;
    }
  }

  clearBriefs(): Promise<unknown> {
    return this.postJson("/admin/briefs/clear");
  }

  // --- ingestion / question bank -------------------------------------------------------------

  triggerScrape(): Promise<unknown> {
    return this.postJson("/admin/scrape/run");
  }

  stopScrape(): Promise<unknown> {
    return this.postJson("/admin/scrape/stop");
  }

  getScrapeStatus(after: number): Promise<unknown> {
    return this.getJson(`/admin/scrape/status?after=${after}`);
  }

  collectQuestions(): Promise<unknown> {
    return this.postJson("/admin/questions/collect");
  }

  /** Start content generation over the question index (docs/question-bank.md); shares the run slot. */
  generateQuestionContent(opts: { roundType?: string | null; limit?: number | null; force?: boolean } = {}): Promise<unknown> {
    const q = new URLSearchParams();
    if (opts.roundType && opts.roundType.trim()) q.set("round_type", opts.roundType);
    if (opts.limit && opts.limit > 0) q.set("limit", String(opts.limit));
    if (opts.force) q.set("force", "true");
    const qs = q.toString();
    return this.postJson(`/admin/questions/generate${qs ? `?${qs}` : ""}`);
  }

  /** Counts per round type and content status; null on failure. */
  async questionStats(): Promise<unknown | null> {
    try {
      return await this.getJson("/questions/stats");
    } catch (err) {
      if (err instanceof UpstreamError) {
        this.log.warn({ err: err.message }, "AI service question stats fetch failed");
        return null;
      }
      throw err;
    }
  }

  /** Ingested question-bank metadata for the admin console; null on failure. */
  async listQuestions(roundType: string | null, company: string | null, difficulty: string | null, limit: number,
    extra: { contentStatus?: string | null; topic?: string | null; includeContent?: boolean } = {}): Promise<unknown | null> {
    const q = new URLSearchParams({ limit: String(limit) });
    if (roundType && roundType.trim()) q.set("round_type", roundType);
    if (company && company.trim()) q.set("company", company);
    if (difficulty && difficulty.trim()) q.set("difficulty", difficulty);
    if (extra.contentStatus && extra.contentStatus.trim()) q.set("content_status", extra.contentStatus);
    if (extra.topic && extra.topic.trim()) q.set("topic", extra.topic);
    if (extra.includeContent) q.set("include_content", "true");
    try {
      return await this.getJson(`/questions?${q.toString()}`);
    } catch (err) {
      if (err instanceof UpstreamError) {
        this.log.warn({ err: err.message }, "AI service question list failed");
        return null;
      }
      throw err;
    }
  }

  /** First-party (paste-in) interview experience. */
  submitExperience(company: string, role: string, level: string, rawContent: string): Promise<unknown> {
    return this.postJson("/admin/experiences", { company, role, level, raw_content: rawContent });
  }

  // --- resume parsing ------------------------------------------------------------------------

  /** Private synchronous LinkedIn "Save to PDF" extraction (raw PDF bytes in); no observable run payloads. */
  async parseLinkedInPdf(pdf: Uint8Array): Promise<unknown> {
    const body = await this.send({ method: "POST", url: this.url("/linkedin/parse"), body: pdf, headers: { "Content-Type": "application/pdf" } });
    return this.nonEmptyJson(body, "/linkedin/parse");
  }

  /**
   * Synchronous resume parse (raw PDF bytes in, snake_case JSON text out). Does NOT swallow
   * failures — a 422 (scanned/image-only PDF) must reach the user so they can enter details manually.
   */
  async parseResume(pdf: Uint8Array): Promise<string> {
    const body = await this.send({ method: "POST", url: this.url("/resumes/parse"), body: pdf, headers: { "Content-Type": "application/pdf" } });
    if (body.trim() === "") throw new UpstreamMalformedError("ai-service /resumes/parse returned an empty body");
    return body;
  }

  /** Start a background (observable) resume-parse run → `{run_id, status}`. */
  async startResumeParseRun(pdf: Uint8Array, filename: string): Promise<unknown> {
    return this.nonEmptyJson(
      await this.send({
        method: "POST",
        url: this.url(`/admin/resume/parse/run?filename=${encodeURIComponent(filename)}`),
        body: pdf,
        headers: { "Content-Type": "application/pdf" },
      }),
      "/admin/resume/parse/run",
    );
  }

  getResumeParseRun(runId: string, after: number): Promise<unknown> {
    return this.getJson(`/admin/resume/parse/runs/${seg(runId)}?after=${after}`);
  }

  listResumeParseRuns(): Promise<unknown> {
    return this.getJson("/admin/resume/parse/runs");
  }

  // --- profile scoring -----------------------------------------------------------------------

  /** Bounded feature inferences only. Deterministic profile aggregation stays with the caller. */
  async assessProfileScoring(request: ProfileScoringAssessmentRequest): Promise<ProfileScoringAssessmentResponse> {
    const minimized = parseProfileScoringAssessmentRequest(request);
    let body: unknown;
    try {
      body = await this.postJson("/profile-scoring/assess", minimized);
    } catch (err) {
      // The shared transport retains upstream text/causes for other consumers. This private
      // evidence boundary must never expose reflected input, keys, or provider errors to logs.
      if (err instanceof UpstreamHttpError) {
        throw new UpstreamHttpError(err.status, "", `ai-service /profile-scoring/assess failed (HTTP ${err.status})`);
      }
      if (err instanceof UpstreamMalformedError) {
        throw new UpstreamMalformedError("ai-service /profile-scoring/assess returned invalid JSON");
      }
      throw new UpstreamTransportError("ai-service /profile-scoring/assess unavailable");
    }
    return parseProfileScoringAssessmentResponse(body, minimized);
  }

  /** General-knowledge company context for the scoring knowledge base. Only a company name is sent. */
  async companyContext(companyName: string): Promise<CompanyContextResponse> {
    const request = companyContextRequestSchema.parse({ companyName });
    let body: unknown;
    try {
      body = await this.postJson("/profile-scoring/company-context", request);
    } catch (err) {
      if (err instanceof UpstreamHttpError) throw new UpstreamHttpError(err.status, "", `ai-service /profile-scoring/company-context failed (HTTP ${err.status})`);
      if (err instanceof UpstreamMalformedError) throw new UpstreamMalformedError("ai-service /profile-scoring/company-context returned invalid JSON");
      throw new UpstreamTransportError("ai-service /profile-scoring/company-context unavailable");
    }
    return parseCompanyContextResponse(body);
  }

  // --- interview blueprint (docs/superpowers/specs/2026-10-07-interview-blueprint-design.md) ---

  /** Start a session's blueprint run → `{run_id, status, existing}` (the live run when one is already running). */
  async startBlueprintRun(request: BlueprintRunRequest): Promise<{ runId: string; existing: boolean }> {
    const snap = this.nonEmptyJson(await this.send(this.jsonPost("/blueprints/runs", request)), "/blueprints/runs");
    const runId = asString(path(snap, "run_id"), "");
    if (runId.trim() === "") throw new UpstreamMalformedError("ai-service /blueprints/runs returned no run_id");
    return { runId, existing: path(snap, "existing") === true };
  }

  /** Compact run status `{status, stage, steps, error, blueprint_version, briefing, input_hash, ...}`. 404 → UpstreamHttpError. */
  async getBlueprintRun(runId: string): Promise<unknown> {
    return this.nonEmptyJson(await this.send({ method: "GET", url: this.url(`/blueprints/runs/${seg(runId)}`) }), "/blueprints/runs");
  }

  cancelBlueprintRun(runId: string): Promise<unknown> {
    return this.postJson(`/blueprints/runs/${seg(runId)}/cancel`);
  }

  /** A session's blueprint (the current one, or `version`). The live interviewer's source; never sent to a browser. */
  getSessionBlueprint(sessionId: string, version?: number): Promise<unknown> {
    return this.getJson(`/blueprints/sessions/${seg(sessionId)}${version ? `?version=${version}` : ""}`);
  }

  // Admin diagnostics: snake_case passthrough for the Intelligence "Interview prep" tab.

  listBlueprintRuns(query: URLSearchParams): Promise<unknown> {
    return this.getJson(`/admin/blueprints/runs?${query.toString()}`);
  }

  getBlueprintRunDetail(runId: string): Promise<unknown> {
    return this.getJson(`/admin/blueprints/runs/${seg(runId)}`);
  }

  async startBlueprintBench(request: BlueprintRunRequest): Promise<unknown> {
    return this.nonEmptyJson(await this.send(this.jsonPost("/admin/blueprints/bench", request)), "/admin/blueprints/bench");
  }

  rerunBlueprint(runId: string, body: unknown): Promise<unknown> {
    return this.postJson(`/admin/blueprints/runs/${seg(runId)}/rerun`, body);
  }

  blueprintVersions(sessionId: string): Promise<unknown> {
    return this.getJson(`/admin/blueprints/sessions/${seg(sessionId)}/versions`);
  }

  blueprintDiff(sessionId: string, from: number, to: number): Promise<unknown> {
    return this.getJson(`/admin/blueprints/sessions/${seg(sessionId)}/diff?from=${from}&to=${to}`);
  }

  blueprintAnswerKeys(roundType: string, slug: string): Promise<unknown> {
    return this.getJson(`/admin/blueprints/answer-keys/${seg(roundType)}/${slug.split("/").map(seg).join("/")}`);
  }

  // --- company research (Phase 1) -------------------------------------------------------------

  /** Research state per company `{states: [...]}`; null when the AI service is unreachable (lookup: never throws). */
  async companyResearchStates(ids: string[]): Promise<unknown | null> {
    try {
      return await this.getJson(`/research/companies/state?ids=${ids.map(encodeURIComponent).join(",")}`);
    } catch (err) {
      if (err instanceof UpstreamError) {
        this.log.warn({ err: err.message }, "AI service research-state lookup failed");
        return null;
      }
      throw err;
    }
  }

  startResearchRun(body: unknown): Promise<unknown> {
    return this.postJson("/research/runs", body);
  }

  listResearchRuns(limit: number): Promise<unknown> {
    return this.getJson(`/research/runs?limit=${limit}`);
  }

  getResearchRun(runId: string): Promise<unknown> {
    return this.getJson(`/research/runs/${seg(runId)}`);
  }

  controlResearchRun(runId: string, action: "pause" | "resume" | "stop"): Promise<unknown> {
    return this.postJson(`/research/runs/${seg(runId)}/${action}`);
  }

  async patchResearchBudget(runId: string, body: unknown): Promise<unknown> {
    const path = `/research/runs/${seg(runId)}/budget`;
    return this.nonEmptyJson(
      await this.send({ method: "PATCH", url: this.url(path), body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
      path,
    );
  }

  listResearchEvents(runId: string, query: URLSearchParams): Promise<unknown> {
    const qs = query.toString();
    return this.getJson(`/research/runs/${seg(runId)}/events${qs ? `?${qs}` : ""}`);
  }

  listResearchSpans(runId: string, companyId: string | null): Promise<unknown> {
    return this.getJson(`/research/runs/${seg(runId)}/spans${companyId ? `?company_id=${encodeURIComponent(companyId)}` : ""}`);
  }

  getResearchSpan(spanId: string): Promise<unknown> {
    return this.getJson(`/research/spans/${seg(spanId)}`);
  }

  /** Newest research draft for a company. 404 `draft_not_found` → UpstreamHttpError. */
  getCompanyDraft(companyId: string, options?: { timeoutMs?: number }): Promise<unknown> {
    return this.getJson(`/research/companies/${seg(companyId)}/draft`, options?.timeoutMs);
  }

  /** pending_review → approved|rejected. 409 `draft_not_pending` → UpstreamHttpError. */
  decideCompanyDraft(draftId: string, body: { decision: "approve" | "reject"; note: string | null; decided_by: string | null }): Promise<unknown> {
    return this.postJson(`/research/drafts/${seg(draftId)}/decision`, body);
  }

  // --- account deletion ----------------------------------------------------------------------

  /** Drop the user's blueprints and blueprint runs (bench runs included). Throws UpstreamError. */
  async purgeUser(candidateId: string, sessionIds: string[]): Promise<number> {
    const body = await this.postJson("/users/purge", { candidate_id: candidateId, session_ids: sessionIds });
    const count = (k: string) => (isObject(body) && typeof body[k] === "number" ? (body[k] as number) : 0);
    return count("deleted_blueprints") + count("deleted_runs");
  }

  // --- transport -----------------------------------------------------------------------------

  private url(pathAndQuery: string): string {
    return `${this.baseUrl}${pathAndQuery}`;
  }

  private send(req: OutboundRequest): Promise<string> {
    return requestText(this.fetchImpl, {
      ...req,
      timeoutMs: req.timeoutMs ?? this.timeoutMs,
      headers: { Accept: "application/json", "X-Internal-Api-Key": this.internalApiKey, ...req.headers },
    });
  }

  private jsonPost(pathAndQuery: string, body?: unknown): OutboundRequest {
    return body === undefined
      ? { method: "POST", url: this.url(pathAndQuery) }
      : { method: "POST", url: this.url(pathAndQuery), body: JSON.stringify(body), headers: { "Content-Type": "application/json" } };
  }

  private async getJson(pathAndQuery: string, timeoutMs?: number): Promise<unknown> {
    return parseJsonBody(await this.send({ method: "GET", url: this.url(pathAndQuery), timeoutMs }), pathAndQuery.split("?")[0]!);
  }

  private async postJson(pathAndQuery: string, body?: unknown): Promise<unknown> {
    return parseJsonBody(await this.send(this.jsonPost(pathAndQuery, body)), pathAndQuery.split("?")[0]!);
  }

  private nonEmptyJson(text: string, what: string): unknown {
    if (text.trim() === "") throw new UpstreamMalformedError(`ai-service ${what} returned an empty body`);
    return parseJsonBody(text, what);
  }
}

/** Path segment, URI-encoded like Spring's URI templates did (a null value expands to ""). */
function seg(v: string | null): string {
  return encodeURIComponent(v ?? "");
}
