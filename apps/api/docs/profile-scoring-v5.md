# Profile scoring beta v5

`PROFILE_BETA_V5_SCORING_CONFIG` (`src/domain/profileScoring/config.ts`) is the enhanced policy.
The API scores with v5 by default (`PROFILE_SCORING_POLICY=v5`). The engine-level
`DEFAULT_SCORING_CONFIG` stays `profile-beta-v4`, so persisted v4 snapshots and golden hashes replay
unchanged, and `PROFILE_SCORING_POLICY=v4` restores the old policy. Weights, curves, caps and
knowledge-base values live in configuration, so changing them is a config edit, not a code change.

## Source data is taken as correct

v5 has **no confidence weighting**. Whatever the user's resume and connected sources say is assumed
to be correct, and the user fixes anything that is wrong. The consequences:

- Every evidence item reports confidence 100. The evaluation reports 100 when it scores and 0 when
  there is nothing to score.
- Self-reported resume evidence, LLM item judgments and platform metrics differ only in what they
  measure. They are never discounted for being unverified.
- There is no verification bonus: the old LinkedIn date-corroboration sub-feature is gone.
- There is no minimum coverage for the leaderboard (`minimumCoverageByLevel` is 0 at every level):
  every scored profile that opts in is listed at its level, because missing required parts already
  count as 0 in the score. A profile with no score yet is not listed. The other former gates are gone:
  confidence, "no collector evidence" and "declared level differs".
- The AI service returns no confidence for item assessments or company context. The prompts (assessment
  v4, company context v3) spell out the exact output format, with allowed values generated from the
  validation models, so the first answer validates without a repair round.

## The rule: deterministic where possible, semantic only where needed

| Read directly (deterministic) | Needs understanding (LLM, stored, level-aware) |
| --- | --- |
| Solve counts by difficulty, topics, advanced topics, contest rating/max/percentile/rank, rating history (trajectory, volatility, participation), weekly activity | Project technical complexity, depth, originality, production readiness, engineering practices, impact significance, design trade-offs, ownership scope, scale |
| Internship/role duration and tenure (diminishing returns), recency, LinkedIn date corroboration | Internship and role relevance, technical depth, ownership level, production exposure, scale, impact, practices, outcome |
| Tech-stack breadth, deploy/test/quantified-metric mentions | Experience cross-team influence, technical leadership, strategy scope |
| Competition results: KB match + year/round/rank/participants/percentile/status from text | Company engineering context, only when the catalogue lacks the company (general knowledge, cached) |
| GitHub language bytes vs listed skills | |

The engine (`engineV5.ts`) never calls an LLM. A separate producer stores LLM judgments; the engine
reads them as inputs and combines them with deterministic sub-features through configured weights.

## Components and level weights

Each level has its own weight table (sums to 100):

| Level | DSA + CP | Projects | Internships | Work experience | Engineering dimensions | Open source | Skills + achievements |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Intern | 19 | 18 | 8 | 0 | 26 | 19 | 10 |
| Fresher | 19 | 17 | 12 | 3 | 22 | 18 | 9 |
| SDE-1 | 16 | 10 | 4 | 18 | 31 | 14 | 7 |
| SDE-2 | 5 | 4 | 1 | 24 | 55 | 10 | 1 |
| SDE-3 | 3 | 2 | 0 | 22 | 63 | 10 | 0 |
| Staff | 2 | 0 | 0 | 18 | 70 | 10 | 0 |
| Principal | 2 | 0 | 0 | 15 | 72 | 11 | 0 |
| Distinguished | 2 | 0 | 0 | 12 | 74 | 12 | 0 |

The engineering dimensions are implementation, ownership, impact, architecture, cross-team and
strategy. The rules behind the table:

- **Engineering scope outweighs open source at every level.** How well the candidate implements,
  owns and delivers work matters most.
- **Open source outweighs DSA + CP and projects at every level.** A merged contribution to a
  project other people use is the strongest independent evidence of real engineering. At entry
  levels the open-source score is driven by project reach and change depth, not PR count, so one or
  two substantial PRs score well.
- **What was built outweighs DSA.** For interns and freshers, projects, internships and work
  experience together are about twice DSA + CP. A previous internship counts (8% for interns, 12%
  for freshers), weighted for how often candidates at that level have one: a weight is how expected
  a part is, because a missing part counts as 0 (see below).
- **DSA and contests still separate candidates.** They are 16-19% at entry levels and at SDE-1, so a
  top contest rating is worth a real margin over a weak one, without dominating.
- **From SDE-1, work experience dominates.** From SDE-3, scope (impact, architecture, cross-team,
  strategy) does.
- **Core parts.** See *Core parts and the formula* below. A core part is one nothing else stands in
  for at that level; every part, core or not, is expected in proportion to its weight.

## Core parts and the formula

The score reads like a hiring rubric: every weighted part is something a candidate at that level is
expected to show, in proportion to its weight, and what is missing is scored as missing. Each level
lists its **core** parts (`v5Policy.coreComponents`): the ones nothing else stands in for (a gap in a
core part is warned about as such). Every other weighted part is **extra credit** (`role: bonus`):
less expected at that level, so it carries less weight, and a gap is a quiet 0 of that weight.

| Level | Core (nothing stands in for these) | Extra credit |
| --- | --- | --- |
| Intern, Fresher | DSA, projects, implementation | contests, internships, work experience, ownership, impact, architecture, skills, achievements, open source |
| SDE-1 | DSA, professional experience, implementation, ownership | contests, projects, internships, impact, architecture, skills, achievements, open source |
| SDE-2, SDE-3 | professional experience, implementation, ownership, impact, architecture | DSA, contests, projects, internships, cross-team, skills, open source |
| Staff | professional experience, ownership, impact, architecture, cross-team | DSA, contests, implementation, strategy, open source |
| Principal, Distinguished | professional experience, ownership, impact, architecture, cross-team, strategy | DSA, contests, implementation, open source |

The formula (`v5Policy.formula: "weighted_sum"`):

1. **Plain weighted sum.** `score = sum(weight x part score / 100)` over every part at the level,
   and a part with no current evidence counts as 0, whatever the reason: absent, its AI assessment
   failed, or the assessment has not run yet. Interchangeable evidence (the same signal on LeetCode,
   Codeforces, TUF and other platforms) still takes the best one available, so not using every
   platform is never a penalty.
   - **No fallback.** When a fresh AI assessment is needed and the call fails (or the batch budget
     runs out first), the item's older assessment is deleted, never reused. An unchanged item, level,
     prompt and context reuses its stored assessment without a call; that is the same input, not a
     fallback.
   - **Fixed split.** Implementation, ownership, impact, architecture, cross-team and strategy
     combine the resume claim (40%) and the AI judgment of the items (60%). A missing part counts as
     0; the other part never stands in for it.
   - Snapshots from older configs replay their own formula: before `formula: "weighted_sum"` the
     score was a core-part base plus a bonus lift toward 100, and before `missingCountsAsZero` an
     unassessed core part was left out as **pending**.
2. **Margin for the extraordinary.** Because every part counts at its full weight, a candidate who
   is strong where another is missing gains the whole weight difference: at SDE-1 a Guardian-level
   contest record, GSoC and merged PRs to large projects are worth 15-25 points over the same job
   with weak DSA, no open source and no achievements.
3. **Explainable.** Each component's `contribution` is exactly `weight x score / 100`, and the
   contributions add up to the score.
4. **No score yet.** There is no score until at least one core part has evidence.
5. **Coverage** is the share of the level's core weight that has evidence, shown to explain the
   score. It no longer gates the leaderboard.
6. **Inside an item.** Every feature of an assessed project, internship or job is rated if it was
   found; one that was not (the AI saw no evidence for it, no dates, no delivery signal, an unknown
   employer) counts as 0 in the item's average instead of being left out. The same applies to the
   AI judgments behind implementation, ownership, impact and the other engineering dimensions.

Composite components (`problem_solving`, `competitive_programming`, `projects`,
`internship_experience`, `professional_experience`, `skills`, `achievements`, `open_source`) are weighted means of
**all** their sub-features (`v5Policy.subFeatures`, with per-level overrides): a sub-feature no source
produced is filled in as 0 and marked `missing` in the trace. The exception is an `alternatives`
group (`v5Policy.alternatives`): sub-features that are the same signal from different places, such as a
LeetCode, Codeforces or other contest record or listed contest results, and a hackathon, open-source
programme or other recognition. Any one of them present satisfies the group; only a wholly absent
group counts as 0. Platforms that expose less (CodeChef has no topic or activity data; AtCoder's rating
colour stands in for difficulty) leave those sub-features at 0, and the warnings say so, so the
candidate can connect LeetCode, Codeforces or takeUforward. Multiple items (projects, roles) aggregate as: best item,
plus a small diminishing share of headroom for each further item (`itemAggregation`), so a weak extra
item never lowers a score and volume alone cannot reach 100.

Engineering dimensions (`implementation`, `ownership`, `impact`, `architecture`, `cross_team`,
`strategy`) combine the deterministic sentence-pattern claim with the best item's mapped semantic
features (`semantic.dimensions`, 40/60 or 50/50).

## Competitive programming (`competition.ts`)

- One provider-independent schema (`competition-v1`): difficulty bands, total solved, topics, advanced
  topics, contest {attended, rating, maxRating, rank, population, percentile, bestRank, averageRank,
  participationRate, lastContestAt}, rating history, weekly consistency, recent activity, platform level.
- Adapters: LeetCode, Codeforces, CodeChef, AtCoder, takeUforward (TUF), HackerEarth.
  Unknown platforms use the generic schema and the `generic` normalizer. `registerCompetitionAdapter()`
  adds a platform without touching the engine.
- Collectors: LeetCode and GitHub as before, plus Codeforces, AtCoder, CodeChef and TUF
  through one handle-based connection (`platform_connection`, `/api/v1/connections/platforms`).
  Analyzer specs are in `docs/sources/platform-analyzers.md`.
- TUF has no rating: its Basic/Core/Pro sheet solves are the difficulty bands, and its topics feed
  breadth. Profiles the user linked on TUF connect automatically, never replacing one the user
  connected themselves. HackerEarth has no public source and is not collected.
- **Ratings mean different things per platform.** Each platform maps its rating through its own tier
  anchors (`ratingCurve`: Codeforces Pupil/Expert/Master…, CodeChef stars, AtCoder colours, LeetCode
  Knight/Guardian). Contest performance = 50% population percentile (when reported) + 30% current
  rating curve + 20% max rating curve. Trajectory is measured in curve points, not raw rating.
- DSA (`problem_solving`): difficulty (saturating per band, medium/hard weighted), breadth, advanced
  topics, weekly solving consistency, recent solving. Breadth needs at least `2 x topicMinimum` solves,
  so a near-empty account is unknown rather than "narrow".
- Competitive programming: `leetcode_contest`, `codeforces_contest`, `other_contest` (best other
  platform), trajectory, participation consistency, contest recency, rating stability (volatility),
  competition results. Spec starting weights for entry levels; senior levels shift weight to results.
- Across platforms each signal takes the **best** platform: a second platform corroborates but can
  never add volume, and a thin second account never lowers a strong one.
- LeetCode collector additions: contest rating history and the submission calendar (counts only, no
  timestamp, so unchanged profiles keep their fragment hash).

## Competition, hackathon and OSS-program results (`competitionResults.ts`)

Knowledge base entries (ICPC, IOI, INOI/ZCO, Code Jam, Kick Start, Hash Code, Hacker Cup, TCO,
CodeVita, SnackDown, HackWithInfy, Smart India Hackathon, Solution Challenge, Imagine Cup, Space Apps,
ETHGlobal, HackMIT, Hack the North, MLH, GSoC, Outreachy, LFX, MLH Fellowship, GSSoC, Hacktoberfest)
carry organizer, geography, approximate participants, selection structure, rounds (with the status each
implies), difficulty, reputation and team type. Adding one is a data change.

Results are extracted deterministically from achievement lines (resume and selected LinkedIn
sections): KB alias, year, round, rank, participants, top-x%, team, and outcome. The ladder is
participation < qualification < selected < finalist < completed < top-ranked < winner. A selective open-source programme (GSoC, Outreachy, LFX) from an earlier year is scored as completed, since selection was the gate; this year's is scored as selected. A rank inside one
stage interpolates only toward the next stage, a podium in the final stage sits between top-ranked and
winner, and the result is scaled by the event's difficulty/reputation (unknown events x0.6). Results are
permanent (no decay), SELF_REPORTED from resumes and DIRECT only from a future collector.
CP contests feed `competitive_programming.competition_results`; hackathons, OSS programs and other
recognition feed `achievements`.

## Open source (`openSource.ts`)

The GitHub collector also searches merged pull requests the user authored in public repositories
outside their own namespace (`author:X is:pr is:merged is:public -user:X`). It stores repository,
rounded stars, lines, files, a docs-only flag, the merge date and a clipped title. File paths are read
only to set the docs-only flag; private repositories are never stored.

A PR counts only when:

- the change is non-trivial: at least 10 changed lines or 2 files (there is no star floor:
  `ossMinRepoStars` is 0, and the project's reach is its own sub-feature);
- it is not a typo or formatting fix, and a docs-only change has at least 100 lines.

Sub-features:

| Sub-feature | Intern/Fresher | SDE-1 | SDE-2/3 | Staff+ |
| --- | --- | --- | --- | --- |
| `merged_contributions`: `100·(1−0.5^(n/5))` over qualifying PRs | 15 | 20 | 30 | 25 |
| `project_reach`: log stars, saturating at 10k; best repository plus diminishing others | 35 | 30 | 25 | 30 |
| `contribution_depth`: log lines, saturating at 1,000; best PR plus diminishing others | 35 | 30 | 20 | 25 |
| `distinct_projects`: n/5 | 5 | 10 | 15 | 15 |
| `recency`: 365-day half-life from the latest merge | 10 | 10 | 10 | 5 |

So one substantial contribution to a widely used project beats many small PRs to tiny ones.

## Internships, professional experience and company context

Resume experience entries are classified deterministically (intern/trainee/co-op/apprentice titles are
internships). Internship sub-features: technical depth 25, role relevance 15, ownership 15, production
exposure 10, impact 15, company context 5, duration 5 and practices 5, plus outcome and scale as minor
signals. There is no verification sub-feature, because the data is taken as correct. Duration uses a 3-month half-life
(1 month ~21, 3 months 50, 6 months 75, 12 months ~94). From SDE-1 up, internships also count toward
professional experience at a discount (0.6 SDE-1 -> 0.1 Principal). An item is only scored when it has
at least one substantive (semantic or structured) sub-feature: existence, dates or keywords alone never
score.

Company context comes from the knowledge base, never a name or placement tier: catalogue research
first, then a cached general-knowledge entry from the AI service (`/profile-scoring/company-context`,
company name only), refreshed every 180 days. When the model does not know the company, the AI
service searches the web for it with Exa and extracts the same facts from the results only. Each fact
must cite at least one returned result, otherwise the company stays unknown. Size is
explainable: the answer carries the stated headcounts (total and engineering) and a quote of where they
come from, and the band (LinkedIn-style: ... 51-200, 201-500, 501-1000, 1001-5000 ...) is worked out
in code from the stated number. When sources disagree, the most recent and most specific count wins
(e.g. a current LinkedIn count over an old Crunchbase snapshot); sources are never averaged. Only the company name is
sent to Exa and the LLM. "Force re-assess" in the admin live trace also refreshes cached lookups. The score uses engineering
scale, product vs. services, technical domains, stage and documented internship selectivity. Its share of
any composite is validated to stay <= 5%, so strong work at an unknown company beats weak work at a
famous one.

## Semantic producer (`services/profileScoring.ts`, `semantic.ts`)

- Runs in three places, always with the rubric level and context derived server-side:
  1. **The weekly scoring batch**, before each user's calculation (bounded by
     `PROFILE_SCORING_SEMANTIC_CALLS_PER_BATCH`, default 200). Not counted against a user's runs below.
  2. **Recalculate** (`POST /users/me/profile-score`, the button on the score card and the explainer): re-assesses
     new or changed items (unchanged ones reuse their stored result), then rescores. It runs in the background:
     the request returns at once with `assessment.inProgress: true` and the card polls until the new snapshot is
     there.
  3. **The first assessment** for a user who has never had one (none stored, none ever completed), started
     when onboarding completes and, as a catch-all, on the first score view
     (`PROFILE_SCORING_AUTO_ASSESS`, default true). A failed automatic try is not repeated for 6 hours.
- **Limit (decided 2026-10-23): 3 runs per user in a rolling 7 days**, the automatic first run included. The
  weekly batch is not counted. It is kept in Mongo (`profile_scoring_assessment_runs`, one document per user),
  taken with one atomic upsert, so restarts and API replicas share it. A run that stored no new assessment
  (everything reused, no items, or every call failed) gives its slot back. Over the limit: 429
  `profile_scoring_recalculation_limit`; `GET /users/me/profile-score` returns `assessment`
  (`available`, `inProgress`, `limit`, `remaining`, `nextAvailableAt`) so the UI can say how many are left or
  when the next frees up. An in-flight marker expires after 10 minutes if its replica dies.
- The former `POST /users/me/profile-score/assess` endpoint and its in-memory 3-per-hour limiter were removed.
- One AI-service call per item (`/profile-scoring/assess`, prompt v5, Groq `openai/gpt-oss-120b` first, then
  `gpt-oss-20b`, Cloudflare and Google): the minimized item, the user's
  level, target role and years of experience, and that item type's feature rubric. The item's bullets
  are packed in order into up to 8 excerpts of 800 characters, so a long entry is sent whole. Projects
  that match a public GitHub repository also send README excerpts, cut at sentence ends. A README
  that is still its starter tool's default text (create-next-app, Vite, Create React App, Flutter,
  Angular CLI, Expo, create-t3-app, SvelteKit; `readmeTemplates.ts`, matched by word sequences, with
  a title or version allowed) is treated as no README and not sent. Every
  returned value must quote the supplied evidence. Models copy quotes loosely (tidied spacing,
  swapped dashes, dropped markdown, "..." shortening), so the AI service matches each quote while
  ignoring those differences and replaces it with the verbatim input text. The API then checks
  the quotes exactly. A quote that matches nothing is dropped. A feature left without a quote is not
  stored, and the engine counts it as 0.
- Stored per item in `profile_scoring_semantic_assessments`, keyed by item content hash and level, never
  as a profile fragment (so nothing leaks into the descriptive profile or its API). Unchanged items are
  reused; edited items are re-assessed and their stale records pruned. A failed call deletes the item's
  older assessment, so the item counts as 0 until a call succeeds.
- The engine uses an assessment only when item hash, level and prompt version all match the item being
  scored. Snapshots freeze the assessments they used, so scores replay exactly.
- Privacy: names, contacts, employers, institutions and locations are redacted with the same identity
  list as the scoring input; the employer name only reaches the company-context call, alone.

## Debugging a score

Intelligence → Live profile runs one user end to end and streams each step: sources, every LLM
call, the snapshot, then every engine computation. The engine's optional debug sink
(`evaluateProfile(input, config, debug)`) reports each step and never changes the evaluation. "Copy
full trace for Claude Code" produces a single Markdown report with full detail (only credentials are scrubbed). Details are in
`profile-scoring-beta.md` under *Admin live trace*.

## Evidence model

Every v5 evidence item records `feature`, `source`, `path`, `rawValue`, `normalizedValue`,
`evidenceType` (DIRECT, DERIVED, INFERRED, SELF_REPORTED), `scoreContribution`, `sourceMetadata`,
`sourceTimestamp` and `algorithmVersion`. The type says where the value came from: platform metrics
are DERIVED, resume claims SELF_REPORTED, and LLM judgments and model-knowledge company context
INFERRED. It never discounts the value. `confidence` is kept for contract compatibility and is always
100.

## Open decisions and limitations

- HackerEarth has no public source. ICPC and other contest results come from resume achievements.
- LinkedIn experience is used for claims, not semantic item assessment. GitHub-only repositories are
  README context for matching resume projects, not separate items.
- The assessment and company-context prompts, platform curves and KB difficulty/reputation values are
  still drafts for human review.
- v5 snapshots written before this revision do not replay identically (v5 had not shipped; v4 replay
  is unaffected).
