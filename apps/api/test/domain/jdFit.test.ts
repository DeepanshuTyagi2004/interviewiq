import { describe, expect, it } from "vitest";
import type { CandidateProfileDoc, ProfileFragmentDoc } from "../../src/db/mongo/client.js";
import { ENGINEERING_LEVELS, type EngineeringLevel } from "../../src/domain/engineeringLevels.js";
import type { ProfileSource } from "../../src/domain/enums.js";
import { FIT_PART_KEYS, JD_FIT_CONFIG } from "../../src/domain/jdFit/config.js";
import { scoreJdFit } from "../../src/domain/jdFit/engine.js";
import { buildFitProfile } from "../../src/domain/jdFit/profile.js";
import { canonicalSkill, catalogueEmployer, companyKey, isGeneralDsaTopic, matchInList, matchInText, platformTopicTags, roundTopicTags, tagItem, type CatalogueCompany } from "../../src/domain/jdFit/tagger.js";
import type { FitJd, FitPart, FitResult } from "../../src/domain/jdFit/types.js";
import { DOMAINS, GENERIC_SECTORS, ROLES, DSA_TOPICS, SKILLS } from "../../src/domain/jdFit/vocabulary.js";
import { COMPANY_SECTORS } from "../../src/services/companyDraftPublication.js";

const AS_OF = "2026-10-06T00:00:00.000Z";

function profileDoc(overrides: Partial<CandidateProfileDoc> = {}): CandidateProfileDoc {
  return {
    _id: "u1", userId: "u1", fullName: "Asha", email: null, phone: null, location: null, headline: null, targetRole: null,
    education: [], experience: [], projects: [], skills: [], achievements: [],
    detectedLinks: { github: null, leetcode: null, linkedin: null } as CandidateProfileDoc["detectedLinks"],
    resumeFilename: null, resumeParsedAt: null, createdAt: new Date(AS_OF), updatedAt: new Date(AS_OF), level: "fresher",
    ...overrides,
  };
}

function fragment(source: ProfileSource, data: Record<string, unknown>, fetchedAt = AS_OF): ProfileFragmentDoc {
  return { _id: `${source}-${fetchedAt}`, userId: "u1", source, data, contentHash: "h", version: 1, fetchedAt: new Date(fetchedAt) };
}

const UPI_PROJECT = { name: "UPI split-pay service", description: "Split bills between friends over UPI payments.", tech: ["Java", "Spring Boot", "PostgreSQL"], bullets: ["Built REST APIs with Spring Boot"], link: null };

function jd(overrides: Partial<FitJd> = {}): FitJd {
  return {
    id: "jd-1", level: "fresher", sector: "fintech", specialization: "backend", text: "", techStack: ["Java", "Spring", "MySQL"], yoeMin: 0, yoeMax: 1,
    rounds: [{ topics: ["Dynamic Programming", "Graphs (BFS/DFS)"], difficulty: "medium", type: "dsa" }],
    ...overrides,
  };
}

const fit = (doc: CandidateProfileDoc | null, fragments: ProfileFragmentDoc[] = []) =>
  buildFitProfile({ profile: doc, fragments, level: (doc?.level ?? null) as EngineeringLevel | null, asOf: AS_OF });
const partOf = (r: FitResult, key: FitPart["key"]) => r.parts.find((p) => p.key === key)!;

describe("JD fit — a Spring Boot payments project vs a fintech backend JD", () => {
  const result = scoreJdFit(fit(profileDoc({ projects: [UPI_PROJECT] })), jd());

  it("matches domain, role and skills from the resume alone, with evidence", () => {
    expect(partOf(result, "domain")).toMatchObject({ status: "scored", value: 0.6 });
    expect(partOf(result, "domain").evidence[0]).toMatchObject({ source: "resume", item: "UPI split-pay service", tag: "fintech" });
    expect(partOf(result, "role")).toMatchObject({ status: "scored", value: 0.6 });
    expect(partOf(result, "role").evidence[0]).toMatchObject({ tag: "backend" });
    const skills = partOf(result, "skills");
    // Evidence is tagged with the JD's own stack term.
    expect(skills.evidence.map((e) => e.tag)).toEqual(["Java", "Spring"]);
    expect(skills.uncovered).toEqual(["MySQL"]);
    expect(skills.value).toBeCloseTo(2 / 3, 3);
  });

  it("counts coding topics as missing (0, weight kept, with a hint) when no platform is connected", () => {
    const topics = partOf(result, "round_topics");
    expect(topics).toMatchObject({ status: "missing", value: 0, weight: 35 });
    expect(topics.hint).toMatch(/Connect LeetCode, Codeforces or TUF/);
    expect(topics.uncovered).toEqual(["Dynamic programming", "Graphs"]);
  });

  it("is a weighted sum over every part that isn't dropped", () => {
    const expected = Math.round(result.parts.reduce((s, p) => s + p.weight * p.value, 0));
    expect(result.score).toBe(expected);
    expect(result).toMatchObject({ levelGap: "none", cap: null, configVersion: "jd-fit-v1" });
  });
});

describe("JD fit — parts and edge rules", () => {
  it("a job beats a project for domain and role", () => {
    const doc = profileDoc({ experience: [{ company: "Razorpay", title: "Backend Engineer", startDate: "2025-01", endDate: "present", location: null, bullets: ["Built payment reconciliation microservices"] }] });
    const r = scoreJdFit(fit(doc), jd());
    expect(partOf(r, "domain")).toMatchObject({ value: 1 });
    expect(partOf(r, "role")).toMatchObject({ value: 1 });
  });

  it("drops parts the JD gives nothing for and rescales the rest", () => {
    const r = scoreJdFit(fit(profileDoc({ projects: [UPI_PROJECT] })), jd({ techStack: [], sector: "it-services", rounds: [] }));
    expect(partOf(r, "skills")).toMatchObject({ status: "dropped", reason: "This role lists no tech stack." });
    expect(partOf(r, "domain").reason).toMatch(/general/);
    expect(partOf(r, "round_topics").status).toBe("dropped");
    const counted = r.parts.filter((p) => p.status !== "dropped");
    const total = counted.reduce((s, p) => s + p.weight, 0);
    expect(r.score).toBe(Math.round((100 * counted.reduce((s, p) => s + p.weight * p.value, 0)) / total));
  });

  it("treats a missing or track-name specialization as a generalist role: any software work matches", () => {
    const withProject = fit(profileDoc({ projects: [UPI_PROJECT] }));
    for (const specialization of [null, "ninja", "advanced-ase"]) {
      expect(partOf(scoreJdFit(withProject, jd({ specialization })), "role")).toMatchObject({ status: "scored", value: 0.6, uncovered: [] });
    }
    expect(partOf(scoreJdFit(fit(profileDoc()), jd({ specialization: "ninja" })), "role")).toMatchObject({ status: "missing", uncovered: ["software engineering"] });
  });

  it("reads the domain from the JD's own text when the company's sector is generic", () => {
    const tracker = profileDoc({ projects: [{ name: "Last-mile tracker", description: "Live courier tracking for deliveries.", tech: ["Kotlin"], bullets: [], link: null }] });
    const swiggy = jd({ sector: "consumer-internet", text: "sde i | build delivery and dispatch systems for food orders" });
    const domain = partOf(scoreJdFit(fit(tracker), swiggy), "domain");
    expect(domain).toMatchObject({ status: "scored", value: 0.6 });
    expect(domain.evidence[0]).toMatchObject({ tag: "logistics" });
    expect(partOf(scoreJdFit(fit(tracker), jd({ sector: "consumer-internet", text: "sde i | build scalable systems" })), "domain").reason).toMatch(/general/);
    // A specific sector wins over the JD's text.
    expect(partOf(scoreJdFit(fit(tracker), jd({ sector: "fintech", text: "delivery" })), "domain")).toMatchObject({ value: 0, uncovered: ["fintech"] });
  });

  it("an empty profile scores 0, not an error, with hints", () => {
    const r = scoreJdFit(fit(null), jd());
    expect(r.score).toBe(Math.round((100 * JD_FIT_CONFIG.weights.fresher.experience) / 100));
    expect(partOf(r, "skills")).toMatchObject({ status: "missing" });
    expect(partOf(r, "domain").hint).toMatch(/Add projects or experience/);
    expect(partOf(r, "experience")).toMatchObject({ status: "scored", value: 1 });
  });

  it("caps a stretch role, labels a lower one, and leaves an unset level alone", () => {
    const strong = profileDoc({ projects: [UPI_PROJECT], skills: ["Java", "Spring", "MySQL"] });
    const stretch = scoreJdFit(fit(strong), jd({ level: "sde2", yoeMin: null, yoeMax: null, rounds: [] }));
    expect(stretch).toMatchObject({ levelGap: "stretch", cap: 40 });
    expect(stretch.score).toBeLessThanOrEqual(40);
    expect(scoreJdFit(fit(profileDoc({ level: "sde3" })), jd()).levelGap).toBe("below");
    expect(scoreJdFit(fit(profileDoc({ level: "sde1" })), jd({ level: "sde2" })).levelGap).toBe("none");
    expect(scoreJdFit(fit(profileDoc({ level: null })), jd({ level: "staff" }))).toMatchObject({ levelGap: "unknown", cap: null, levelFactor: null });
  });

  it("multiplies the score down for a role below the user's level, by the gap", () => {
    const sde2 = fit(profileDoc({ level: "sde2", projects: [UPI_PROJECT], skills: ["Java", "Spring", "MySQL"] }));
    const same = scoreJdFit(sde2, jd({ level: "sde2", yoeMin: 2, yoeMax: 5, rounds: [] }));
    const one = scoreJdFit(sde2, jd({ level: "sde1", yoeMin: 2, yoeMax: 5, rounds: [] }));
    const two = scoreJdFit(sde2, jd({ level: "fresher", yoeMin: 2, yoeMax: 5, rounds: [] }));
    expect(same.levelFactor).toBeNull();
    expect(one).toMatchObject({ levelGap: "none", levelFactor: 0.85 });
    expect(two).toMatchObject({ levelGap: "below", levelFactor: 0.7, cap: null });
    // Same parts (identical range, no rounds), so the ratio is the factor itself, allowing rounding.
    const weighted = (r: FitResult) => r.parts.filter((p) => p.status !== "dropped").reduce((s, p) => s + p.weight * p.value, 0) / r.parts.filter((p) => p.status !== "dropped").reduce((s, p) => s + p.weight, 0);
    expect(one.score).toBe(Math.round(100 * 0.85 * weighted(one)));
    expect(two.score).toBe(Math.round(100 * 0.7 * weighted(two)));
    expect(scoreJdFit(sde2, jd({ level: "staff", rounds: [] })).levelFactor).toBeNull(); // above: cap, never a factor
  });

  it("takes the best single platform per topic, never a sum", () => {
    const fragments = [
      fragment("LEETCODE", { byTopic: [{ topic: "Dynamic Programming", count: 12 }, { topic: "Graph", count: 3 }] }),
      fragment("TUF", { byTopic: [{ topic: "dynamic programming", count: 10 }, { topic: "graphs", count: 6 }] }),
    ];
    const topics = partOf(scoreJdFit(fit(profileDoc(), fragments), jd()), "round_topics");
    expect(topics.evidence).toEqual([
      { source: "leetcode", item: "Dynamic Programming", matched: "12/20 solved", tag: "Dynamic programming" },
      { source: "tuf", item: "graphs", matched: "6/20 solved", tag: "Graphs" },
    ]);
    expect(topics.value).toBeCloseTo((12 / 20 + 6 / 20) / 2, 3);
  });

  it("a connected platform with nothing solved in a topic is scored 0, not missing", () => {
    const topics = partOf(scoreJdFit(fit(profileDoc(), [fragment("CODEFORCES", { byTopic: [] })]), jd()), "round_topics");
    expect(topics).toMatchObject({ status: "scored", value: 0, uncovered: ["Dynamic programming", "Graphs"] });
  });

  it("uses the hardest round's target for a topic", () => {
    const r = scoreJdFit(fit(profileDoc(), [fragment("LEETCODE", { byTopic: [{ topic: "Dynamic Programming", count: 15 }] })]),
      jd({ rounds: [{ topics: ["DP"], difficulty: "medium", type: "dsa" }, { topics: ["dynamic programming"], difficulty: "Hard", type: "dsa" }] }));
    expect(partOf(r, "round_topics")).toMatchObject({ value: 0.375 }); // 15 of the hard round's 40
  });

  it("scores a broad DSA ask (\"Data structures\", or a DSA round with no specific topic) on total problems solved", () => {
    const leetcode = fragment("LEETCODE", { solved: { easy: 30, medium: 50, hard: 10, total: 90 }, byTopic: [{ topic: "Array", count: 40 }] });
    const broad = jd({ rounds: [
      { topics: ["Quantitative aptitude", "Basic programming"], difficulty: "easy", type: "dsa" },
      { topics: ["Data structures", "Algorithms", "Java", "SQL"], difficulty: "medium", type: "dsa" },
      { topics: ["Communication", "Compensation"], difficulty: "easy", type: "hiring-manager" },
    ] });
    const topics = partOf(scoreJdFit(fit(profileDoc(), [leetcode]), broad), "round_topics");
    expect(topics).toMatchObject({ status: "scored", value: 0.45 });
    expect(topics.evidence).toEqual([{ source: "leetcode", item: "Problems solved", matched: "90/200 solved", tag: "General DSA" }]);
    // A DSA round that names no topic at all is a broad ask too; specific topics beside it are scored per topic.
    const mixed = partOf(scoreJdFit(fit(profileDoc(), [leetcode]), jd({ rounds: [{ topics: [], difficulty: "hard", type: "dsa" }, { topics: ["Arrays"], difficulty: "easy", type: "dsa" }] })), "round_topics");
    expect(mixed.evidence.map((e) => e.tag)).toEqual(["General DSA", "Arrays"]);
    expect(mixed.value).toBeCloseTo((90 / 400 + 1) / 2, 3);
  });

  it("takes the best single platform's total for broad asks", () => {
    const fragments = [fragment("LEETCODE", { solved: { easy: 10, medium: 20, hard: 5 } }), fragment("TUF", { totalSolved: 120, byTopic: [] })];
    const topics = partOf(scoreJdFit(fit(profileDoc(), fragments), jd({ rounds: [{ topics: ["Data structures"], difficulty: "medium", type: "dsa" }] })), "round_topics");
    expect(topics.evidence[0]).toMatchObject({ source: "tuf", matched: "120/200 solved" });
  });

  it("drops round topics only when there is no DSA or coding round", () => {
    const hr = jd({ rounds: [{ topics: ["Communication"], difficulty: "easy", type: "hiring-manager" }, { topics: ["Coding assignment"], difficulty: "medium", type: "take-home" }] });
    expect(partOf(scoreJdFit(fit(profileDoc()), hr), "round_topics")).toMatchObject({ status: "dropped", reason: "This role's rounds have no DSA or coding round." });
  });

  it("credits a \"Data structures\" stack item from solved problems", () => {
    const skills = partOf(scoreJdFit(fit(profileDoc(), [fragment("LEETCODE", { solved: { total: 412 } })]), jd({ techStack: ["Data Structures"] })), "skills");
    expect(skills).toMatchObject({ value: 1 });
    expect(skills.evidence[0]).toMatchObject({ source: "leetcode", item: "Problems solved", matched: "412 solved", tag: "Data Structures" });
  });

  it("counts a job at a catalogue company toward that company's sector", () => {
    const catalogue: CatalogueCompany[] = [
      { name: "Salescode", slug: "salescode", aliases: ["Salescode.ai", "SalesCode"], sector: "saas" },
      { name: "Razorpay", slug: "razorpay", aliases: ["Razorpay Software"], sector: "fintech" },
      { name: "TCS", slug: "tcs", aliases: ["Tata Consultancy Services"], sector: "it-services" },
    ];
    const job = (company: string) => profileDoc({ experience: [{ company, title: "Full-Stack Developer", startDate: "2024-01", endDate: "present", location: null, bullets: ["Built dashboards for field sales teams"] }] });
    const withCatalogue = (doc: CandidateProfileDoc) => buildFitProfile({ profile: doc, fragments: [], level: "fresher", asOf: AS_OF, catalogue });
    const saas = partOf(scoreJdFit(withCatalogue(job("Salescode.ai")), jd({ sector: "saas" })), "domain");
    expect(saas).toMatchObject({ status: "scored", value: 1 });
    expect(saas.evidence[0]).toMatchObject({ source: "resume", item: "Full-Stack Developer · Salescode.ai", matched: "Salescode (catalogue: saas)", tag: "saas" });
    expect(partOf(scoreJdFit(withCatalogue(job("Razorpay Software Pvt. Ltd.")), jd()), "domain")).toMatchObject({ value: 1 });
    // A generic sector says nothing about the domain; an unknown employer and no catalogue add nothing.
    expect(withCatalogue(job("Tata Consultancy Services")).items[0]!.domains).toEqual([]);
    expect(withCatalogue(job("Acme Widgets")).items[0]!.domains).toEqual([]);
    expect(fit(job("Salescode.ai")).items[0]!.domains).toEqual([]);
  });

  it("does not double-count the same project on the resume and GitHub, and cites both", () => {
    const github = fragment("GITHUB", {
      languages: [{ name: "Java", pct: 90, bytes: 9000 }, { name: "Shell", pct: 2, bytes: 200 }],
      topRepos: [{ name: "upi-split-pay", stars: 3, primaryLang: "Java" }],
      readmes: [{ repo: "upi-split-pay", description: "UPI bill splitting backend", text: "A Spring Boot service that splits bills and settles them over UPI payments with a ledger." }],
    });
    const domain = partOf(scoreJdFit(fit(profileDoc({ projects: [UPI_PROJECT] }), [github]), jd()), "domain");
    expect(domain.value).toBe(0.6);
    expect(domain.evidence.map((e) => e.source).sort()).toEqual(["github", "resume"]);
  });

  it("gives a skill only listed on the resume half credit, and full credit once used anywhere", () => {
    const listed = partOf(scoreJdFit(fit(profileDoc({ skills: ["Kafka"] })), jd({ techStack: ["Kafka"] })), "skills");
    expect(listed).toMatchObject({ value: 0.5 });
    expect(listed.evidence[0]!.item).toMatch(/listed only/);
    const used = profileDoc({ skills: ["Kafka"], experience: [{ company: null, title: "SDE Intern", startDate: "2025-05", endDate: "2025-07", location: null, bullets: ["Migrated billing events to Kafka"] }] });
    expect(partOf(scoreJdFit(fit(used), jd({ techStack: ["Kafka"] })), "skills")).toMatchObject({ value: 1 });
  });

  it("counts GitHub languages from 5% of code bytes and the LeetCode language", () => {
    const fragments = [
      fragment("GITHUB", { languages: [{ name: "Go", pct: 60, bytes: 6000 }, { name: "Shell", pct: 3, bytes: 300 }] }),
      fragment("LEETCODE", { recentActivity: { preferredLanguage: "Python3" } }),
    ];
    const skills = partOf(scoreJdFit(fit(profileDoc(), fragments), jd({ techStack: ["Go", "Shell", "Python"] })), "skills");
    expect(skills.evidence.map((e) => [e.tag, e.source])).toEqual([["Go", "github"], ["Python", "leetcode"]]);
    expect(skills.uncovered).toEqual(["Shell"]);
  });

  it("experience: full-time only, linear below the minimum, level band when the JD has no range", () => {
    const oneYear = profileDoc({ experience: [
      { company: null, title: "Software Engineer", startDate: "2025-10", endDate: "2026-09", location: null, bullets: [] },
      { company: null, title: "SDE Intern", startDate: "2023-01", endDate: "2024-12", location: null, bullets: [] },
    ] });
    expect(partOf(scoreJdFit(fit(oneYear), jd({ level: "sde2", yoeMin: 2, yoeMax: 4 })), "experience").value).toBe(0.5);
    const band = partOf(scoreJdFit(fit(oneYear), jd({ level: "sde2", yoeMin: null, yoeMax: null })), "experience");
    expect(band).toMatchObject({ value: 0.5 });
    expect(band.evidence[0]!.tag).toBe("2–5 yrs asked");
    expect(partOf(scoreJdFit(fit(profileDoc()), jd({ yoeMin: 3, yoeMax: null })), "experience").value).toBe(0);
  });

  it("experience: over-qualification decays softly to a floor, never below it, and never for an open-ended range", () => {
    // n years of full-time work ending September 2026 (month precision, inclusive).
    const years = (n: number) => { const start = 2026 * 12 + 8 - Math.round(n * 12) + 1; return profileDoc({ experience: [{ company: null, title: "Software Engineer", startDate: `${Math.floor(start / 12)}-${String((start % 12) + 1).padStart(2, "0")}`, endDate: "2026-09", location: null, bullets: [] }] }); };
    const fresher = (n: number) => partOf(scoreJdFit(fit(years(n)), jd({ yoeMin: 0, yoeMax: 1 })), "experience");
    expect(fresher(1).value).toBe(1);
    expect(fresher(1.5).value).toBeCloseTo(0.75, 2); // halfway to the floor over a 1-year span
    expect(fresher(2).value).toBeCloseTo(0.5, 2); // double the maximum: the floor
    expect(fresher(9).value).toBeCloseTo(0.5, 2); // never below it
    expect(fresher(9).uncovered).toEqual(["more than the 0–1 yrs asked"]);
    // A 2–5 band reaches the floor at 10 years; the level band applies when the JD has no range.
    expect(partOf(scoreJdFit(fit(years(7.5)), jd({ level: "sde2", yoeMin: null, yoeMax: null })), "experience").value).toBeCloseTo(0.75, 2);
    expect(partOf(scoreJdFit(fit(years(20)), jd({ yoeMin: 15, yoeMax: null })), "experience").value).toBe(1);
  });

  it("ignores a scaffold README but keeps the repo description", () => {
    const vite = "# React + Vite This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules. Currently, two official plugins are available: - [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh - [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh";
    const p = fit(profileDoc(), [fragment("GITHUB", { readmes: [{ repo: "todo", description: "", text: vite }, { repo: "ledger", description: "Personal expense ledger", text: vite }] })]);
    expect(p.items.map((i) => i.title)).toEqual(["ledger"]);
    expect(p.items[0]!.roles).toEqual([]);
    expect(p.items[0]!.domains.map((d) => d.tag)).toEqual(["fintech"]);
  });
});

describe("JD fit tagger", () => {
  it("matches whole words only", () => {
    const java = canonicalSkill("Java");
    expect(matchInText("built with javascript", java)).toBeNull();
    expect(matchInText("built with java and spring", java)).toBe("java");
    expect(matchInText("worked at google", canonicalSkill("Go"))).toBeNull();
    expect(matchInText("ready to go live", canonicalSkill("Go"))).toBeNull();
    expect(matchInList(["go"], canonicalSkill("Golang"))).toBe("go");
    expect(matchInList(["c++"], canonicalSkill("C"))).toBeNull();
    expect(matchInText("asp.net mvc app", canonicalSkill(".NET"))).toBe("asp.net");
  });

  it("lets longer keywords claim their span first", () => {
    expect(tagItem("a react native app", []).roles.map((r) => r.tag).sort()).toEqual(["android", "ios"]);
    expect(roundTopicTags("Binary Search Trees")).toEqual(["trees"]);
    expect(roundTopicTags("Graphs (BFS/DFS)")).toEqual(["graphs"]);
    expect(roundTopicTags("System design")).toEqual([]);
  });

  it("tags backend + frontend in one item as full-stack too", () => {
    expect(tagItem("react frontend with an express.js rest api", []).roles.map((r) => r.tag)).toEqual(expect.arrayContaining(["backend", "frontend", "fullstack"]));
  });

  it("maps each platform's own topic names", () => {
    expect(platformTopicTags("dfs and similar")).toEqual(["graphs"]);
    expect(platformTopicTags("Heap (Priority Queue)")).toEqual(["heaps"]);
    expect(platformTopicTags("sliding window & two pointer")).toEqual(["two-pointers"]);
    expect(platformTopicTags("dp")).toEqual(["dynamic-programming"]);
  });

  it("matches employers by exact company key, never by a partial name", () => {
    expect(companyKey("Salescode.ai")).toBe("salescode");
    expect(companyKey("Razorpay Software Pvt. Ltd.")).toBe("razorpaysoftware");
    expect(companyKey("BYJU'S")).toBe(companyKey("Byju's"));
    const catalogue: CatalogueCompany[] = [{ name: "Amazon", slug: "amazon", aliases: ["Amazon India"], sector: "e-commerce" }];
    expect(catalogueEmployer("Amazon India Pvt Ltd", catalogue)?.slug).toBe("amazon");
    expect(catalogueEmployer("Amazon Pay", catalogue)).toBeNull();
    expect(catalogueEmployer(null, catalogue)).toBeNull();
  });

  it("satisfies a stack term with either side of a slash, and ignores assessment entries", () => {
    const ts = profileDoc({ projects: [{ name: "Dash", description: "An admin dashboard.", tech: ["TypeScript", "React"], bullets: [], link: null }] });
    const skills = partOf(scoreJdFit(fit(ts), jd({ techStack: ["JavaScript / TypeScript", "Aptitude", "CI / CD"] })), "skills");
    expect(skills.evidence.map((e) => [e.tag, e.matched])).toEqual([["JavaScript / TypeScript", "typescript"]]);
    expect(skills.uncovered).toEqual(["CI / CD"]);
    expect(skills.value).toBe(0.5);
    expect(partOf(scoreJdFit(fit(ts), jd({ techStack: ["Aptitude"] })), "skills")).toMatchObject({ status: "dropped" });
  });

  it("raises an easy round's per-topic target to the JD level's floor too", () => {
    const lc = fragment("LEETCODE", { solved: { easy: 30, medium: 15, hard: 0, total: 45 }, byTopic: [{ topic: "Array", count: 12 }] });
    const easy = [{ topics: ["Arrays"], difficulty: "easy", type: "dsa" }];
    expect(partOf(scoreJdFit(fit(profileDoc(), [lc]), jd({ level: "intern", rounds: easy })), "round_topics").value).toBeCloseTo(1, 3); // 12 of 10
    expect(partOf(scoreJdFit(fit(profileDoc(), [lc]), jd({ level: "fresher", rounds: easy })), "round_topics").value).toBeCloseTo(0.8, 3); // 12 of 15
    expect(partOf(scoreJdFit(fit(profileDoc(), [lc]), jd({ level: "sde1", rounds: easy })), "round_topics").value).toBeCloseTo(0.6, 3); // 12 of 20
  });

  it("raises an easy broad ask to the JD level's floor", () => {
    const lc = fragment("LEETCODE", { solved: { easy: 60, medium: 30, hard: 0, total: 90 } });
    const easy = [{ topics: ["Basic programming"], difficulty: "easy", type: "dsa" }];
    expect(partOf(scoreJdFit(fit(profileDoc(), [lc]), jd({ level: "intern", rounds: easy })), "round_topics").value).toBeCloseTo(0.9, 3); // 90 of 100
    expect(partOf(scoreJdFit(fit(profileDoc(), [lc]), jd({ level: "fresher", rounds: easy })), "round_topics").value).toBeCloseTo(0.6, 3); // 90 of 150
    expect(partOf(scoreJdFit(fit(profileDoc(), [lc]), jd({ level: "sde2", rounds: easy })), "round_topics").value).toBeCloseTo(0.45, 3); // 90 of 200
  });

  it("credits a skill shown by a related skill or by the role itself", () => {
    const amazon = profileDoc({ experience: [{ company: "Amazon", title: "Software Development Engineer", startDate: "2023-01", endDate: "present", location: null, bullets: ["Own the inventory-reservation service on DynamoDB and SQS, 60k TPS"] }] });
    const skills = partOf(scoreJdFit(fit(amazon), jd({ techStack: ["HTTP", "SQL", "APIs", "Distributed systems"] })), "skills");
    // HTTP and APIs: backend work. SQL: nothing (DynamoDB is not SQL). Distributed systems: a backend keyword, not a skill alias here.
    expect(skills.evidence.map((e) => e.tag)).toEqual(["HTTP", "APIs"]);
    expect(skills.evidence[0]!.matched).toMatch(/backend work/);
    expect(skills.uncovered).toEqual(["SQL", "Distributed systems"]);
    expect(skills.value).toBe(0.5); // a job's role work counts in full
    // The same work in a project earns the project rate, not full credit.
    const side = profileDoc({ projects: [{ name: "Shop API", description: "An Express REST API for a shop", tech: ["Node.js"], bullets: [], link: null }] });
    expect(partOf(scoreJdFit(fit(side), jd({ techStack: ["Web applications"] })), "skills").value).toBe(1); // Express is a web framework: direct implication, full credit
    const desktop = profileDoc({ projects: [{ name: "Library app", description: "Desktop library manager", tech: ["Java", "Swing", "MySQL"], bullets: [], link: null }] });
    expect(partOf(scoreJdFit(fit(desktop), jd({ techStack: ["HTTP"] })), "skills").value).toBe(0.6); // only backend-tagged project work
    const pg = profileDoc({ skills: ["PostgreSQL", "Terraform"] });
    const implied = partOf(scoreJdFit(fit(pg), jd({ techStack: ["SQL", "Infrastructure as code"] })), "skills");
    // Listed skills are stored lowercased; the implying skill is named.
    expect(implied.evidence.map((e) => e.matched)).toEqual(["postgresql (shows PostgreSQL)", "terraform (shows Terraform)"]);
    expect(implied.value).toBe(0.5); // listed only
  });

  it("recognizes broad DSA topics by the whole topic, not a word inside it", () => {
    for (const topic of ["Data structures", "Algorithms", "Basic problem solving", "Coding problems", "DSA"]) expect(isGeneralDsaTopic(topic), topic).toBe(true);
    for (const topic of ["Coding assignment", "System design", "Data modelling", "Arrays"]) expect(isGeneralDsaTopic(topic), topic).toBe(false);
  });

  it("falls back to the exact term for stack items the dictionary doesn't know", () => {
    expect(canonicalSkill("Temporal")).toMatchObject({ id: "temporal", label: "Temporal", aliases: ["temporal"] });
    expect(canonicalSkill("R")).toMatchObject({ aliases: [], strict: ["r"] });
  });
});

describe("JD fit vocabulary integrity", () => {
  it("maps every company sector to a domain or lists it as generic", () => {
    const covered = new Set<string>([...DOMAINS.map((d) => d.tag), ...GENERIC_SECTORS]);
    expect(COMPANY_SECTORS.filter((s) => !covered.has(s))).toEqual([]);
    expect(DOMAINS.map((d) => d.tag).filter((t) => !(COMPANY_SECTORS as readonly string[]).includes(t))).toEqual([]);
  });

  it("never maps one keyword to two tags in a table (cross-platform mobile frameworks excepted)", () => {
    const shared = new Set(["flutter", "react native"]);
    for (const table of [DOMAINS, ROLES, DSA_TOPICS]) {
      const owner = new Map<string, string>();
      for (const entry of table) for (const k of entry.keywords) {
        if (!shared.has(k)) expect(owner.get(k) ?? entry.tag, `${k} in ${entry.tag}`).toBe(entry.tag);
        owner.set(k, entry.tag);
      }
    }
    const skillOwner = new Map<string, string>();
    for (const s of SKILLS) for (const a of [...s.aliases, ...(s.strict ?? [])]) {
      expect(skillOwner.get(a) ?? s.id, `${a} in ${s.id}`).toBe(s.id);
      skillOwner.set(a, s.id);
    }
  });

  it("has a weight row per level that sums to 100", () => {
    for (const level of ENGINEERING_LEVELS) {
      expect(FIT_PART_KEYS.reduce((sum, key) => sum + JD_FIT_CONFIG.weights[level][key], 0), level).toBe(100);
    }
  });
});
