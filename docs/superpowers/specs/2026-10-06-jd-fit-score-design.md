# JD fit score — design

**Date:** 2026-10-06 · **Status:** approved (spec + review points, 2026-10-06) · **Module:** 02 Job/Loop Setup (catalogue)

## Intent

Every role (JD) card shows a score curated for the signed-in user: how closely **their** resume, GitHub
and coding profiles match **that** JD. The general profile score rates a profile at the user's own
level; the JD fit score rates the same profile against one specific listing (its stack, domain, role
family, experience range and interview-round topics).

**Decisions made (user, 2026-10-06):**

1. **Fit only.** The score measures match to the JD, not general strength. The existing profile score
   is not blended in and the v5 engine is **not** re-run at the JD's level (its LLM item assessments
   are stored per level, so a re-run costs one LLM call per item per extra level, and every JD at the
   same level would get the same number anyway).
2. **Rules only.** No LLM in this build. Profile items are tagged by a **keyword dictionary**; an LLM
   tagger for items the dictionary leaves untagged comes later, behind a flag.
3. **Missing user data counts as 0** (same rule as v5), with a hint saying what to connect or add.
   Missing **JD** data drops that part and rescales the rest (the gap is ours, not the user's).
4. **Level gap: cap + label.** A JD 2+ levels above the user's level is capped at 40 and labelled
   "Stretch role"; 2+ below is labelled "Below your level" (no cap).
5. **Sources:** items and skills from **resume + GitHub**; DSA topic coverage from **LeetCode,
   Codeforces, TUF**. **LinkedIn is not used** (not every user has it). AtCoder and CodeChef carry no
   topic data, so they don't feed fit.
6. **Compute on request** in the API. No storage, no cache, no background job.
7. Weights, targets, cap, sort-by-match and the "Your match" tab as below (approved section by section).

## Guardrails

- **Separate contract.** Not part of `ProfileSummary`, `ProfileScoreSnapshot` or `JobDescriptionSummary`.
- **Never read by** interview results, round gating, readiness, readiness reports or leaderboards.
- **Explainable.** Every part carries the evidence (source, item, matched keyword) or the reason it is
  missing/dropped.
- **Wording.** "72% match". Never "eligible", "qualified", "shortlisted" or anything implying the
  company's judgment. Footer: *"How closely your resume, GitHub and coding profiles match this role's
  listing. A mock-prep guide, not a hiring decision."*

## Out of scope

LLM tagging, LinkedIn, blending the profile score, persisting or historising fit scores, fit-based
leaderboards, any change to the v5 profile score.

---

## 1. Scoring rules

`score = round(100 × Σ(weight × value) / Σ(weight of non-dropped parts))`, then the level-gap cap.
Each part's `value` is 0–1. Scored against the **JD's** level.

### Parts

| Part | Rule |
| --- | --- |
| **Skills** | Share of the JD `techStack` the user covers: `Σ credit / (number of JD stack items)`. Credit **1.0** if *used* (in a resume project's tech list or a resume role/project text, a GitHub language at ≥ 5% byte share, a GitHub repo description/README, or the LeetCode preferred language); **0.5** if only *listed* in the resume skills list; else 0. Stack names go through the skill aliases; names the dictionary doesn't know fall back to an exact normalized-string match (lowercased, whitespace collapsed; 1–2 character terms only match whole list entries). |
| **Domain** | `companies.sector` vs item domain tags. Best item wins: job/internship **1.0**, project or GitHub repo **0.6**, none **0**. |
| **Role** | JD `specialization` vs item role tags, same scale as Domain. |
| **Experience** | Full-time experience months (union of intervals, `experienceMonths()`) vs `yoeMin`/`yoeMax`. Inside or above the range = **1**; below `yoeMin`, linear down to **0** at `yoeMin − 2 years`. If the JD has no range, use the JD level's default band (config). |
| **Round topics** | DSA topics in the JD's rounds, mapped to canonical topics (non-DSA topics such as system design, OS, DBMS are ignored). Per topic: `min(solved / target, 1)` where `solved` is the **best single platform** for that topic (LeetCode, Codeforces, TUF — never summed: TUF syncs the others) and `target` comes from the hardest round mentioning the topic (easy **5**, medium **15**, hard **30**). Value = mean over topics. |

**Skill credit examples.** GitHub is never required for full credit; the resume alone can show use.

| Where the skill appears | Credit |
| --- | --- |
| A resume project's tech list or text ("Built with Spring Boot, Kafka") | 1.0 |
| A resume job/internship's bullets ("Migrated billing to Kafka") | 1.0 |
| A GitHub language at ≥ 5% byte share, or a repo description/README | 1.0 |
| LeetCode preferred language | 1.0 |
| **Only** the resume Skills list, nowhere else | 0.5 |

### Weights by JD level (each row sums to 100)

| JD level | Skills | Domain | Role | Experience | Round topics |
| --- | --- | --- | --- | --- | --- |
| intern, fresher | 30 | 10 | 15 | 10 | 35 |
| sde1 | 30 | 10 | 15 | 20 | 25 |
| sde2 | 30 | 15 | 15 | 30 | 10 |
| sde3, staff, principal, distinguished | 25 | 20 | 15 | 35 | 5 |

### Part status

- `scored` — computed from data on both sides.
- `missing` — the JD has data but the user has no source for the part: no LeetCode/Codeforces/TUF
  connected (round topics), no skills anywhere (skills), no items at all (domain, role). Value **0**,
  weight kept, plus a `hint`. Data that exists but doesn't match (a connected platform with 0 solved in
  a topic, items with no fintech tag) is `scored` 0, not `missing`. Experience is never `missing`: no
  full-time experience is 0 months, which is a full fit when `yoeMin` is 0.
- `dropped` — the JD has nothing to match against: empty `techStack`; generic sector (`it-services`,
  `consumer-internet`, `enterprise-software`, `other`) or none; unknown or empty `specialization`; no
  DSA topic in any round; no `yoe` range **and** no level. Weight removed, rest rescaled. If every part
  is dropped, `score` is `null`.

### Level gap

Levels are ordered by the shared enum (`intern` = 0 … `distinguished` = 7);
`gap = index(JD level) − index(user level)`.

| Condition | `levelGap` | Effect |
| --- | --- | --- |
| `gap ≥ 2` | `stretch` | `score = min(score, 40)`, `cap: 40`, label "Stretch role · SDE-3" |
| `gap ≤ −2` | `below` | no cap, label "Below your level" |
| `−1 ≤ gap ≤ 1` | `none` | — |
| user level unset, or JD level unknown | `unknown` | no cap; the list shows one "Set your level" nudge |

### Default experience bands (years; used only when a JD has no `yoe` range)

intern 0–0 · fresher 0–1 · sde1 0–2 · sde2 2–5 · sde3 5–8 · staff 8–12 · principal 12–16 · distinguished 15–∞

All numbers in this section live in `domain/jdFit/config.ts` under `jd-fit-v1`; changing them is a
config edit, and the response echoes `configVersion` for traceability.

## 2. Tag vocabulary and tagging

### `domain/jdFit/vocabulary.ts` — data only

| Table | Canonical values | Example keywords / aliases |
| --- | --- | --- |
| **Domains** | the company `sector` enum minus generic ones: fintech, e-commerce, edtech, healthtech, gaming, logistics, telecom, semiconductors, saas | fintech ← `upi`, `payments?`, `wallet`, `ledger`, `kyc`, `lending`, `loan`, `razorpay`, `stripe`, `trading` |
| **Roles** | backend, frontend, fullstack, android, ios, data-engineering, ml, devops, embedded, security, qa | backend ← `spring boot`, `express`, `django`, `fastapi`, `rest api`, `microservices?`, `grpc` |
| **Skills** | canonical ids (`java`, `spring-boot`, `postgresql`, …) | spring-boot ← `spring`, `springboot`, `spring-boot` |
| **DSA topics** | canonical topics, each listing its name per platform | graph ← LeetCode `Graph`, Codeforces `graphs` / `dfs and similar` / `shortest paths`, TUF `Graphs`; also the free-text names used in round topics (`BFS`, `DFS`) |

Generic sectors (`it-services`, `consumer-internet`, `enterprise-software`, `other`) are listed
explicitly as generic so the integrity test can check the enum is fully covered.

### Tagger (`domain/jdFit/tagger.ts`)

- Input: an item `{ source, title, kind, texts[] }`; output: `{ domains, roles, skills }`, each tag with
  evidence `{ source, item, matched }`.
- Case-insensitive **whole-word** matching (`java` ≠ `javascript`, `go` ≠ `google`).
- The same aliases canonicalize the JD side: `techStack` → skills, `specialization` → role, round
  topics → DSA topics.
- Interface kept small (`(item) → tags`) so the later LLM tagger can fill only items the dictionary
  left untagged, cached by item hash, without touching the engine.

### Items

| Source | Items | Text tagged |
| --- | --- | --- |
| Resume | projects, internships, jobs from `profileItems()` | title, description, bullets, tech list |
| GitHub | each repo in `readmes[]` (top public non-fork repos, ≤ 6) | description + README; a scaffold/default README (`readmeTemplate()`) is ignored and only the description is used |

The same project on the resume and GitHub is not double-counted: Domain and Role take the **best**
item, Skills take the **best** credit per skill. Evidence lists up to 3 items per part.

## 3. API contract and service

### Endpoints (`packages/contracts/openapi.yaml`, bearer auth)

**`GET /api/v1/jd-fit`** — scores for the cards. Optional `company`, `level`, `specialization`
filters, identical to `GET /api/v1/jds`.

```json
{ "configVersion": "jd-fit-v1",
  "userLevel": "fresher",
  "results": [{ "jdId": "…", "score": 72, "levelGap": "none", "cap": null }] }
```

**`GET /api/v1/jd-fit/{jdId}`** — breakdown for one JD. 404 for unknown or unpublished JDs.

```json
{ "jdId": "…", "score": 72, "levelGap": "none", "cap": null,
  "userLevel": "fresher", "jdLevel": "sde1", "configVersion": "jd-fit-v1",
  "parts": [{
    "key": "domain", "weight": 10, "value": 1.0, "status": "scored",
    "evidence": [{ "source": "resume", "item": "UPI split-pay service", "matched": "UPI", "tag": "fintech" }],
    "hint": null, "reason": null }] }
```

Schemas: `JdFitList`, `JdFitResult`, `JdFitBreakdown`, `JdFitPart`, `JdFitEvidence`.
`part.key` ∈ `skills | domain | role | experience | round_topics`; `status` ∈ `scored | missing | dropped`;
`levelGap` ∈ `none | stretch | below | unknown`; `score` is an integer 0–100 or `null` (every part dropped).
`hint` is set for `missing`, `reason` for `dropped`. Skills evidence also lists the uncovered stack
items. Web types are regenerated from the contract.

### Code layout

| File | Role |
| --- | --- |
| `apps/api/src/domain/jdFit/vocabulary.ts` | dictionary (data only) |
| `apps/api/src/domain/jdFit/config.ts` | weights, credits, targets, cap, level bands, `jd-fit-v1` |
| `apps/api/src/domain/jdFit/tagger.ts` | item → tags + evidence; JD-side canonicalization |
| `apps/api/src/domain/jdFit/profile.ts` | normalized profile + fragments → one `FitProfile` |
| `apps/api/src/domain/jdFit/engine.ts` | `scoreJdFit(fitProfile, fitJd, config)` — pure, deterministic |
| `apps/api/src/services/jdFit.ts` | loads data, builds `FitProfile` once, scores each JD |
| `apps/api/src/routes/jdFit.ts` | the two routes; wired in `app.ts` + `container.ts` |
| `apps/api/docs/jd-fit.md` | methodology + how to add a keyword |

### Service flow (per request)

1. Load the user's candidate profile (and its persisted `level`) and the GitHub, LeetCode, Codeforces
   and TUF fragments **once**. Reuse the profile-scoring adapters' fragment sanitizers (they already
   normalize `byTopic` and languages), `profileItems()` and `experienceMonths()`.
2. Build the `FitProfile`: tagged items, skill credits, best-platform topic counts, full-time months.
3. Load the published JDs matching the filters, each company's `sector`, and each JD's rounds from the
   **same resolver `GET /jds/{jdId}` uses for `interviewProcess`**, so fit topics are exactly the rounds
   the user sees. All rounds count, including `info` rounds (online tests are DSA too).
4. `scoreJdFit` per JD; return the list or the single breakdown.

No profile or no sources is not an error: user-side parts are `missing`, the score is 0, hints say
what to add. Practice-template JDs are scored like any other (generic data simply drops parts).

## 4. UI

### Role card (`app/(app)/jobs/_components/RoleCard.tsx`, used by `CompanyRoles`)

- Neutral pill on the right next to the data-depth meter: **`72% match`** (orange stays the single
  accent; existing pill styling).
- `stretch`: line under the facts, "Stretch role · SDE-3", pill shows `≤40% match` dimmed.
  `below`: "Below your level". `unknown`: no per-card label; one "Set your level for a fairer match"
  line above the list linking to profile settings.
- `score: null`: no pill.
- Cards never wait on the score: they render from `/jds` as today; the pill loads separately with a
  small skeleton. If `/jd-fit` fails, cards render exactly as today.

### Sort by match

New option in `roleFilters.ts`. Roles without a score sort last.

### JD detail (`app/(app)/jobs/[jobId]/_components/Roadmap.tsx`)

- Header: the same pill.
- New third tab **"Your match"** after Process and Insights: one row per part with a bar, the value in
  words (`3 of 5 · Java, Spring Boot, MySQL ✓ · Kafka, Redis ✗`), evidence, `hint` for `missing`,
  greyed row with `reason` for `dropped`, and the footer copy from *Guardrails*.

### Data layer (`features/jobs/`)

- `useJdFitList(filters)`, `useJdFit(jdId)` (TanStack Query), keys next to `JOB_QUERY_KEYS`, generated
  types only.
- Both queries use `staleTime: 0`, so every visit refetches the live score (connecting a source,
  saving the profile or changing the level shows up on the next page view) instead of wiring an
  invalidation into every profile/connection mutation. Keys live under `["jobs", "fit", …]`, so a
  catalogue refresh (`["jobs"]`) refreshes fit too.

## 5. Testing and docs

Test files are written with the work; they are run only when the user asks.

- **Engine (pure):** Spring Boot payments project vs fintech backend JD (domain, role, skills match with
  evidence); no coding platforms → round topics 0 + hint; empty stack or generic sector → dropped and
  rescaled; every part dropped → `null`; level gap `stretch` caps at 40, `below`, `unknown`; best
  platform per topic (LeetCode DP 12 + TUF DP 10 → 12); same project on resume + GitHub counts once and
  cites both; listed-only skill 0.5 vs used 1.0; experience linear ramp and default band.
- **Tagger:** whole-word matching, aliases, evidence recorded, scaffold README ignored.
- **Vocabulary integrity:** every sector enum value is mapped or listed generic; no keyword maps to two
  canonical values in one table; each weight row sums to 100.
- **Routes** (supertest + PGlite + mongodb-memory-server): 401 without auth; 404 unknown/unpublished JD;
  empty profile → 200 with score 0; filters match `/jds`.
- **Web:** card pill and stretch/below labels; card unchanged when `/jd-fit` fails; "Your match" tab
  renders scored/missing/dropped rows; sort by match.
- **Docs:** new `apps/api/docs/jd-fit.md`; one bullet in root `CLAUDE.md` → *Scoring, round gating &
  readiness* (JD fit is a separate, fit-only, rules-based contract; never affects interview results,
  readiness, gating or leaderboards; never worded as eligibility); regenerate web API types.

## Review points (confirmed by the user, 2026-10-06)

1. **Experience counts full-time roles only**; internships are excluded from years of experience
   (industry convention). They still count for Domain, Role and Skills.
2. **GitHub language "used" threshold: ≥ 5% byte share**, so a stray Shell or Dockerfile byte count
   doesn't count as using that language.
3. **Default experience bands** per level (section 1) for JDs with no `yoe` range.

## Additions (user decisions, 2026-10-06, after a catalogue audit)

The audit of all 667 visible JDs found broad DSA topics (537), generic sectors (307), track-name
specializations (9) and templates without an experience range (624). Decided:

1. **Broad DSA asks** ("Data structures", "Algorithms", "Coding problems", or a `dsa` round naming no
   specific topic) are one "General DSA" topic scored on the best platform's total solved vs easy 50,
   medium 150, hard 300. A "Data structures" stack item counts as used when any problems are solved.
2. **Generic sector**: the domain comes from the JD's own title and description; if they name none,
   the part stays dropped.
3. **Generalist role**: a missing or track-name specialization accepts any software role tag.
4. **Practice templates** get the level's typical experience range (`LEVEL_EXPERIENCE_YEARS`) via the
   seed script (applied to all 624), shown as "typical for level"; pay stays empty.

After these, only 265 JDs (generic-sector companies whose JD text names no domain) and 3 Zerodha
JDs (no DSA round in the real process) have a part that isn't scored.
5. **Employer match** (2026-10-07): a resume job or internship at a student-visible catalogue company
   (exact key on name, slug or alias; legal and web suffixes ignored) counts toward that company's
   sector as domain evidence, when the sector is specific. Salescode stays `saas`.

## Persona audit (2026-10-07)

28 fabricated profiles (3–4 per level, varied competencies and sources) were seeded as real accounts
and scored against all 667 JDs through the service (`apps/api/scripts/dev/`). The audit found and
fixed, in order of impact:

1. **Skill asks nobody could match.** Template stacks say `JavaScript / TypeScript`, `HTTP`, `SQL`,
   `APIs`, `Web accessibility`, `Statistics`, `CI / CD`, `Infrastructure as code`, `Model evaluation`,
   `Inference systems`; resumes say React, PostgreSQL, Terraform, WCAG. Fixes: slash entries accept
   either side; `impliedBy` (PostgreSQL → SQL, Terraform → IaC, PyTorch → ML, Docker → Linux…);
   `impliedByRoles` (backend/frontend work → HTTP, backend → APIs, frontend → HTML/CSS; a job in
   full, a project at 0.6); new skill entries; assessment entries (`Aptitude`) excluded.
2. **Backend keywords were web-framework only.** An 8-year Amazon SDE (DynamoDB, SQS, Kinesis,
   "service") scored Role 0 on backend JDs. Added systems and cloud-native backend keywords.
3. **"Queues" in system-design rounds** read as the stack/queue DSA topic. Specific topics now come
   only from `dsa` rounds; broad asks from coding rounds (`dsa`, `lld`, online tests).
4. **Targets saturated too early** (an "easy" round at 50 solved tied a 92-problem fresher with a
   430-problem one). Per-topic 8/20/40, general 100/200/400 with a level floor (fresher 150,
   SDE-1+ 200).
5. **Data Scientist listings rejected data-engineering work**; a `data-science` role tag was added
   and the mapping widened.
6. **Bare "delivery"** tagged "TCS delivery teams" as logistics; replaced with specific phrases.

After the fixes every persona's own specialization leads its own-level templates, thin profiles
score low (a resume-only tier-3 student averages 30), and the three remaining strength-order flags
are the catalogue's shape (three fintech companies vs one e-commerce; the backend template asks
for SQL, which a DynamoDB engineer's resume lacks), not scoring errors.

## Over-qualification (user decision, 2026-10-07)

Roles below the user's level keep the "Below your level" label and no cap; instead the **experience
part decays** above the JD's maximum: linearly from 1 at the maximum to a floor of 0.5 at double the
maximum (max + 1 year when the maximum is under a year), never lower; open-ended ranges never decay.
The effect is bounded by the experience weight of the JD's level (10 at intern/fresher, 20 at SDE-1,
30 at SDE-2, 35 from SDE-3), so a Staff engineer still scores high on a fresher template it otherwise
matches; the decay is a nudge, not a gate.

## Level-gap factor (user decision, 2026-10-07)

Inspecting the user's own SDE-1 account showed generic fresher tracks (Accenture ASE: Java, Python,
SQL, OOP) out-matching the catalogue's Java-backend SDE-1 listings for a TypeScript full-stack
profile; the experience decay alone is worth at most 5 points on a fresher JD. Decided: the final
score of a role below the user's level is multiplied by 0.85 (one level below) or 0.7 (two or more),
exposed as `levelFactor` and explained on the match tab. The easy-round per-topic targets also get
the level floor (intern 10, fresher 15, SDE-1+ 20) so an aptitude test's "Arrays" is no longer
saturated by a dozen problems.
