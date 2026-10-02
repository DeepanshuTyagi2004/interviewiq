import type { Router } from "express";
import type { Container } from "../container.js";
import type { CompanyRow } from "../db/pg/schema.js";
import { isBlank, isObject, items, path, textOrNull, asString } from "../lib/json.js";
import { UpstreamError } from "../lib/http.js";
import { queryString, routerErrors, sendError, uuidParam, router } from "../http/support.js";
import { str } from "../domain/candidateProfile.js";

/** Supported companies for the JD library. */
export function companiesRouter(c: Container): Router {
  const r = router();
  r.get("/", async (_req, res) => {
    const rows = await c.repos.companies.findPublished();
    res.json(
      rows.map((co) => ({
        id: co.id,
        name: co.name,
        slug: co.slug,
        tier: co.tier,
        logoUrl: co.logoUrl,
        headquarterLocation: co.headquarterLocation,
        companySize: co.companySize,
      })),
    );
  });
  return r;
}

/** A company students must not see: its row exists and is unpublished or archived. */
const isHidden = (co: CompanyRow) => co.publishedAt === null || co.status === "archived";
const hiddenSlugs = (rows: CompanyRow[]) => new Set(rows.filter(isHidden).map((co) => co.slug));

/**
 * Student-facing JD library. Lists the postings (shown level-wise); the detail embeds the interview
 * process from the AI-service brief keyed per JD by (company, role, level, specialization).
 */
export function jdsRouter(c: Container): Router {
  const r = router();

  r.get("/", async (req, res) => {
    const company = queryString(req, "company");
    const level = queryString(req, "level");
    const specialization = queryString(req, "specialization");
    const [companies, jds, summaries] = await Promise.all([
      c.repos.companies.findAll(),
      c.repos.jds.findAllActiveOrdered(),
      c.aiService.listBriefSummaries(),
    ]);
    const names = new Map<string, string>();
    for (const co of companies) if (!names.has(co.slug)) names.set(co.slug, co.name);
    const hidden = hiddenSlugs(companies);
    const confidence = confidenceByKey(summaries);

    res.json(
      jds
        .filter((j) => !hidden.has(j.company))
        .filter((j) => company === null || eqIgnoreCase(company, j.company))
        .filter((j) => level === null || eqIgnoreCase(level, j.level))
        .filter((j) => specialization === null || eqIgnoreCase(specialization, j.specialization))
        .map((j) => {
          const conf = confidence.get(key(j.company, j.role, j.level, j.specialization)) ?? null;
          return {
            id: j.id,
            company: j.company,
            companyName: names.get(j.company) ?? j.company,
            role: j.role,
            level: j.level,
            title: j.title,
            specialization: j.specialization,
            dataConfidence: conf,
            dataAvailability: availability(conf),
          };
        }),
    );
  });

  r.get("/:id", async (req, res) => {
    const j = await c.repos.jds.findById(uuidParam(req, "id"));
    const company = j ? await c.repos.companies.findBySlug(j.company) : null;
    if (!j || (company !== null && isHidden(company))) {
      sendError(res, 404, "jd_not_found", "no JD with that id");
      return;
    }
    const brief = await c.aiService.fetchBrief(j.company, j.role, j.level, j.specialization);
    let interviewProcess: unknown = null;
    let conf: string | null = null;
    let sources: string[] = [];
    if (brief !== null) {
      interviewProcess = interviewProcessOf(brief);
      conf = textOrNull(path(brief, "data_confidence"));
      sources = items(path(brief, "sources")).map((s) => asString(s, ""));
    }
    res.json({
      id: j.id,
      company: j.company,
      companyName: company?.name ?? j.company,
      role: j.role,
      level: j.level,
      title: j.title,
      specialization: j.specialization,
      description: j.description,
      techStack: splitCsv(j.techStack),
      sourceUrl: j.sourceUrl,
      dataConfidence: conf,
      dataAvailability: availability(conf),
      interviewProcess,
      sources,
    });
  });

  return r;
}

/** Candidate-facing fields of the pipeline's `final_experience`. An allow-list, so internal
 *  diagnostics (`source_funnel`, `aggregate_thought` — model reasoning) and any future internals
 *  never reach candidates. */
const PUBLIC_PROCESS_FIELDS = [
  "rounds",
  "dominant_topics",
  "difficulty_calibration",
  "interviewer_style_notes",
  "red_flags",
  "company_specific_patterns",
  "data_confidence",
  "template_used",
] as const;

/**
 * The brief's round-by-round process for the JD page. Current briefs store it as
 * `final_experience`; older ones as `consolidated_process`, which is passed through unchanged.
 */
function interviewProcessOf(brief: unknown): unknown {
  const current = path(brief, "final_experience");
  if (isObject(current)) {
    return Object.fromEntries(PUBLIC_PROCESS_FIELDS.filter((k) => k in current).map((k) => [k, current[k]]));
  }
  return path(brief, "consolidated_process") ?? null;
}

/**
 * First-party interview-experience submission — any signed-in candidate can share theirs. It is
 * forwarded to the AI service and flows through the same extraction → brief pipeline.
 */
export function experiencesRouter(c: Container): Router {
  const r = router();
  r.post("/", async (req, res) => {
    const b = isObject(req.body) ? req.body : null;
    const company = str(b?.company);
    const level = str(b?.level);
    const content = str(b?.content);
    if (b === null || isBlank(company) || isBlank(level) || isBlank(content)) {
      sendError(res, 400, "invalid_experience", "company, level and content are required");
      return;
    }
    const role = isBlank(str(b.role)) ? "software-engineer" : str(b.role)!;
    res.status(202).json(await c.aiService.submitExperience(company, role, level, content));
  });
  r.use(aiServiceUnreachable(c, "AI service submit failed"));
  return r;
}

/** Shared mapping for the AI-service BFF proxies: any upstream failure → 502. */
export function aiServiceUnreachable(c: Container, logPrefix: string, message = "the intelligence service is not reachable") {
  return routerErrors((err) => {
    if (err instanceof UpstreamError) {
      c.log.warn(`${logPrefix}: ${err.message}`);
      return { status: 502, code: "ai_service_unreachable", message };
    }
    return undefined;
  });
}

// --- helpers -------------------------------------------------------------------------------------

/** Brief key. A null specialization becomes "null" — the same key the Spring code produced. */
function key(company: string, role: string, level: string, specialization: string | null): string {
  return `${company}|${role}|${level}|${specialization}`;
}

function confidenceByKey(summaries: unknown): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const b of items(path(summaries, "briefs"))) {
    map.set(
      key(asString(path(b, "company"), ""), asString(path(b, "role"), ""), asString(path(b, "level"), ""), asString(path(b, "specialization"), "")),
      textOrNull(path(b, "data_confidence")),
    );
  }
  return map;
}

/** rich / available / limited / none, from the brief's data_confidence. */
function availability(confidence: string | null): string {
  switch (confidence) {
    case "high":
      return "rich";
    case "medium":
      return "available";
    case "low":
      return "limited";
    default:
      return "none";
  }
}

function splitCsv(csv: string | null): string[] {
  if (csv === null || csv.trim() === "") return [];
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

function eqIgnoreCase(a: string, b: string | null): boolean {
  return b !== null && a.toLowerCase() === b.toLowerCase();
}
