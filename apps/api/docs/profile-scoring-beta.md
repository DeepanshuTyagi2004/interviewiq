# Profile scoring beta v4

This is the explicitly approved **provisional numeric profile assessment**. It has a separate
contract from descriptive profile synthesis, interview results, mock-loop readiness and interview
leaderboards. It is not calibrated against job performance or hiring outcomes. A numeric value is
an evidence-rubric summary, not a prediction, credential or recommendation.

The enhanced v5 policy (the API default; `PROFILE_SCORING_POLICY=v4` restores the old one: per-platform competitive programming,
competition results, internship and experience intelligence, and stored level-aware semantic
sub-features) is documented in [`profile-scoring-v5.md`](profile-scoring-v5.md). This document
describes v4, which remains the default and the replay policy for its snapshots.

## API and replay

- `engine.ts`: `evaluateProfile(input: ScoringInput, config?: ScoringConfig): ScoreEvaluation`.
- `config.ts`: frozen eight-level `DEFAULT_SCORING_CONFIG`, eight-level `LEGACY_V3_SCORING_CONFIG` and `LEGACY_V2_SCORING_CONFIG`, six-level `LEGACY_V1_SCORING_CONFIG`,
  `validateScoringConfig(config): void` (throws).
- `adapters.ts`: `buildScoringInput(profile, fragments, { asOf, declaredLevel, version })` returns deeply
  frozen JSON; `normalizeScoringInput(input, version)` applies the version-specific defensive whitelist.
  Public helper defaults intentionally remain v2-compatible. The engine and scoring service explicitly
  pass their saved/current config version, so unsupported LinkedIn payloads still normalize to `{}` in v1/v2.
- `achievements.ts`: `normalizeAchievement` and `ACHIEVEMENT_REGISTRY` expose the small extensible taxonomy.
- `experience.ts`: `experienceMonths` is an inclusive month-interval union; `semanticClaims` extracts
  sentence-level conjunctions, not keyword frequency.

### Admin live trace

`POST /api/v1/intelligence/profile-scoring/live` is an ADMIN-only endpoint. Its body is strictly
`{ "userId": "<uuid>", "forceReassess"?: boolean }`. It runs what the weekly batch runs for one user
and streams every step as NDJSON, one `LiveTraceEvent` per line:

1. **User.** Loads the user and their identities, which are used for redaction.
2. **Sources.** Each stored fragment is marked used or excluded, with the reason. Collectors are
   never called.
3. **AI item assessment** (v5 with an AI service):
   - each LLM call, with its redacted request, its response, the features kept and dropped, its
     duration, and on failure the error with its stack;
   - reuses of unchanged assessments, and company-context lookups with how each resolved (cached,
     catalogue or model).

   `forceReassess` sends every item to the LLM, even unchanged ones.
4. **Snapshot.** The weekly snapshot is written, or reused when the input is unchanged.
5. **Engine.** The deterministic engine runs with a debug sink over the snapshot's frozen input, so
   every step explains the stored score:
   - each platform's normalized signals, and which platform won each signal;
   - competition results;
   - each item's sub-features;
   - each component's sub-feature breakdown (or item aggregation);
   - the open-source PRs counted and excluded;
   - the formula and leaderboard eligibility.

The last line is either a `result` event, whose `data` is the full trace, or an `error` event.

Validation errors and an unknown user are answered with ordinary JSON errors before streaming
starts. The trace keeps full detail for admin debugging: the user's name and email, the stored
profile, raw source data, employer names and the exact LLM requests and responses. Only
credential-looking strings are scrubbed, and the password hash is never included. The AI service
itself still receives the minimized, identity-redacted requests.

The Intelligence → Live profile tab shows the stages, a live log, every LLM call and the final
breakdown. Its "Copy full trace for Claude Code" button builds one Markdown report from whatever has
arrived, so it also works for a failed or stopped run. The report covers errors with stacks, stages,
LLM payloads, components, evidence, the event log and the final trace JSON.

The former `POST /api/v1/intelligence/profile-scoring/recalculate` admin batch endpoint and its
Diagnostics buttons were removed. The weekly scheduler still runs the batch.

### Admin live LinkedIn extraction preview (retired)

The `POST /api/v1/intelligence/profile-scoring/live/extraction-preview` endpoint and its "Run
Firecrawl + Exa now" action were removed when LinkedIn moved to user-uploaded PDFs. PDFs are not
stored, so there is nothing to re-extract; the live trace's source and evidence cards show what a
confirmed LinkedIn import contributes.
`stackTrace` and `copyText` are identical safe reports. Missing saved/confirmed URLs return
`400 linkedin_url_missing`; a disabled LinkedIn import returns `503 linkedin_import_disabled`.

No engine clock, network, database or LLM calls are used. `asOf` must be an explicit valid ISO date
or timezone-qualified timestamp; it is normalized to UTC. Persist the exact normalized input,
full configuration, engine version, hashes and output in historical snapshots. Replays must supply
the stored `asOf`, not today's date. Canonical JSON sorts object keys; set-like input arrays are
sorted and deduplicated. One observation per source is selected deterministically, preferring the
latest valid observation at or before `asOf`; hash order breaks equal-time ties. Fragment hashes
are recomputed over the sanitized payload, rather than trusting a hash of a larger raw response.

The current engine version is `profile-beta-v4`. V4 accepts Firecrawl and historical Exa URL receipts;
v3's Exa-only whitelist, normalization, warning text, numeric policy and evidence paths remain frozen.
It supports selected LinkedIn career claims and cross-source semantic deduplication, with exactly
the v3/v2 weights, normalizers and eligibility gates. Complete v3 Exa input/evaluation/config golden
hashes and persisted frozen replay are covered by regression fixtures.
V2 added Intern and Distinguished to the canonical eight-level engineering enum. Frozen
`profile-beta-v1`, `profile-beta-v2` and `profile-beta-v3` configurations retain their original normalization, semantics
and unsupported-source behavior for deterministic replay. V1 rejects new levels/components; v2,
v3 and custom current versions require all eight rubrics. Pre-upgrade golden hashes cover the complete
v1 evaluation at all six declared levels and v2 at all eight, plus both undeclared assessments and
unsupported LinkedIn input/evaluation hashes.
Any semantic rule, normalization behavior or default formula change after release requires a new
version and regression fixtures. Custom
configuration changes produce a new `configHash` even when an explicit version remains the same.
Compare cohorts only within the same level, week, engine version **and configuration hash**.
Never overwrite historical evidence/configuration to make old results match a new policy.

## Input minimization

The adapter admits only a fixed profile shape and source-specific fields. User identifiers,
full name, email, phone, location, employer, institution, detected links, target role/JD, resume
filename, provider username/login/avatar and raw payloads are excluded. Known profile identity
values are also redacted from prose. URLs, email patterns, phone-looking patterns, control
characters and secret-looking strings are removed; project links are always null. Text has a
2,000-character bound. Do not regard regex-based free-text redaction as a general-purpose PII
detector: callers must use this adapter, and avoid adding identity-bearing fields to the whitelist.
Education degree/field/grade/years are retained as minimal contextual data but **never scored**.
Company prestige, institution prestige, demographics, target roles and titles never contribute.

V3/v4 support resume/profile, GitHub, LeetCode and selected LinkedIn career claims. Frozen v1/v2
continue to discard LinkedIn and report it unsupported. For v4, Codeforces and
other source payloads remain unsupported. V5 adds a provider-independent competition schema with
LeetCode and Codeforces adapters; v4 replay still reports those newer sources as unsupported.
Missing supported sources are reported as missing with warnings.
Invalid/future source observations are excluded with warnings.

### LinkedIn snapshot

The current product path is an owner-uploaded LinkedIn "Save to PDF" file (see `linkedin-import.md`):
the AI service extracts evidence-gated claims, and the owner previews and confirms selected sections.
Scoring only reads the resulting local `LINKEDIN` fragment; it performs no provider retrieval,
network call or inference. A PDF fragment records `importMethod: "pdf"`, `importedAt` (confirmation
time, also the fragment observation time), `partial: true`, selected career `profile` fields, a
section manifest and quote provenance whose `file` is the display filename (sanitized by the scoring
whitelist). Legacy URL fragments from the retired Firecrawl import (`importMethod: "url"`,
`provider: "firecrawl"`, historical `exa`, `retrievedAt`) remain readable and scored under the same
rules until replaced. URL snapshots are always partial, even if an untrusted payload claims otherwise.

The scoring whitelist excludes `sourceUrl`, names, employers, institutions, locations, URLs and raw
section entries. It keeps selected section keys, minimally sanitized claim sentences, relevant date
intervals, selected skill names and matching sanitized provenance quotes/paths. The stored frozen
input and `inputHash` never include the LinkedIn URL. Account/profile identity values are redacted
from prose, including for users with no candidate profile. This is narrow identity/regex minimization,
not a general-purpose personal-information detector.

Only selected About, experience bullets and project descriptions/bullets enter the existing
sentence-level semantic registry. Headline/title do not score or classify. Selected skills can be
corroborated by existing positive GitHub language bytes under the unchanged skills policy; listing
skills alone earns no points. Education, certifications, publications, patents, courses, languages,
volunteering and achievement strings are contextual and do not acquire new numeric rules. No
followers, connections, employer prestige or inferred award outcomes contribute.

V4 URL claims require a Firecrawl or historical Exa receipt and valid retrieval, confirmation and
observation timestamps. Frozen v3 accepts only Exa. Reused drafts/confirmed snapshots retain the
original retrieval timestamp; opening a new review never makes old evidence fresh.
Retrieval cannot be later than confirmation or the fragment observation; neither confirmation nor
observation can be after `asOf`. Freshness is anchored to retrieval, never to a later confirmation.
Claims older than `observationHalfLifeDays` (default 180 days), invalid/future dates, missing retrieval
dates or unknown providers are excluded and the source is marked missing. Historical archive/PDF/text
claims retain their v3 import-time freshness behavior. Missing/partial sections stay unknown, not zero.

Every LinkedIn semantic claim remains **self-reported, baseline confidence 45%**. Provider retrieval
is provenance, not verified employment or OAuth identity proof; no `verified`, confidence or
employment-verification flag can turn it into collector evidence. LinkedIn-only scores cannot meet
the existing collector gate. Source diagnostics report method, provider, retrieval/confirmation times,
freshness, partial status and the self-report limitation without displaying the URL.

V3 consolidates identical component/scope/sentence claims across LinkedIn and resume into one
evidence item, retaining source-qualified `paths` and matching sanitized `provenance`. Repeated
employment/project rows normalize deterministically and cannot earn more evidence or score.
Strongest signal still wins per component; duplicate source claims never increase confidence.
Experience months use one inclusive interval union across the two sources, never summed tenure.
Import revision/removal/reimport invalidates the service cache and live cohort fingerprint through
existing fragment state, without changing historical snapshots or scheduler behavior.

## Aggregation, unknowns and eligibility

Weights are percentages and must sum to 100 for each of the eight levels (six only for frozen v1
replay configs). Weights must be finite,
nonnegative, and reference known components. All required normalizers must be positive and
finite; rating ceiling must exceed floor. Coverage/confidence thresholds must be in `(0, 100]`;
minimum cohort is an integer of at least 2. Default beta gates are **60% coverage, 60% confidence,
minimum cohort 5**. These gates are provisional policy, not statistical calibration.

For positive-weight components with evidence:

```
availableWeight = sum(original component weights with evidence)
score = sum(componentScore * originalWeight) / availableWeight
coverage = availableWeight
confidence = sum(componentConfidence * originalWeight) / availableWeight
contribution = componentScore * originalWeight / availableWeight
```

Scores, confidence and coverage are on a 0–100 scale, rounded to two decimals for presentation.
Compute the aggregate from unrounded component signals. Missing evidence is **unknown** (`null`),
not zero; available explicit zero counts are genuine evidence of zero attainment/activity for that
metric. No available component means `score: null`, `status: insufficient_evidence`. A small amount
of evidence can yield a high provisional score alongside visibly low coverage. A non-null score
does not itself imply eligibility. Duplicate claims cannot accumulate credit: strongest supported
signal wins for semantic/achievement components.

Collector evidence has baseline confidence 90%; self-reported prose and structured resume claims
have 45%. Confidence expresses provenance certainty in this policy, not a probability of skill.
Collector provenance does not independently verify account identity or employment. Component
confidence is the mean of its evidence confidences. Eligibility requires coverage/confidence
gates **and at least one used component containing sufficiently current collector evidence**.
Unscored PR/activity context cannot satisfy that gate. Declared/assessed-level mismatches require
review and are ineligible. Cohort-size gating is performed by the leaderboard service, because
the pure engine has no cohort input; downstream code must enforce `minimumCohort` separately.
Opt-in and privacy gates also belong to the service.

## Eight rubrics

| Level | Components and default weight percentages |
| --- | --- |
| Intern | coding 20, topics 15, activity 15, skills 10, learning-stage implementation 30, achievements 10 |
| Fresher | coding 30, topics 15, contest 10, activity 10, skills 10, implementation 15, achievements 10 |
| SDE1 | coding 20, topics 10, skills 10, activity 10, implementation 25, ownership 15, achievements 10 |
| SDE2 | coding 10, skills 10, implementation 20, ownership 25, impact 20, architecture 15 |
| SDE3 | implementation 10, ownership 25, impact 25, architecture 30, cross-team influence 10 |
| Staff | ownership 10, impact 25, architecture 30, cross-team influence 35 |
| Principal | impact 20, architecture 20, cross-team influence 20, organizational strategy 40 |
| Distinguished | impact 15, architecture 15, cross-team influence 10, organizational strategy 30, cited industry contribution (unverified) 30 |

Intern emphasizes learning-stage implementation and breadth/activity, not Fresher contest performance.
It is a separate user-selected rubric, not a Fresher alias. The existing evidence-assessment floor
remains Fresher and cannot establish internship/learning-stage scope independently, so Intern receives
explicit mismatch/review guidance and is currently ineligible for automatic ranking.

Distinguished adds a distinct industry-contribution component rather than mapping to Principal.
A contribution can receive provisional points only from an explicit sentence citing an RFC,
authorship/standardization, adoption by at least two independent organizations and a quantified
engineering outcome. Its evidence path and full sanitized claim are retained; both the evidence
and component label say unverified. Absent cited claims remain unknown and receive no points.
The engine never automatically assesses Distinguished from titles, prose or broad strategy claims;
assessment remains capped at Principal. Current collectors do not independently verify distinguished
scope, so the rubric is explicitly review-gated and ineligible for automatic ranking.

Staff emphasizes multi-team architecture/influence. Principal introduces a separate dominant
organization-wide strategy component; these are not relabeled competitive-programming rubrics.
Today's collectors cannot verify senior architecture, employment or organizational strategy.
Consequently self-report-only senior rubrics cannot meet the default confidence/verified-evidence
gates. This limitation is intentional and must be visible; do not fill missing components with
repository counts or pretend GitHub stars prove system complexity.

## Numerical component policy

### LeetCode

- Difficulty attainment: Easy contributes 15%, Medium 50%, Hard 35% within `coding`. Each is
  `100 * min(count / cap, 1)` with default caps 100/150/75. Missing difficulty fields are excluded
  from this inner denominator, not assigned zero. Counts must be nonnegative integers <= 10 million.
   Coding confidence is scaled by the observed inner difficulty weight: easy-only evidence receives
   15% of the baseline confidence, not full distribution confidence. This measures bounded exposure
   to difficulty, not originality or interview problem-solving skill.
- Breadth: distinct case-insensitive topic tags with at least 5 solves, capped at 10 topics;
  score `100 * min(qualifiedTopics / 10, 1)`. Duplicate tags take their maximum count, never a sum.
  Topics are not known to be independent and this is explicitly an exposure proxy.
- Contest: require a positive integer attended-contest count. Valid rating is normalized linearly
  from 1200 to 2400 and clamped to 0–100. When valid integer rank and population exist, population
  must be >=2 and rank in `[1, population]`; percentile is
  `100 * (population - rank) / (population - 1)`. Average the available rating/percentile measures.
  Provider `topPercent` alone is not accepted without a valid rank denominator. Never award a
  percentile for rank 0, an absent population or a single-person denominator. A null contest is
  unknown rather than a bad score.
- Recent activity: the collector samples at most 20 accepted submissions, so the measure is **not**
  total monthly solves or unique problem count. Require integer count 0–20. Base score saturates at
  15. Multiply by `2^(-windowAgeDays / 30)`; confidence has the same factor. Windows older than 90
  days, future windows and invalid windows are unknown. Explicit `recentActivity.windowAsOf`
  anchors an original window so a later fetch cannot resurrect historical activity. Otherwise the
  collector observation date anchors its freshly computed window. The existing collector recomputes
  last-30-day activity during every successful run; replay code must not independently bump
  `fetchedAt` on a stale copied payload. Mutable contest evidence confidence decays with a 180-day
  half-life; its historical performance score does not decay. Permanent solve/topic attainment does
  not decay merely because it was observed long ago.
- A `partial` collector flag currently does not identify which optional query failed. Conservatively
  drop all recent activity on a partial snapshot, including defaulted zero. Present valid contest
  fields remain usable; missing contest fields are unknown. Missing required solve fields remain
   unknown, rather than being synthesized from totals. The collector retains legacy descriptive
   counters, but now records `scoringAvailability` when required rows are missing/malformed or
   recent-submission data is absent. The scoring adapter converts those default counters to null.
   Legacy fragments without that metadata cannot recover information previously discarded; a normal
   successful refresh supplies current evidence. No live refresh was performed as part of implementation.

### GitHub

Positive language byte/percentage evidence can corroborate a case-insensitive exact listed skill;
the component score is a fixed 70, independent of language count, byte volume, stars or repo count.
This is corroboration, not proficiency. A GitHub account alone, or uncorroborated language list,
does not score. External PR count is retained only as context with a trace explaining that it is
activity, not quality. The current collector lacks dated PR activity, READMEs, merged state,
review acceptance, tests and source analysis. Therefore `topRepos`, raw commits, contribution
counts, stars and repo names contribute **no implementation, complexity, architecture or OSS quality
score**. GitHub activity is not assigned a fabricated quality component.

### Semantic resume/selected LinkedIn career claims

Match conjunctions inside a sentence, rather than count words or join unrelated bullets into
synthetic claims. Headline, titles and skills lists do not enter this extractor. Negation,
aspirations and assisting/observing language are excluded conservatively.

- Implementation requires a delivery verb and engineering artifact: 45 for built/implemented
  artifact, 70 with deployment/launch/production evidence, 85 with deployment and testing evidence.
- Ownership requires owned/led/drove/responsible-for plus an engineering artifact: 65, or 85 when
  end-to-end/on-call/incident/SLO context is explicit.
- Impact requires an improvement/reduction/scaling verb, engineering artifact and quantitative
  metric/unit (e.g. 40% latency reduction): 80. Bare adjectives and arbitrary numeric dates do not qualify.
- Architecture requires designed/architected/migrated/redesigned plus a system artifact and
  distributed-system/scaling/reliability/trade-off context: 80.
- Cross-team influence requires explicit multi-team/organization scope plus an influence action
  and technical/engineering object: 75 multi-team, 85 organizational.
- Strategy requires organization-wide scope, an explicit strategy/roadmap leadership action,
  and adoption/investment/business/migration/multi-year context: 85.
- Industry contribution (v2 and later) requires authored/co-authored/standardized, an explicit RFC
  number, `adopted by N independent organizations/companies` with N >= 2, an engineering artifact
  or latency/throughput/reliability context, and a quantitative improvement claim in the same
  non-negated sentence: 70. Citation and adoption are self-reported, not independently validated.
  The label remains unverified and this component never promotes assessed seniority.

These are self-reported textual claims with 45% confidence, **not verified outcomes**. The small
English pattern registry will miss real evidence and can be gamed; it is not a natural-language
understanding or fraud-detection system. Never claim it verifies senior competence.

## Level classification and experience

The user profile's `level` is the canonical user-selected engineering level, independent of
`targetRole`/`targetJdId`. It chooses the rubric only; evidence-assessed level is returned separately and a
mismatch is flagged. Conservative evidence floor is `fresher` with confidence 0 when nothing
classifiable is supplied, which is not a conclusion that an experienced person is junior.
Progressively require:

1. SDE1: implementation and explicit ownership claims.
2. SDE2: the above plus service-or-wider ownership and quantified engineering impact.
3. SDE3: the above plus architecture/trade-off/scaling claims.
4. Staff: the above plus multi-team architecture scope and technical influence.
5. Principal: the above plus organization-wide strategy and organization-wide measurable impact.

Intern is not inferred from a Fresher assessment floor; the distinction is explained in mismatch
guidance. Distinguished is not inferred from organizational strategy or cited claims alone; its
industry scope remains unverified and review-gated. Neither new rubric aliases another wire level.

Any classification based on these self-reported career claims is capped at 45% confidence. Titles, target role,
institution/employer and years of experience are never sufficient or used as shortcuts. Experience
months are traceable contextual evidence only. Parse strict years, ISO year-month/full dates or
English month-year, with `Present`/`Current`/`Now` anchored to `asOf`; union overlapping inclusive
month intervals. Invalid, missing, future and reversed dates are excluded with warnings. Full-date
reversals/future days are rejected even within one month. No double-counted overlapping roles,
fabricated fallback dates, or implicit `Date.now()`.

## Achievements and knowledgebase extension

Plain achievement strings are unverified narrative and award no points, including strings
containing `winner`, ICPC, GSoC or prestigious event names. Structured resume fragment metadata
is supported with explicit `event`/`name`, `kind`, `outcome`, optional integer rank/population/year
and scope. Strings are never promoted to structured wins. Caller `verified: true` is ignored.
Future achievement years and invalid rank/population pairs are excluded.

The small registry currently recognizes exact aliases for GSoC, Outreachy, ICPC and hackathon;
unknown events may use explicit `competition` or `oss_program` kinds. Recognition only classifies
the achievement type and canonical event ID, and gives **no named-event bonus**. Participation
is 25, finalist 50, explicit winner 70, explicit completed OSS program 70. A valid competition
rank/population pair uses `25 + 55 * (population-rank)/(population-1)` for population >=2.
Strongest structured claim wins, with 45% confidence and no decay of permanent completion.

Extending the registry requires reviewed aliases, provenance/outcome requirements, temporal
semantics and regression examples. Do not add prestige-based event points. A future trusted
achievement collector must implement a source whitelist, provenance validation and actual
verification before changing confidence from self-reported. Neither a metadata flag nor a new
fetch timestamp proves an old achievement. Adding provider support also requires an analyzer
specification, collector and honest supported-source registration; registry recognition is not
permission to score an unsupported platform's raw payload.

## Checks and remaining limitations

Targeted fixtures exercise deterministic order/hash/freeze behavior, PII minimization, absent vs
explicit zero evidence, difficulty saturation/breadth deduplication, invalid percentile denominators,
partial query failure, unsupported sources, conservative classification, distinct Staff/Principal
and Intern/Distinguished focus, all-eight evaluation, v1/v2 golden replay hashes, union tenure,
activity-window replay, achievement provenance and eligibility/config guards. LinkedIn fixtures cover
selected-only URL claims, About trace/provenance, forged verification flags, actual retrieval versus
confirmation freshness, URL/identity minimization, duplicate resume/import claims and unchanged collector
gates. Local persistence fixtures cover frozen replay, diagnostics, import removal/reimport cohort
invalidation and old unsupported-source snapshots without provider calls.

Major unresolved calibration gaps: no outcome-trained weights or validated confidence probabilities,
no employment/architecture verification, no complexity analysis, incomplete upstream error
granularity, sampled LeetCode activity, exact-match language aliases, English-only semantic patterns,
free-text redaction limitations and collector-account identity verification. Leaderboard ranking
must not present these provisional scores as equivalent across different evidence coverage,
rubrics, versions or configurations.

## Application workflow and storage

The API composes the engine with local candidate profiles and currently connected source fragments.
Fragments older than a new connection are excluded; disconnected LeetCode/GitHub data cannot keep
a profile in the leaderboard. Source collection and AI inference are never triggered by scoring.

| Endpoint | Result |
| --- | --- |
| `GET /api/v1/users/me/profile-score` | Lazy assessment cache plus up to 52 stored snapshots and private settings |
| `POST /api/v1/users/me/profile-score` | Recalculate: re-runs the AI item assessment for new or changed items in the background (3 runs per rolling 7 days, see `profile-scoring-v5.md`), then rescores. Idempotent for the same week, configuration and input |
| `PATCH /api/v1/users/me/profile-score/settings` | Legacy nullable declared-level bridge to canonical profile level, plus leaderboard participation |
| `GET /api/v1/profile-leaderboard?level=fresher&limit=25` | Current same-level eligible opt-in cohort; no evidence or user IDs |
| `GET /api/v1/intelligence/diagnostics?userId=<uuid>` | ADMIN read-only replay, local source, formula and job checks |
| `POST /api/v1/intelligence/profile-scoring/live` | ADMIN one-user run streamed as NDJSON: sources, every AI-service call, snapshot, every engine step, then the full trace |

Mongo collections are `profile_score_snapshots`, `profile_scoring_settings`, `profile_scoring_jobs`,
`profile_scoring_leases` and `profile_scoring_assessment_runs`. The snapshot fingerprint includes
`SCORING_ENGINE_REVISION` (`domain/profileScoring/config.ts`): bump it when scoring code changes without a
config change (a parser fix), so cached snapshots are recomputed on next read rather than served stale until
the week turns. Stored assessments are part of the input, so new assessments always produce a new snapshot. No scoring Postgres migration is needed. Normal startup creates the
Mongo indexes. Snapshot insertion is idempotent by user/week/config/local-input fingerprint;
unchanged GET/POST calls preserve the first frozen `asOf` and do not fabricate changes. Profile,
connection, privacy and scoring-setting revisions invalidate the current cache. Same-timestamp
snapshots are resolved by current input fingerprint, never arbitrary hash ordering.

`CandidateProfile.level` is the sole current user-choice field. Scoring reads it on every request
and includes the effective level in its frozen input/fingerprint. A later Profile edit changes the
next score read and invalidates stale cohort membership without rewriting earlier snapshots.
`settings.declaredLevel` in service responses is the effective profile level, not a competing choice.

For legacy profiles that have **no own `level` field**, the old scoring setting is a read fallback.
Candidate-profile GET and omitted-level saves use that same fallback without backfilling on read,
so the profile and score cannot display different active choices during the transition.
Known saved aliases normalize on read; arbitrary saved labels resolve to unknown, never invented
seniority. An explicit profile `level: null` or unknown saved profile label blocks fallback: clearing
a profile must not resurrect an old declared value. New API writes require canonical enum values.
The legacy settings PATCH updates an existing profile atomically through `patchLevel` (level and
updatedAt only), preserves all other details, and clears its old compatibility scalar to null.
Leaderboard opt-in remains a scoring setting. Before any profile exists, the legacy PATCH can retain
a compatibility value; once the profile has its own level field, that field takes precedence.
No GET performs a migration/backfill or rewrites historical inputs.

The Live Profile Calculation Intelligence tab selects a user through the admin user list and runs
the streamed live trace described under *Admin live trace*.

Weekly scheduling is independent of interview preparation: `PROFILE_SCORING_SCHEDULER_ENABLED`
defaults to true. Startup performs a current-week catch-up and hourly polling checks whether the
UTC Monday generation is due. A durable five-minute renewable lease serializes replicas and
explicit admin batches; failed/expired runs remain visible and can be retried. An interrupted rank
finalization resumes its saved cohort plan rather than mixing populations. Completion records one
coherent historical ranking generation; score reads decorate current ranks without rewriting history.
Missed historical weeks are not backfilled with invented old evidence.

Competition rank is `1 + count(scores strictly greater)`. With `n >= minimumCohort`, empirical
midrank percentile is `100 * (count(strictly below) + (count(equal)-1)/2) / (n-1)`, rounded to one
decimal. Singleton/small cohorts have null percentile; the UI withholds their rank too. Historic
weekly score/rank movement is shown only under the same level, version and config, with cohort size
and an explicit warning that the eligible population can change. Raw scores across levels are not compared.

Leaderboard participation defaults false. Existing account privacy `hidden` excludes the profile;
`anonymous` uses a keyed stable pseudonym; `name` displays the account name only after participation
opt-in. Account export includes own scoring settings, minimized frozen input/config/snapshots and
relevant job receipts. Account deletion removes those documents and its references in rank plans.

## Validation and rollout notes

- API tests run against isolated PGlite and in-memory MongoDB, not configured databases.
- HTTP tests cover authentication/admin gates, strict requests, snapshot readback, concurrent
  deduplication, deterministic replay, weekly idempotency, stale/changed inputs, ties, privacy,
  disconnected sources, same-timestamp updates, export/deletion and interrupted rank finalization.
  Synchronization fixtures cover legacy settings PATCH -> candidate GET, candidate PUT -> scoring
  read/cache invalidation, preserved profile details, opt-in independence, absent versus explicit-null
  legacy fallback, saved alias reads, all-eight route validation, and unchanged v1 history after v2.
- Web tests cover separate Profile score/Interview score, unknown versus zero, level/opt-in controls,
  evidence and weekly history, same-level leaderboard states, diagnostic status and confirmed batch requests.
- API/web typechecks and production builds are verified separately from runtime provider health.
- Integrated enum rollout verification: 748 API tests, 722 web tests and 1,170 offline AI-service
  tests passed (11 AI tests skipped). API/web typechecks and production builds passed; scoped web
  ESLint reported zero errors. No browser E2E or live-provider validation was performed.
- No signed-in live-provider or voice-interview validation, large-cohort benchmark or configured-database
  scoring backfill was run. Diagnostics explicitly labels these untested. The weekly job runs on API
  startup when enabled; disable its flag before startup if reviewing without a batch run.

Repeatable checks from each app folder:

```sh
# apps/api
pnpm exec vitest run --maxWorkers=2 --minWorkers=1
pnpm typecheck
pnpm build

# apps/web
pnpm exec vitest run --maxWorkers=2 --minWorkers=1 --testTimeout=20000
pnpm typecheck
pnpm exec eslint features/profile-scoring 'app/(app)/intelligence/_components/DiagnosticsTab.tsx' 'app/(app)/leaderboard'
pnpm build
```
