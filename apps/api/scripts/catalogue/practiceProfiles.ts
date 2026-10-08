/** Generic simulations. These are never evidence of a company's openings or hiring process. */
import type { EnrichmentDocument, EnrichmentRole } from "../../src/domain/enrichment.js";
import type { RoundType } from "../../src/domain/enums.js";
import { rid } from "./types.js";
import { ENGINEERING_LEVELS, parseEngineeringLevel } from "../../src/domain/engineeringLevels.js";

export const PRACTICE_NOTICE = "Simulated practice profile. Not a verified opening or company interview process.";
export const PRACTICE_LEVELS = ENGINEERING_LEVELS;
export const PRACTICE_PROFILES = ["backend", "frontend", "fullstack", "data-science", "ai-ml", "devops"] as const;
export type PracticeLevel = (typeof PRACTICE_LEVELS)[number];
export type PracticeRole = Omit<EnrichmentRole, "level"> & { level: PracticeLevel };
export type PracticeProfile = (typeof PRACTICE_PROFILES)[number];
export const PRACTICE_ROLE = "software-engineer";

export const PRACTICE_LEVEL_LABELS: Record<PracticeLevel, string> = {
  intern: "Intern", fresher: "Fresher", sde1: "SDE I", sde2: "SDE II", sde3: "SDE III",
  staff: "Staff", principal: "Principal", distinguished: "Distinguished",
};

type Exercise = { name: string; type: RoundType; topics: string[]; guidance: string };
type Profile = { title: string; stack: string[]; fundamentals: Exercise; implementation: Exercise; architecture: Exercise };
const PROFILES: Record<PracticeProfile, Profile> = {
  backend: {
    title: "Backend Engineer", stack: ["HTTP", "SQL", "APIs", "Distributed systems"],
    fundamentals: { name: "Coding and data modelling", type: "dsa", topics: ["Arrays and maps", "Complexity", "SQL joins", "Data modelling"], guidance: "Work through an original coding problem, explain complexity, and model a small relational dataset. Invite a language of the candidate's choice." },
    implementation: { name: "API and service design", type: "lld", topics: ["API contracts", "Validation", "Transactions", "Unit testing"], guidance: "Design a small service and discuss interfaces, validation, transaction boundaries, and failure cases. Ask for code or pseudocode and test examples." },
    architecture: { name: "Backend architecture", type: "system-design", topics: ["Caching", "Queues", "Consistency", "Observability"], guidance: "Design a hypothetical backend. Establish traffic and reliability assumptions before discussing storage, caching, queues, and failure recovery." },
  },
  frontend: {
    title: "Frontend Engineer", stack: ["JavaScript / TypeScript", "HTML", "CSS", "Web accessibility"],
    fundamentals: { name: "Browser and coding foundations", type: "dsa", topics: ["JavaScript collections", "Event loop", "DOM", "Complexity"], guidance: "Discuss browser fundamentals and solve an original collection-processing problem. Ask the candidate to explain asynchronous behavior and edge cases." },
    implementation: { name: "UI implementation design", type: "lld", topics: ["Component interfaces", "State management", "Accessibility", "UI testing"], guidance: "Sketch or implement a hypothetical interactive component. Discuss loading and error states, keyboard access, semantic markup, and test coverage." },
    architecture: { name: "Frontend architecture", type: "system-design", topics: ["Rendering strategies", "Performance budgets", "Design systems", "Client data flow"], guidance: "Design a hypothetical web application. Compare rendering and data-fetching strategies, define performance goals, and discuss accessible design-system boundaries." },
  },
  fullstack: {
    title: "Fullstack Engineer", stack: ["JavaScript / TypeScript", "HTTP", "SQL", "Web applications"],
    fundamentals: { name: "End-to-end coding foundations", type: "dsa", topics: ["Collections", "SQL queries", "HTTP lifecycle", "Complexity"], guidance: "Solve an original data-transformation exercise, outline a SQL query, and trace a browser request through an API. Discuss validation and edge cases." },
    implementation: { name: "Feature implementation design", type: "lld", topics: ["UI state", "API contracts", "Database transactions", "Integration testing"], guidance: "Design a hypothetical feature from UI to database. Define interfaces, loading and error behavior, transaction boundaries, and integration tests." },
    architecture: { name: "Fullstack architecture", type: "system-design", topics: ["Service boundaries", "Rendering", "Caching", "End-to-end observability"], guidance: "Design a hypothetical product with browser, service, and storage components. State capacity assumptions and explain reliability, deployment, and observability trade-offs." },
  },
  "data-science": {
    title: "Data Scientist", stack: ["Python", "SQL", "Statistics", "Experimentation"],
    fundamentals: { name: "Data and statistics exercise", type: "dsa", topics: ["SQL aggregation", "Data cleaning", "Sampling", "Statistical uncertainty"], guidance: "Use a hypothetical dataset for a coding or SQL exercise. Discuss missing data, sampling bias, uncertainty, and how to communicate limitations." },
    implementation: { name: "Experiment and analysis design", type: "lld", topics: ["Hypothesis tests", "Experiment design", "Metric definitions", "Reproducibility"], guidance: "Define a hypothetical business question and design a reproducible analysis or experiment. Discuss metric selection, confounders, leakage, and interpretation." },
    architecture: { name: "Data product design", type: "system-design", topics: ["Data pipelines", "Feature quality", "Batch versus streaming", "Monitoring"], guidance: "Design a hypothetical data product from collection to decision. Discuss schema evolution, data quality, lineage, monitoring, and operational ownership." },
  },
  "ai-ml": {
    title: "AI / ML Engineer", stack: ["Python", "Machine learning", "Model evaluation", "Inference systems"],
    fundamentals: { name: "ML and coding foundations", type: "dsa", topics: ["Python collections", "Train / validation splits", "Evaluation metrics", "Data leakage"], guidance: "Solve an original preprocessing exercise and explain model evaluation on a hypothetical dataset. Check split selection, leakage risks, and metric trade-offs." },
    implementation: { name: "Model and evaluation design", type: "lld", topics: ["Feature pipelines", "Baseline models", "Retrieval evaluation", "Reproducible experiments"], guidance: "Design a hypothetical model or retrieval workflow. Establish a baseline and test plan, explain evaluation datasets, and compare quality, latency, and cost." },
    architecture: { name: "AI system architecture", type: "system-design", topics: ["Model serving", "Retrieval pipelines", "Drift monitoring", "Fallback behavior"], guidance: "Design a hypothetical ML or AI service. Define evaluation gates, inference capacity, monitoring, privacy boundaries, and degraded-service behavior." },
  },
  devops: {
    title: "DevOps Engineer", stack: ["Linux", "Networking", "CI / CD", "Infrastructure as code"],
    fundamentals: { name: "Automation and systems foundations", type: "dsa", topics: ["Scripting", "Log parsing", "Linux processes", "Networking basics"], guidance: "Solve an original log-processing or automation exercise and discuss process and networking fundamentals. Ask for safe retries, input validation, and tests." },
    implementation: { name: "Delivery pipeline design", type: "lld", topics: ["CI / CD stages", "Infrastructure modules", "Secrets handling", "Rollback"], guidance: "Design a hypothetical delivery pipeline or infrastructure module. Discuss test stages, least-privilege access, reproducibility, rollback, and failure handling." },
    architecture: { name: "Reliability architecture", type: "system-design", topics: ["Service objectives", "Capacity planning", "Incident response", "Disaster recovery"], guidance: "Design a hypothetical deployment platform. Establish availability and recovery objectives, explain observability and capacity planning, and walk through an incident." },
  },
};

const LEVEL_FOCUS: Record<PracticeLevel, string> = {
  intern: "Use a small, well-scoped exercise. Offer clarification and evaluate fundamentals, learning approach, and clear reasoning.",
  fresher: "Use an entry-level exercise. Evaluate fundamentals, project reasoning, testing habits, and ability to incorporate feedback.",
  sde1: "Explore independent delivery of a scoped feature, practical debugging, interface choices, and testable implementation.",
  sde2: "Explore component ownership, operational failure modes, measured trade-offs, and coordination across a small team.",
  sde3: "Explore multi-component design, reliability and migration trade-offs, mentoring, and technical ownership.",
  staff: "Explore ambiguous cross-team problems, architecture evolution, technical influence, and measurable outcomes.",
  principal: "Explore organization-scale architecture, long-term investment trade-offs, and alignment across multiple teams.",
  distinguished: "Explore broad technical strategy, uncertain long-horizon decisions, and how to make complex organization-wide trade-offs explicit.",
};

/** This overview describes the simulation, never the actual company's culture or benefits. */
export function practiceOverview(): EnrichmentDocument["company"] {
  return {
    overview: `${PRACTICE_NOTICE} Generic learning exercises attached to a selected company for navigation only. Level names describe practice scope, not that company's internal levels or hiring requirements.`,
    culture: "", benefits: "", sourceUrls: [], verified: false,
  };
}

export function practiceRoleKey(level: PracticeLevel, profile: PracticeProfile): string {
  return `practice|${level}|${profile}`;
}

/** Stable role ID is also the JD ID; neither depends on company display names or generation time. */
export function practiceProfiles(companySlug: string): PracticeRole[] {
  return PRACTICE_LEVELS.flatMap((level, index) => PRACTICE_PROFILES.map((profile) => {
    const definition = PROFILES[profile];
    const key = practiceRoleKey(level, profile);
    const difficulty = index < 2 ? "easy" as const : index < 4 ? "medium" as const : "hard" as const;
    const exercises: Exercise[] = [definition.fundamentals, definition.implementation];
    if (index >= 3) exercises.push(definition.architecture);
    exercises.push({ name: "Collaboration and reflection", type: "behavioural", topics: ["Communication", "Feedback", "Ownership", "Learning from setbacks"], guidance: "Discuss a real project or a clearly hypothetical situation. Ask about collaboration, learning, and decisions; do not require prior employment or imply company-specific values." });
    if (index >= 4) exercises.push({ name: "Technical leadership discussion", type: "hiring-manager", topics: ["Technical priorities", "Stakeholder alignment", "Mentoring", "Trade-off communication"], guidance: "Use hypothetical leadership scenarios appropriate to the practice scope. Discuss prioritization and influence without claiming this is a company hiring-manager round." });
    const id = rid(companySlug, key);
    return {
      id, jdId: id, role: PRACTICE_ROLE, level, specialization: profile,
      title: `${definition.title} · ${PRACTICE_LEVEL_LABELS[level]} [Practice template]`,
      description: `${PRACTICE_NOTICE}\n\nGeneric ${profile} practice at ${PRACTICE_LEVEL_LABELS[level]} scope. ${LEVEL_FOCUS[level]}\n\nNo compensation, experience requirement, opening, internal level equivalence, or company-specific hiring claim is supplied.`,
      techStack: [...definition.stack], yoeMin: null, yoeMax: null, ctcMinLpa: null, ctcMaxLpa: null,
      sourceUrls: [], verified: false,
      rounds: exercises.map((exercise, roundIndex) => ({
        id: rid(companySlug, `${key}|round|${roundIndex}`), name: `${exercise.name} [Practice template]`,
        type: exercise.type, kind: "interview" as const,
        durationMinutes: exercise.type === "behavioural" ? 30 : exercise.type === "hiring-manager" ? 45 : index < 2 ? 30 : index < 4 ? 45 : 60,
        difficulty, topics: [...exercise.topics], questions: [],
        guidance: `${PRACTICE_NOTICE} ${exercise.guidance} ${LEVEL_FOCUS[level]}`,
        sourceUrls: [], verified: false,
      })),
    };
  }));
}

/** Same round-grounding shape as a manual brief, with explicit unsourced simulation provenance. */
export function practiceBrief(company: string, role: EnrichmentRole, at: Date) {
  return {
    company, role: role.role, level: parseEngineeringLevel(role.level), specialization: role.specialization,
    generated_at: at.toISOString(), generation_status: "completed" as const, data_confidence: "low" as const,
    provenance: "practice_template" as const, published_revision: null, sources: [] as string[],
    company_overview: practiceOverview(),
    final_experience: {
      rounds: role.rounds.map((round, index) => ({
        id: round.id, round_number: index + 1, name: round.name, type: round.type, kind: round.kind ?? "interview",
        duration_minutes: round.durationMinutes, difficulty: round.difficulty, topics: round.topics,
        problems: round.questions, format: round.guidance, provenance: "practice_template" as const, source_urls: [] as string[],
      })),
      dominant_topics: [...new Set(role.rounds.flatMap((round) => round.topics))],
      company_specific_patterns: PRACTICE_NOTICE,
      data_confidence: "low" as const, template_used: true as const,
    },
  };
}

export type PracticeBrief = ReturnType<typeof practiceBrief>;
