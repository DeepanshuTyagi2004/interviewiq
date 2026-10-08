import type { CompanyRow, JobDescriptionRow } from "../db/pg/schema.js";
import { normalizeLegacyLevel, type EngineeringLevel } from "../domain/engineeringLevels.js";
import type { EnrichmentBrief } from "../domain/enrichment.js";
import { JD_FIT_CONFIG, type JdFitConfig } from "../domain/jdFit/config.js";
import { scoreJdFit } from "../domain/jdFit/engine.js";
import { buildFitProfile } from "../domain/jdFit/profile.js";
import type { FitJd, FitProfile, FitResult, FitRound, LevelGap } from "../domain/jdFit/types.js";
import { effectiveDeclaredLevel } from "../domain/profileScoring/adapters.js";
import type { CandidateProfileRepository, ProfileFragmentRepository } from "../repositories/mongo.js";
import type { CompanyRepository, JobDescriptionRepository } from "../repositories/pg.js";
import { briefRounds, isHiddenCompany, jdDetailVisible, resolveJdBrief, splitCsv, visibleJds, type JdBriefDeps, type JdListFilters } from "./jdCatalogue.js";

interface Deps {
  jds: Pick<JobDescriptionRepository, "findAllActiveOrdered" | "findActiveByCompany" | "findById">;
  companies: Pick<CompanyRepository, "findAll" | "findBySlug">;
  profiles: Pick<CandidateProfileRepository, "findByUserId">;
  fragments: Pick<ProfileFragmentRepository, "findByUserId">;
  /** The old settings level, used only when the profile has never stored one (same rule as profile scoring). */
  declaredLevel: (userId: string) => Promise<EngineeringLevel | null>;
  enrichment: JdBriefDeps["enrichment"] & { briefsByJd(): Promise<Map<string, EnrichmentBrief>>; briefsByJdIds(jdIds: string[]): Promise<Map<string, EnrichmentBrief>> };
  aiService: JdBriefDeps["aiService"];
  config?: JdFitConfig;
  now?: () => Date;
  /** Parallel AI-service brief reads for one list. */
  briefConcurrency?: number;
  /** Per AI-service brief read in a list; a slow brief only drops that JD's round topics. */
  briefTimeoutMs?: number;
}

export interface JdFitList {
  configVersion: string;
  userLevel: EngineeringLevel | null;
  results: { jdId: string; score: number | null; levelGap: LevelGap; cap: number | null; levelFactor: number | null }[];
}

/**
 * JD fit on request (`docs/jd-fit.md`): load the user's sources once, then score every visible JD.
 * Nothing is stored, so the score always reflects the current profile.
 */
export class JdFitService {
  private readonly config: JdFitConfig;
  private readonly now: () => Date;

  constructor(private readonly d: Deps) {
    this.config = d.config ?? JD_FIT_CONFIG;
    this.now = d.now ?? (() => new Date());
  }

  /** Scores for the role cards, for exactly the JDs `GET /jds` lists with the same filters. */
  async list(userId: string, filters: JdListFilters): Promise<JdFitList> {
    const { profile, results } = await this.scoreAll(userId, filters);
    return { configVersion: this.config.version, userLevel: profile.level, results: results.map((r) => ({ jdId: r.jdId, score: r.score, levelGap: r.levelGap, cap: r.cap, levelFactor: r.levelFactor })) };
  }

  /** Every listed JD's full breakdown (admin tooling and audits); `list` is this without the parts. */
  async all(userId: string, filters: JdListFilters): Promise<FitResult[]> {
    return (await this.scoreAll(userId, filters)).results;
  }

  private async scoreAll(userId: string, filters: JdListFilters): Promise<{ profile: FitProfile; results: FitResult[] }> {
    const [companies, jds] = await Promise.all([
      this.d.companies.findAll(), filters.company === null ? this.d.jds.findAllActiveOrdered() : this.d.jds.findActiveByCompany(filters.company),
    ]);
    const visible = visibleJds(companies, jds, filters);
    // The briefs of the listed JDs only: the whole catalogue's is megabytes per request.
    const [profile, manual] = await Promise.all([
      this.profile(userId, companies), filters.company === null ? this.d.enrichment.briefsByJd() : this.d.enrichment.briefsByJdIds(visible.map((j) => j.id)),
    ]);
    const sectors = sectorBySlug(companies);
    const rounds = await mapLimit(visible, this.d.briefConcurrency ?? 6, (j) => this.listRounds(j, manual.get(j.id) ?? null));
    return { profile, results: visible.map((j, i) => scoreJdFit(profile, fitJd(j, sectors.get(j.company) ?? null, rounds[i]!), this.config)) };
  }

  /** The full breakdown for one JD, or null when `GET /jds/{id}` would 404. */
  async one(userId: string, jdId: string): Promise<FitResult | null> {
    const j = await this.d.jds.findById(jdId);
    const company = j ? await this.d.companies.findBySlug(j.company) : null;
    if (!jdDetailVisible(j, company)) return null;
    const [profile, { brief }] = await Promise.all([this.d.companies.findAll().then((all) => this.profile(userId, all)), resolveJdBrief(this.d, j)]);
    return scoreJdFit(profile, fitJd(j, company?.sector ?? null, briefRounds(brief)), this.config);
  }

  private async profile(userId: string, companies: CompanyRow[]): Promise<FitProfile> {
    const [doc, fragments, fallback] = await Promise.all([this.d.profiles.findByUserId(userId), this.d.fragments.findByUserId(userId), this.d.declaredLevel(userId)]);
    // Only companies students can see lend their sector to an employer.
    const catalogue = companies.filter((co) => !isHiddenCompany(co)).map((co) => ({ name: co.name, slug: co.slug, aliases: co.aliases, sector: co.sector }));
    return buildFitProfile({ profile: doc, fragments, level: effectiveDeclaredLevel(doc, fallback), asOf: this.now().toISOString(), catalogue }, this.config);
  }

  /** Same precedence as `resolveJdBrief`, with the published briefs already read in bulk. */
  private async listRounds(j: JobDescriptionRow, manual: EnrichmentBrief | null): Promise<FitRound[]> {
    if (manual) return briefRounds(manual);
    if (j.source === "template") return [];
    return briefRounds(await this.d.aiService.fetchBrief(j.company, j.role, j.level, j.specialization, { timeoutMs: this.d.briefTimeoutMs ?? 3000 }));
  }
}

function sectorBySlug(companies: CompanyRow[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const co of companies) if (!out.has(co.slug)) out.set(co.slug, co.sector);
  return out;
}

function fitJd(j: JobDescriptionRow, sector: string | null, rounds: FitRound[]): FitJd {
  return {
    id: j.id,
    level: normalizeLegacyLevel(j.level),
    sector,
    specialization: j.specialization,
    text: [j.title, j.description].filter(Boolean).join(" | ").toLowerCase(),
    techStack: splitCsv(j.techStack),
    yoeMin: j.yoeMin === null ? null : Number(j.yoeMin),
    yoeMax: j.yoeMax === null ? null : Number(j.yoeMax),
    rounds,
  };
}

async function mapLimit<T, R>(values: T[], limit: number, fn: (value: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(values.length);
  let next = 0;
  const worker = async () => {
    while (next < values.length) {
      const i = next++;
      out[i] = await fn(values[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(limit, 1), values.length) }, worker));
  return out;
}
