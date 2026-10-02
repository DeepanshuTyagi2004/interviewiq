import type { Logger } from "../../lib/logger.js";
import {
  type FetchLike,
  isUpstreamStatus,
  type OutboundRequest,
  parseJsonBody,
  requestText,
  UpstreamError,
  UpstreamMalformedError,
} from "../../lib/http.js";
import { asString, isObject, path } from "../../lib/json.js";
import type { GenerateInterviewPlanRequest } from "./types.js";

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
  async fetchBrief(company: string, role: string, level: string, specialization: string | null): Promise<unknown | null> {
    try {
      return await this.getJson(`/briefs/${seg(company)}/${seg(role)}/${seg(level)}/${seg(specialization)}`);
    } catch (err) {
      if (isUpstreamStatus(err, 404)) return null;
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

  /** Ingested question-bank metadata for the admin console; null on failure. */
  async listQuestions(roundType: string | null, company: string | null, difficulty: string | null, limit: number): Promise<unknown | null> {
    const q = new URLSearchParams({ limit: String(limit) });
    if (roundType && roundType.trim()) q.set("round_type", roundType);
    if (company && company.trim()) q.set("company", company);
    if (difficulty && difficulty.trim()) q.set("difficulty", difficulty);
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

  // --- interview prep (Pipeline 1) -----------------------------------------------------------

  /**
   * Fire-and-poll plan generation: start a run and return its run_id immediately; the caller polls
   * getInterviewPlanRun. Keeps every HTTP call short so a slow multi-LLM run can't trip a read timeout.
   */
  async startInterviewPlan(request: GenerateInterviewPlanRequest): Promise<string> {
    const snap = this.nonEmptyJson(await this.send(this.jsonPost("/interview-plans/start", request)), "/interview-plans/start");
    const runId = asString(path(snap, "run_id"), "");
    if (runId.trim() === "") throw new UpstreamMalformedError("ai-service /interview-plans/start returned no run_id");
    return runId;
  }

  /** Run snapshot `{run_id, status: running|completed|failed, plan, error}`. 404 → UpstreamHttpError. */
  async getInterviewPlanRun(runId: string): Promise<unknown> {
    return this.nonEmptyJson(await this.send({ method: "GET", url: this.url(`/interview-plans/runs/${seg(runId)}`) }), "/interview-plans/runs");
  }

  /** Instrumented admin-bench prep run (cache bypassed, plan not persisted) → `{run_id, status}`. */
  async startInterviewPrepRun(request: GenerateInterviewPlanRequest): Promise<unknown> {
    return this.nonEmptyJson(await this.send(this.jsonPost("/admin/interview-prep/run", request)), "/admin/interview-prep/run");
  }

  getInterviewPrepRun(runId: string, after: number): Promise<unknown> {
    return this.getJson(`/admin/interview-prep/runs/${seg(runId)}?after=${after}`);
  }

  listInterviewPrepRuns(): Promise<unknown> {
    return this.getJson("/admin/interview-prep/runs");
  }

  // --- agent diagnostics (interactive brain harness) -----------------------------------------

  async startAgentRun(plan: unknown): Promise<unknown> {
    return this.nonEmptyJson(await this.send(this.jsonPost("/admin/interview-agent/run", plan)), "/admin/interview-agent/run");
  }

  submitAgentTurn(runId: string, turn: unknown): Promise<unknown> {
    return this.postJson(`/admin/interview-agent/runs/${seg(runId)}/turn`, turn);
  }

  getAgentRun(runId: string, after: number): Promise<unknown> {
    return this.getJson(`/admin/interview-agent/runs/${seg(runId)}?after=${after}`);
  }

  listAgentRuns(): Promise<unknown> {
    return this.getJson("/admin/interview-agent/runs");
  }

  endAgentRun(runId: string): Promise<unknown> {
    return this.postJson(`/admin/interview-agent/runs/${seg(runId)}/end`);
  }

  // --- account deletion ----------------------------------------------------------------------

  /** Drop everything the AI service stores for these sessions (their interview plans). Throws UpstreamError. */
  async purgeUser(sessionIds: string[]): Promise<number> {
    const body = await this.postJson("/users/purge", { session_ids: sessionIds });
    const deleted = isObject(body) ? body.deleted_plans : undefined;
    return typeof deleted === "number" ? deleted : 0;
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

  private async getJson(pathAndQuery: string): Promise<unknown> {
    return parseJsonBody(await this.send({ method: "GET", url: this.url(pathAndQuery) }), pathAndQuery.split("?")[0]!);
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
