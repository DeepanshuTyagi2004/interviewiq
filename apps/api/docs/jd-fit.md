# JD fit (`jd-fit-v1`)

JD fit is how closely one user's profile matches one JD's listing. It appears as "72% match" on
every role card and as a part-by-part breakdown on the JD page ("Your match").

It is **fit only, not strength**. The profile score (`profile-scoring-v5.md`) rates a profile at the
user's own level; JD fit rates the same profile against one listing's stack, domain, role family,
experience range and interview-round topics. The two are never blended. JD fit never feeds interview
results, round gating, readiness, readiness reports or leaderboards, and its copy is never
"eligible", "qualified" or anything implying the company's judgment.

Design: `docs/superpowers/specs/2026-10-06-jd-fit-score-design.md` (approved 2026-10-06).

## Rules only, computed on request

- No LLM and no AI-service scoring call. Items are tagged by a keyword dictionary.
- Nothing is stored. `GET /api/v1/jd-fit` loads the user's sources once and scores every JD the
  library lists; the score always reflects the current profile.
- An LLM tagger for items the dictionary leaves untagged is planned for later, behind a flag. It will
  only add tags; the engine won't change.

## Sources

| Source | Feeds |
| --- | --- |
| Resume: projects, internships, jobs | items (domain, role and skill evidence); the employer name counts too, and a job or internship at a catalogue company (exact match on its name, slug or an alias, ignoring "Pvt Ltd" and ".ai"-style suffixes) counts toward that company's sector when the sector is specific |
| Resume skills list | skills, at half credit ("listed only") |
| GitHub: README + description of the top public repos (`readmes`), each repo's primary language | items; a scaffold README (`readmeTemplate`) is ignored, the description still counts |
| GitHub languages at ≥ 5% of code bytes | skills, full credit |
| LeetCode preferred language | skills, full credit |
| LeetCode, Codeforces, TUF `byTopic` | round topics |

LinkedIn is not read (most users don't have it). AtCoder and CodeChef carry no topic data.

## Score

`score = round(100 × Σ(weight × value) / Σ(weight of parts not dropped))`, then the level-gap cap.
Weights come from the **JD's** level (fresher weights when it is unknown).

| Part | Value (0–1) |
| --- | --- |
| Skills | Share of the JD `techStack` covered: 1.0 per skill *used* (a resume project/role, a GitHub repo, a GitHub language, the LeetCode language; "Data structures" / "Algorithms" / "DSA" by any problems solved), 0.5 if only in the resume skills list. A skill is also shown by one that implies it (PostgreSQL shows SQL, Terraform shows infrastructure as code, PyTorch shows machine learning) and, for web plumbing, by the role itself (backend or frontend work shows HTTP; backend work shows APIs; frontend work shows HTML and CSS): a job in full, a project at the project rate. "A / B" entries are satisfied by either side; assessment entries ("Aptitude") are left out |
| Domain | Company `sector` vs item domain tags; for a generic sector, the domains the JD's own title and description name. Best item: job/internship 1.0, project/repo 0.6 |
| Role | JD `specialization` vs item role tags, same scale. A missing specialization or a hiring-track name (TCS Ninja, Accenture ASE, Infosys SP) is a generalist role: any software role tag counts |
| Experience | Full-time months (internships excluded) vs `yoeMin`/`yoeMax`: 1 inside the range; below the minimum, linear to 0 at two years short; above the maximum, linear down to a floor of 0.5 reached at double the maximum (max + 1 year when the maximum is under a year), so over-qualification is a soft mismatch and never scores below 0.5. An open-ended range (15+ yrs) never decays. No range → the JD level's default band |
| Round topics | DSA topics in the JD's **coding rounds** (`dsa` rounds for specific topics; `dsa`, `lld` and online tests for broad asks; never system-design, behavioural or hiring-manager rounds, where "Queues" means messaging); per topic `min(best single platform's solved / target, 1)`, target by the hardest round asking for it (easy 8, medium 20, hard 40). A broad ask ("Data structures", "Algorithms", "Complexity", "Coding problems", or a `dsa` round naming no specific topic) is one **General DSA** topic: best single platform's total solved vs easy 100, medium 200, hard 400, never below the JD level's floor (intern 100, fresher 150, SDE-1 and above 200). Averaged |

| JD level | Skills | Domain | Role | Experience | Round topics |
| --- | --- | --- | --- | --- | --- |
| intern, fresher | 30 | 10 | 15 | 10 | 35 |
| sde1 | 30 | 10 | 15 | 20 | 25 |
| sde2 | 30 | 15 | 15 | 30 | 10 |
| sde3 and above | 25 | 20 | 15 | 35 | 5 |

Default bands (years) for JDs without a range: intern 0–0, fresher 0–1, sde1 0–2, sde2 2–5,
sde3 5–8, staff 8–12, principal 12–16, distinguished 15+. They live in `LEVEL_EXPERIENCE_YEARS`
(`src/domain/engineeringLevels.ts`), which also gives practice templates their range: the seed
script writes it on every template JD, and the app labels it "typical for level", never a company
requirement. Templates still never carry pay.

Every number lives in `src/domain/jdFit/config.ts`; changing one is a config edit, and responses echo
`configVersion`.

### Part status

- **scored**: both sides have data. Data that exists but doesn't match (a connected platform with 0
  solved in a topic, items without a fintech tag) scores 0 here.
- **missing**: the JD asks for it and the user has no source (no coding platform connected, no
  skills anywhere, no items at all). Counts 0 with its weight kept, plus a `hint` saying what to add.
  Experience is never missing: no full-time experience is 0 years.
- **dropped**: the JD gives nothing to match (empty stack; a generic or missing sector whose JD
  text names no domain; no DSA or coding round; no range and no level). Left out, the rest rescale,
  with a `reason`. Role is never dropped (no specialization means a generalist role), so in practice
  `score` is always a number; `null` is kept for a JD with nothing at all.

### No double counting

- Domain and role take the **best** item, and skills the best credit per skill, so one project
  listed on the resume and on GitHub counts once and cites both.
- Topics take the **best single platform** per topic, never a sum: TUF syncs LeetCode and
  Codeforces solves, and one problem carries several tags on the same platform.

### Level gap

`gap = index(JD level) − index(user level)` over the shared enum. `gap ≥ 2` → `stretch`, the score is
capped at 40 and labelled "Stretch role". A role **below** the user's level is a mismatch in itself,
beyond its experience range: the score is multiplied by `levelFactor` 0.85 one level below and 0.7
two or more below (`gap ≤ −2` is also labelled "Below your level"). An unset user or JD level →
`unknown` (no cap or factor; the role list nudges the user to set a level). The breakdown carries
`cap` and `levelFactor`, so the "Your match" tab can say why.

## Dictionary

`src/domain/jdFit/vocabulary.ts` is data only:

- **Domains**: the specific values of the company `sector` enum, with keywords (`upi`, `payments`,
  `ledger` → fintech). `it-services`, `consumer-internet`, `enterprise-software` and `other` are
  listed as generic.
- **Roles**: role families (backend, frontend, fullstack, android, ios, data-engineering,
  data-science, ml, devops, embedded, security, qa) with keywords. Backend covers systems and
  cloud-native resumes too (storage engine, consensus, DynamoDB, SQS, p99), not only web frameworks.
  Backend and frontend in one item also tag it full-stack. `SPECIALIZATION_ROLES` maps JD
  specializations onto them; a Data Scientist listing accepts data-science, ML and data-engineering work.
- **Skills**: canonical skills with aliases. `strict` aliases are common English words (`go`, `c`,
  `spring`, `express`), so they only match a whole list entry, never prose. `impliedBy` names skills
  whose use shows this one; `impliedByRoles` names role tags whose work does. A JD stack term the
  dictionary doesn't know matches itself (lowercased, whitespace collapsed); one or two characters
  long, strictly. `NON_SKILL_STACK_TERMS` ("Aptitude", "Operational excellence") never count.
- **DSA topics**: each canonical topic lists every platform's own name for it and the free-text names
  rounds use. A platform topic maps by exact name first; round topics are scanned.
- **General DSA topics** (`GENERAL_DSA_TOPICS`): broad round topics matched as the whole topic, so
  "Coding assignment" is not DSA but "Coding problems" is.

Matching is case-insensitive and whole-word: no letter, digit or `_ + # . -` directly before a
keyword, nor a letter, digit or `_ + #` directly after, so `java` never matches `javascript` and
`c` never matches `c++`. Longer keywords claim their span first ("react native" is mobile, not
React; "binary search trees" is trees, not binary search).

### Checking the score against real-looking profiles

`scripts/dev/fitPersonas.ts` holds 28 fabricated engineer profiles, three or four per level, with
different competencies and sources (resume only, LeetCode only, Codeforces, GitHub with READMEs and
merged PRs). `seed-fit-personas.ts --apply` creates them as real email/password accounts in the
configured dev databases (`<slug>@persona.interviewiq.test`, one shared password in the file; `--remove`
deletes them). `audit-fit-personas.ts --out=<dir>` scores every persona against every visible JD
through the real service and checks the matrix: shape invariants, level gaps, specialization and
domain relevance, strength order within a level, experience, and the stack items and topics nobody
can match. Run it after changing the dictionary, the weights or the targets.

### Adding a keyword

1. Add it to the right entry in `vocabulary.ts`, lowercase. Prefer specific phrases: a broad word
   (`student`, `health`, `security`) tags far more resumes than it should.
2. A keyword must not map to two tags in one table (the integrity test enforces it; `flutter` and
   `react native` are the documented exceptions, which count for both Android and iOS).
3. Add a case to `test/domain/jdFit.test.ts` if the keyword fixes a real miss.

## API

- `GET /api/v1/jd-fit?company=&level=&specialization=`: `{ configVersion, userLevel, results: [{ jdId, score, levelGap, cap }] }`
  for exactly the JDs `GET /api/v1/jds` lists with the same filters. AI-service briefs are read with
  a concurrency cap of 6 and a 3 s timeout each; a failed read only drops that JD's round topics.
- `GET /api/v1/jd-fit/{jdId}`: `{ jdId, score, levelGap, cap, userLevel, jdLevel, configVersion, parts }`,
  each part `{ key, weight, value, status, evidence[{ source, item, matched, tag }], uncovered, hint, reason }`.
  404 wherever `GET /api/v1/jds/{id}` 404s. Round topics come from the same brief the JD page shows.

Code: `src/domain/jdFit/` (vocabulary, config, tagger, profile, engine; pure), `src/services/jdFit.ts`,
`src/services/jdCatalogue.ts` (visibility and brief lookup shared with `/jds`), `src/routes/jdFit.ts`.
