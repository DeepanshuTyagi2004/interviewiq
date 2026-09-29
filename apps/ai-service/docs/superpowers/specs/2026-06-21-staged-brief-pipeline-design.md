# Staged Brief Pipeline — Design

**Date:** 2026-06-21
**Repo:** `interviewiq-ai-service`
**Status:** approved (pending spec review)

## Problem

The current brief pipeline makes a **single Sonar chat call** that searches, extracts
experiences, and aggregates a round-by-round process all at once. A DB audit of the 9
`razorpay/software-engineer` briefs showed the failure mode:

- 28 unique source URLs across **all 9 briefs combined**; **57% reused across 2–7 combos**.
- One Reddit post appears in 7 of 9 combos. A *senior*/*principal* post is used under
  "fresher"; a *frontend* post is used under "backend".
- 0 briefs reach `high` confidence; 7 of 9 are `insufficient_data`/`low`.

Root cause: base `sonar` does shallow retrieval, recycling a small shared pool of posts
across every combo instead of researching each one, and the role/level/specialization
signal is largely ignored. We also pass **no** Perplexity search knobs (recency, domain,
context size) — all defaults.

## Goal

Replace the one blended call with an explicit staged pipeline that collects diverse real
sources, extracts each independently, and aggregates into one final round-by-round
experience — **with per-round provenance** and a graceful fallback so every combo always
yields a complete, honest experience. **Primary audience: Indian candidates.**

## Pipeline

```
combo: (company, role, level [, specialization])
  │
  ▼ [1] COLLECT — Perplexity Search API (POST /search), NO LLM
  │     query = array of 3–4 India-weighted variants
  │     search_domain_filter = [ambitionbox.com, glassdoor.co.in, geeksforgeeks.org,
  │                              leetcode.com, jointaro.com, reddit.com, dev.to]  (≤20)
  │     country = "IN"; search_recency_filter = "year"; search_context_size = "high"
  │     max_results = 20 per variant  →  dedupe by URL  →  10–50 sources
  │     each: {title, url, snippet/content, date}
  │
  ▼ [2] EXTRACT — Groq qwen/qwen3.6-27b, ONE call per source
  │     bounded concurrency (8 in flight), retry/backoff on 429, source cap ~40
  │     in:  one source's text
  │     out: one raw_experience {source, url, date, detected_role, detected_level,
  │          geo: india|non-india|unknown, rounds[], outcome}   — or null if not a
  │          real first-hand interview post
  │
  ▼ [3] AGGREGATE — Groq qwen/qwen3.6-27b, ONE call
  │     in:  all raw_experiences (+ combo)
  │     out: ONE final_experience (round-by-round), each round tagged
  │          provenance = evidence_backed | inferred
  │
  ▼ [4] STORE — raw_experiences[] (N) + final_experience (1) + sources + metadata
```

### Stage 1 — Collect (Perplexity Search API)

- Endpoint `POST https://api.perplexity.ai/search`. `max_results` caps at **20**, so pass a
  `query` **array** of 3–4 variants (e.g. `"{company} {role} {level} interview experience India"`,
  `"{company} {role} interview rounds India"`, plus a site-targeted variant) and dedupe by URL
  to reach 10–50 sources.
- `search_context_size: "high"` + a generous `max_tokens_per_page` so each result carries real
  content, not a one-line snippet.
- India-first: `country: "IN"`, India-weighted query text, India-relevant domain whitelist.
- No LLM in this stage. Output is raw sources.

### Stage 2 — Extract (Groq, per source, parallel-capped)

- One Groq call per source. **Bounded concurrency** via a semaphore (8 simultaneous);
  remaining calls queue. Retry with backoff on Groq 429/5xx. Hard cap ~40 sources.
- Output is a strict-JSON `raw_experience`, or `null` when the source is not a genuine
  first-hand interview experience (drop blogs-about-prep, listicles, job ads).
- `detected_role` / `detected_level` / `geo` are tagged so the aggregator can weight
  on-target, India-based evidence and discount mismatched posts (the recycling fix).
- Per-source isolation: a junk/blocked source fails alone and never aborts the stage.

### Stage 3 — Aggregate (Groq, one call) + provenance & fallback

Produces ONE `final_experience`. Each round carries:

- `provenance: "evidence_backed" | "inferred"` and `evidence_urls: []`.
- **evidence_backed** — round supported by ≥1 extracted raw experience (URLs cited).
  Prefer India experiences; discount non-India.
- **inferred** — filled from typical patterns for *similar* {company}/{role}/{level} in the
  **Indian tech-interview context** when evidence is thin.
- **Hard rule:** inferred rounds stay generic/pattern-level. **Never invent company-specific
  details** (named problems, OA platform, interviewer specifics) without evidence. Company
  specifics appear only on evidence_backed rounds.
- `data_confidence` derived from the evidence-backed ratio (high = most rounds evidence-backed,
  low = mostly inferred). The stage **always returns a complete experience, never empty**.

The aggregator system prompt is **product IP** — drafted for human review before production
use (per CLAUDE.md), not shipped blind.

### Stage 4 — Store

One document per combo in `interview_briefs`:

```jsonc
{
  "company": "...", "role": "...", "level": "...", "specialization": "...",
  "raw_experiences": [
    { "source": "...", "url": "...", "date": "...",
      "detected_role": "...", "detected_level": "...", "geo": "india|non-india|unknown",
      "rounds": [ /* ... */ ], "outcome": "..." }
  ],
  "final_experience": {
    "rounds": [
      { "round_number": 1, "type": "dsa", "format": "...", "topics": ["..."],
        "problems": ["..."], "provenance": "evidence_backed|inferred", "evidence_urls": ["..."] }
    ],
    "dominant_topics": ["..."], "difficulty_calibration": "...",
    "interviewer_style_notes": "...", "red_flags": ["..."],
    "company_specific_patterns": "...|null", "data_confidence": "high|medium|low",
    "evidence_backed_round_count": 0, "inferred_round_count": 0
  },
  "sources": ["url", "..."],
  "generated_at": "ISO", "query_version": "v7",
  "models": { "search": "sonar", "extract": "qwen/qwen3.6-27b", "aggregate": "qwen/qwen3.6-27b" },
  "generation_status": "success|insufficient_data|failed"
}
```

**No scoring/ranking anywhere** — provenance is descriptive, not a grade (CLAUDE.md hard rule).

## Components changed / added

| File | Change |
|---|---|
| `app/groq/client.py` (NEW) | Groq client (OpenAI-compatible, cloud). `complete_json` for extract/aggregate. Bounded-concurrency helper + 429/5xx retry. |
| `app/config.py` | Add `GROQ_API_KEY`, `GROQ_MODEL` (default `qwen/qwen3.6-27b`); add Perplexity search params (domain list, recency, context size). |
| `app/perplexity/client.py` | Add real `POST /search` method (the existing `search()` uses chat completions). |
| `app/prompts/extract_source.py` (NEW) | Per-source extraction prompt + JSON schema instruction. |
| `app/prompts/aggregate_experience.py` (NEW) | Aggregator prompt (provenance + fallback rules). **Product IP — review before prod.** |
| `app/prompts/brief_query.py` | Retired (Sonar-chat blended query no longer used). |
| `app/models/brief.py` | New schema: `RawExperience`, `FinalExperience` (round `provenance`/`evidence_urls`), counts. |
| `app/jobs/brief_generation.py` | Rewrite `_query_and_validate` → `collect → extract(parallel) → aggregate`. |

### Cleanups folded in (from the audit)

- Redefine `data_confidence`/`generation_status` off the evidence-backed ratio, not Perplexity's
  subjective self-label.
- Fix `needs_regeneration` so a settled brief (good evidence ratio) isn't re-burned every manual
  run. Today only `high` is skipped and nothing reaches `high`.

## Cost / volume

Per combo: 1 Perplexity Search call + ≤~40 Groq extract calls (small, parallel-capped) + 1 Groq
aggregate call. ×9 combos. qwen3-27b on Groq is fast and cheap — negligible at this volume.

## New dependency (CLAUDE.md stop-and-ask — approved)

- **Groq** (OpenAI-compatible API) + `GROQ_API_KEY`. Chosen by the user for fast, JSON-reliable
  extraction/aggregation. Replaces the local Gemma removed earlier today.

## Out of scope

- Specialization-granularity reduction (merging frontend/backend/fullstack) — considered in the
  audit but deferred; the staged pipeline targets the recycling root cause directly.
- Direct scraping of source sites into the `experiences` collection — possible future quality lever.
- The interview-session/voice modules.

## Testing

- `parse_json` self-check stays.
- Extractor: one offline self-check feeding a saved sample source → asserts rounds extracted and
  `geo`/`detected_level` tagged.
- Aggregator: self-check that an all-`inferred` input still yields a complete experience with every
  round marked `inferred` and `data_confidence: low`, and that no company-specific detail appears on
  an inferred round.
- One live end-to-end smoke run on a single combo via `cli.py`.
