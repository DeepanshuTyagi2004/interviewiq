"""Service configuration. Everything comes from the environment.

Required vars have NO default — if any is unset the service fails fast at startup
(pydantic raises listing exactly which are missing). Infrastructure connections and
API keys must never silently fall back to a guessed default.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


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

    # --- Logging --- set to DEBUG for the most verbose output.
    log_level: str = Field("INFO", alias="LOG_LEVEL")


@lru_cache
def get_settings() -> Settings:
    return Settings()
