"""Service configuration. Everything comes from the environment.

Required vars have NO default — if any is unset the service fails fast at startup
(pydantic raises listing exactly which are missing). Infrastructure connections and
API keys must never silently fall back to a guessed default.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# Absolute path to the vendored seed data directory, resolved relative to this file.
# app/config.py lives at <repo>/app/config.py → parent is <repo>/app → data is <repo>/app/questions/data.
_DEFAULT_QUESTIONS_DATA_DIR = str(Path(__file__).resolve().parent / "questions" / "data")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    # --- Exa AI Search (brief generation source collection) ---
    # Replaced Perplexity 2026-06-21. Required key; never hardcoded.
    exa_api_key: str = Field(..., alias="EXA_API_KEY")
    # Vendor endpoint. Fixed by Exa; overridable via env but not required.
    exa_base_url: str = Field("https://api.exa.ai", alias="EXA_BASE_URL")
    exa_timeout_seconds: float = Field(30.0, alias="EXA_TIMEOUT_SECONDS")
    exa_num_results: int = Field(10, alias="EXA_NUM_RESULTS")     # results per query variant
    exa_type: str = Field("auto", alias="EXA_TYPE")              # neural | auto | fast | deep
    exa_user_location: str = Field("IN", alias="EXA_USER_LOCATION")  # two-letter country code
    # Per-source text cap sent to Exa as contents.text.maxCharacters. Uncapped text dumps the whole
    # rendered page (post + comment tree + chrome) — a long LinkedIn/Reddit/Glassdoor thread balloons
    # to 20k+ chars and times out the extract LLM. Rendered text leads with the main content, so the
    # cap drops the comment tail first. Matches Exa's own default ballpark; tune via env.
    exa_max_characters: int = Field(10000, alias="EXA_MAX_CHARACTERS")

    # Allow-list ([] = open web): process descriptions live anywhere, and the LLM extractor's
    # describes_process gate filters out non-process pages downstream. Narrow only if precision
    # or cost demands it. Sent to Exa as `includeDomains`.
    exa_include_domains: Annotated[list[str], NoDecode] = Field(
        default_factory=list,
        alias="EXA_INCLUDE_DOMAINS",
    )
    # Hosts that never carry first-hand experiences — content farms, "top-N questions" listicles,
    # job boards. Sent to Exa as `excludeDomains` AND re-applied post-collect before the extract
    # LLM runs (host-suffix match catches subdomains Exa's exact match won't). Override via env.
    exa_exclude_domains: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: [
            "prepfully.com", "interviewquery.com", "himalayas.app", "scribd.com",
            "djobbuzz.com", "huntingcube.ai", "sughara.in", "spacecomplexity.ai",
            # Evidence-based additions (razorpay collect): job boards, coaching/tool marketing,
            # news, and video/image social — none carry extractable first-hand interview text.
            "fresherstech.com", "freshers.jobs", "theinternship.in", "jointaro.com",
            "interviewforgeai.com", "hindustantimes.com", "youtube.com", "instagram.com",
        ],
        alias="EXA_EXCLUDE_DOMAINS",
    )

    @field_validator("exa_include_domains", "exa_exclude_domains", mode="before")
    @classmethod
    def _split_domains(cls, v):
        # NoDecode means env values arrive as raw strings; accept comma-separated or JSON-array.
        if isinstance(v, str):
            s = v.strip()
            if s.startswith("["):
                import json
                return json.loads(s)
            return [d.strip() for d in s.split(",") if d.strip()]
        return v

    # --- LLM (extract + aggregate). OpenAI-compatible endpoint; default is Google AI Studio (Gemma).
    # Google AI Studio free tier for Gemma 4 31B: RPM 15 · RPD 1,500 · TPM unlimited. ---
    # One or more Google AI Studio (Gemini API) keys, comma-separated. Same model on each, so the
    # rate limits match — the client round-robins across them and rotates off any that 429s, giving
    # ~N×RPM. A single key is just a one-element list (back-compatible).
    llm_api_keys: Annotated[list[str], NoDecode] = Field(..., alias="LLM_API_KEY")
    llm_model: str = Field(..., alias="LLM_MODEL_NAME")          # exact AI Studio id, e.g. gemma-3-27b-it

    @field_validator("llm_api_keys", mode="before")
    @classmethod
    def _split_keys(cls, v):
        # NoDecode → arrives as a raw string; accept comma-separated (trimmed, blanks dropped).
        return [k.strip() for k in v.split(",") if k.strip()] if isinstance(v, str) else v
    llm_base_url: str = Field(
        "https://generativelanguage.googleapis.com/v1beta/openai", alias="LLM_BASE_URL",
    )
    # Dedicated model for résumé parsing (onboarding). Reuses the same keys/round-robin client, but
    # lets résumé extraction run on a different Gemini Flash than briefs/questions. Empty → falls
    # back to llm_model, so the service still starts and parses when this is unset.
    resume_llm_model: str = Field("", alias="RESUME_LLM_MODEL")
    # Dedicated model for interview-prep PLAN synthesis (persona / ladders / probes). Same keys and
    # round-robin client; empty → falls back to llm_model. Scoped so plan-gen can run on a different
    # model than brief generation / question enrichment (which stay on llm_model).
    prep_llm_model: str = Field("", alias="PREP_LLM_MODEL")
    # 120s, not 60: Gemma 4 31B always emits a <thought> preamble, so responses are slow (seen 12-31s)
    # and the tail runs past 60s -> httpx ReadTimeout (surfaces as "transport error", not a 429).
    llm_timeout_seconds: float = Field(120.0, alias="LLM_TIMEOUT_SECONDS")
    # Debug: store the model's <thought> reasoning (extract per-source + aggregate) in the brief doc
    # so the admin UI can show it. Off by default — keeps prod docs lean. Gemma 4 always emits one.
    llm_capture_thoughts: bool = Field(False, alias="LLM_CAPTURE_THOUGHTS")
    extract_max_sources: int = Field(40, alias="EXTRACT_MAX_SOURCES")   # cap sources sent to extractor
    # RPM 15 is the binding limit — keep this low. The 429 handler paces bursts, so a brief overage
    # self-heals (slower) rather than failing the combo.
    extract_concurrency: int = Field(2, alias="EXTRACT_CONCURRENCY")    # simultaneous LLM extract calls

    # --- MongoDB ---
    mongodb_url: str = Field(..., alias="MONGODB_URL")
    mongodb_db: str = Field("interviewiq_intelligence", alias="MONGODB_DB")

    # --- Internal service-to-service auth (shared secret with interviewiq-api) ---
    internal_api_key: str = Field(..., alias="INTERNAL_API_KEY")

    # --- interviewiq-api: source of the JD targets to generate briefs for ---
    api_base_url: str = Field("http://interviewiq-api:8080", alias="API_BASE_URL")

    # --- Brief generation schedule ---
    scheduler_enabled: bool = Field(True, alias="SCHEDULER_ENABLED")
    brief_refresh_interval_days: int = Field(7, alias="BRIEF_REFRESH_INTERVAL_DAYS")
    # A brief is regenerated when older than this many days (matches the refresh cadence).
    brief_stale_after_days: int = Field(7, alias="BRIEF_STALE_AFTER_DAYS")
    # Delay between sequential search/LLM calls per combo (rate-limit hygiene).
    brief_inter_call_delay_seconds: float = Field(2.0, alias="BRIEF_INTER_CALL_DELAY_SECONDS")

    # --- Question set collection ---
    # Bump to force re-collection of the question bank (mirrors PIPELINE_VERSION).
    collection_version: str = Field("v1", alias="COLLECTION_VERSION")
    # GitHub repo tarball host — one request pulls a whole repo (no per-file rate limit).
    github_codeload_base: str = Field("https://codeload.github.com", alias="GITHUB_CODELOAD_BASE")
    github_timeout_seconds: float = Field(60.0, alias="GITHUB_TIMEOUT_SECONDS")
    # Concurrent LLM enrich calls for SD/LLD. Same RPM discipline as EXTRACT_CONCURRENCY.
    question_enrich_concurrency: int = Field(2, alias="QUESTION_ENRICH_CONCURRENCY")
    # Where the vendored seed data lives (NeetCode list, Kaggle CSV, SD/LLD seed JSON).
    questions_data_dir: str = Field(_DEFAULT_QUESTIONS_DATA_DIR, alias="QUESTIONS_DATA_DIR")
    # --- Question bank: live sources ---
    kaggle_username: str = Field("", alias="KAGGLE_USERNAME")
    kaggle_key: str = Field("", alias="KAGGLE_KEY")
    kaggle_leetcode_dataset: str = Field("gzipchrist/leetcode-problem-dataset", alias="KAGGLE_LEETCODE_DATASET")
    neetcode_repo: str = Field("dipjul/NeetCode-150", alias="NEETCODE_REPO")
    neetcode_ref: str = Field("main", alias="NEETCODE_REF")
    machine_coding_repo: str = Field("lavakumarThatisetti/Machine-Coding-Round", alias="MACHINE_CODING_REPO")
    machine_coding_ref: str = Field("master", alias="MACHINE_CODING_REF")
    # Behavioural/HR scrape sources (Amazon LP + Googleyness are vendored JSON under <data_dir>/behavioural/).
    tih_repo: str = Field("yangshun/tech-interview-handbook", alias="TIH_REPO")
    tih_ref: str = Field("main", alias="TIH_REF")
    rohan_behavioural_repo: str = Field("rohan-paul/Awesome-JavaScript-Interviews", alias="ROHAN_BEHAVIOURAL_REPO")
    rohan_behavioural_ref: str = Field("master", alias="ROHAN_BEHAVIOURAL_REF")

    # --- Interview prep (Pipeline 1) ---
    # Seed questions pulled from the bank per round when building ladders.
    prep_questions_per_round: int = Field(6, alias="PREP_QUESTIONS_PER_ROUND")
    # structured.py re-ask budget: how many times to re-ask the LLM to fix invalid JSON.
    prep_max_repairs: int = Field(2, alias="PREP_MAX_REPAIRS")
    # Recorded on every stored plan; bump to force regeneration when the plan SHAPE changes.
    prep_plan_version: str = Field("v4", alias="PREP_PLAN_VERSION")
    # Concurrent LLM calls in Stage 2 (persona / ladders / probes = 3). Same RPM discipline as EXTRACT_CONCURRENCY.
    prep_concurrency: int = Field(3, alias="PREP_CONCURRENCY")

    # --- Live interview (Pipeline 2) ---
    # Conversation-turn model (spoken lines). Empty → falls back to llm_model. Same keys/client.
    interview_llm_model: str = Field("", alias="INTERVIEW_LLM_MODEL")
    # Scoring / classification / pacing-judgment / topic-derivation model (cheaper/faster). Empty → llm_model.
    interview_scorer_model: str = Field("", alias="INTERVIEW_SCORER_MODEL")
    # Pacing rails (minutes). Floor = never end before this; base = target; max = hard ceiling.
    interview_min_duration_min: int = Field(18, alias="INTERVIEW_MIN_DURATION_MIN")
    interview_base_duration_min: int = Field(45, alias="INTERVIEW_BASE_DURATION_MIN")
    interview_max_duration_min: int = Field(60, alias="INTERVIEW_MAX_DURATION_MIN")
    # Score bands (0..1): below low → may wind down; above high → may extend.
    interview_low_band: float = Field(0.40, alias="INTERVIEW_LOW_BAND")
    interview_high_band: float = Field(0.70, alias="INTERVIEW_HIGH_BAND")
    # Hybrid answer-score weights (must sum to 1.0): competency vs behavioral.
    interview_w_competency: float = Field(0.75, alias="INTERVIEW_W_COMPETENCY")
    interview_w_behavioral: float = Field(0.25, alias="INTERVIEW_W_BEHAVIORAL")
    # Negative-event penalties applied to the rolling score.
    interview_pivot_penalty: float = Field(0.15, alias="INTERVIEW_PIVOT_PENALTY")
    interview_out_of_scope_penalty: float = Field(0.30, alias="INTERVIEW_OUT_OF_SCOPE_PENALTY")
    interview_idk_penalty: float = Field(0.05, alias="INTERVIEW_IDK_PENALTY")
    # How many in-scope pivots to honor before holding ground.
    interview_pivot_cap: int = Field(2, alias="INTERVIEW_PIVOT_CAP")
    # Seconds into a topic derivation before emitting a "bear with me" nudge line.
    interview_nudge_after_s: float = Field(8.0, alias="INTERVIEW_NUDGE_AFTER_S")
    # How long before base_s the extend gate opens.
    interview_extend_lookahead_s: float = Field(300.0, alias="INTERVIEW_EXTEND_LOOKAHEAD_S")
    # Minimum plan-core coverage before a wind-down is allowed (guards the floor with evidence).
    interview_min_coverage: float = Field(0.34, alias="INTERVIEW_MIN_COVERAGE")
    # structured.py re-ask budget for live LLM ops.
    interview_max_repairs: int = Field(1, alias="INTERVIEW_MAX_REPAIRS")
    # How many "sorry, didn't catch that" retries before aborting on persistent silence.
    interview_silence_retries: int = Field(2, alias="INTERVIEW_SILENCE_RETRIES")

    # --- LiveKit (Pipeline 2 live interview worker) ---
    livekit_url: str = Field(..., alias="LIVEKIT_URL")
    livekit_api_key: str = Field(..., alias="LIVEKIT_API_KEY")
    livekit_api_secret: str = Field(..., alias="LIVEKIT_API_SECRET")
    # Deepgram STT + Aura TTS (sub-project D voice pipeline).
    deepgram_api_key: str = Field(..., alias="DEEPGRAM_API_KEY")

    # --- Langfuse tracing (OPTIONAL) ---
    # New runtime dependency, kept OPTIONAL: the service starts and runs without the `langfuse`
    # package installed. Tracing is a NO-OP unless enabled AND both keys are set (see app/obs).
    langfuse_enabled: bool = Field(False, alias="LANGFUSE_ENABLED")
    langfuse_public_key: str = Field("", alias="LANGFUSE_PUBLIC_KEY")
    langfuse_secret_key: str = Field("", alias="LANGFUSE_SECRET_KEY")
    langfuse_host: str = Field("https://cloud.langfuse.com", alias="LANGFUSE_HOST")

    # --- Logging --- set to DEBUG for the most verbose output.
    log_level: str = Field("INFO", alias="LOG_LEVEL")


@lru_cache
def get_settings() -> Settings:
    return Settings()
