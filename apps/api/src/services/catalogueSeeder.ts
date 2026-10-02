import type { Logger } from "../lib/logger.js";
import type { CompanyRepository, CompanyRoleConfigRepository, JobDescriptionRepository } from "../repositories/pg.js";

const ROLE = "software-engineer";
const COMPANY = "meesho";
const CAREERS = "https://www.meesho.io/jobs";

const COMPANIES = [{ name: "Meesho", slug: "meesho", tier: 2, hq: "Bengaluru, India", size: "1,500+" }];

/** One brief-generation combo per level (process is level-driven, shared by the level's JDs). */
const SEEDS = [
  {
    company: "meesho",
    level: "fresher",
    title: "Software Development Engineer (SDE I)",
    url: "https://www.meesho.io/jobs",
    description:
      "SDE I at Meesho: build and scale the systems behind India's largest e-commerce platform for the next billion users, owning features with mentorship in a high-scale, mobile-first environment.",
    requirements:
      "0-2 years experience. Strong data structures and algorithms. Proficiency in a programming language (Java, Python, Kotlin, Go, or JavaScript). Eagerness to work on high-scale consumer systems.",
    responsibilities:
      "Build and ship features across services and apps; write tested, observable code; participate in design and code reviews; learn to operate systems at scale.",
    techStack: "Java,Python,SQL,Microservices,Data Structures,System Design",
    roundCount: 4,
  },
];

/**
 * Three deliberately distinct fresher JDs — backend, data engineering, android — so the level-wise
 * browse + specialization filter offers real variety.
 */
const JD_SEEDS = [
  {
    level: "fresher",
    specialization: "backend",
    title: "SDE I — Backend",
    description:
      "Build and scale backend services and APIs that power India's largest e-commerce platform for the next billion users, with mentorship at high scale. 0-2 years; strong DSA and a backend language.",
    techStack: "Java,Go,Spring Boot,SQL,Microservices,Data Structures",
  },
  {
    level: "fresher",
    specialization: "data-engineering",
    title: "Data Engineer I",
    description:
      "Build data pipelines and analytics infrastructure that turn billions of commerce events into insights and ML features for the next billion users. 0-2 years; strong SQL, Python, and DSA.",
    techStack: "Python,SQL,Spark,Airflow,Data Modeling,ETL",
  },
  {
    level: "fresher",
    specialization: "android",
    title: "SDE I — Android",
    description:
      "Build the Meesho consumer app used by hundreds of millions across India; Kotlin/Android with a relentless focus on performance on low-end devices. 0-2 years; strong DSA and mobile fundamentals.",
    techStack: "Kotlin,Android,Java,REST,Jetpack,Data Structures",
  },
];

export interface SeedResult {
  companies: number;
  inserted: number;
  backfilled: number;
  total: number;
}

/**
 * Loads the starter catalogue ON DEMAND (admin "Load starter companies"), never on startup.
 * Upsert-only: re-running refreshes Meesho's seed JDs and backfills missing role-config fields; it
 * never deletes other companies (admin- and research-added companies live alongside the seed).
 */
export class CatalogueSeeder {
  constructor(
    private readonly roleConfigs: CompanyRoleConfigRepository,
    private readonly companies: CompanyRepository,
    private readonly jds: JobDescriptionRepository,
    private readonly log: Logger,
  ) {}

  async seed(): Promise<SeedResult> {
    let companiesSeeded = 0;
    for (const cs of COMPANIES) {
      if (!(await this.companies.findBySlug(cs.slug))) {
        await this.companies.insert({
          name: cs.name, slug: cs.slug, tier: cs.tier, logoUrl: null, headquarterLocation: cs.hq,
          companySize: cs.size, origin: "seed", publishedAt: new Date(),
        });
        companiesSeeded++;
      }
    }

    let inserted = 0;
    let backfilled = 0;
    for (const s of SEEDS) {
      const row = await this.roleConfigs.findByCompanyAndRoleAndLevel(s.company, ROLE, s.level);
      if (row) {
        // Backfill only missing fields; never overwrite admin edits.
        const patch: Parameters<CompanyRoleConfigRepository["update"]>[1] = {};
        if (row.title === null) patch.title = s.title;
        if (row.jdUrl === null) patch.jdUrl = s.url;
        if (row.jdDescription === null) patch.jdDescription = s.description;
        if (row.requirements === null) patch.requirements = s.requirements;
        if (row.responsibilities === null) patch.responsibilities = s.responsibilities;
        if (row.techStack === null) patch.techStack = s.techStack;
        if (row.roundCount === null) patch.roundCount = s.roundCount;
        if (!row.enabled) patch.enabled = true;
        if (Object.keys(patch).length > 0) {
          await this.roleConfigs.update(row.id, patch);
          backfilled++;
        }
      } else {
        await this.roleConfigs.insert({
          company: s.company,
          role: ROLE,
          level: s.level,
          title: s.title,
          jdUrl: s.url,
          jdDescription: s.description,
          requirements: s.requirements,
          responsibilities: s.responsibilities,
          techStack: s.techStack,
          roundCount: s.roundCount,
          enabled: true,
        });
        inserted++;
      }
    }

    // Replace ALL of the company's JDs so re-running is a clean idempotent refresh.
    await this.jds.deleteByCompany(COMPANY);
    for (const j of JD_SEEDS) {
      await this.jds.insert({
        company: COMPANY,
        role: ROLE,
        level: j.level,
        title: j.title,
        specialization: j.specialization,
        description: j.description,
        techStack: j.techStack,
        sourceUrl: CAREERS,
        source: "seed",
        active: true,
      });
    }

    this.log.info(
      `Catalogue seed: ${companiesSeeded} companies, ${inserted} combos inserted, ${backfilled} backfilled, ` +
        `${JD_SEEDS.length} role-based JDs (across ${SEEDS.length} brief combos)`,
    );
    return { companies: companiesSeeded, inserted, backfilled, total: JD_SEEDS.length };
  }
}
