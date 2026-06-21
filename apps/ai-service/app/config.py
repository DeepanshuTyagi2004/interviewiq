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

    # --- Perplexity API (brief generation) ---
    # Required. Never hardcoded anywhere in the codebase.
    perplexity_api_key: str = Field(..., alias="PERPLEXITY_API_KEY")
    perplexity_model: str = Field(..., alias="PERPLEXITY_MODEL")  # e.g. sonar, sonar-pro
    # Vendor endpoint. Fixed by Perplexity; overridable via env but not required.
    perplexity_base_url: str = Field("https://api.perplexity.ai", alias="PERPLEXITY_BASE_URL")
    perplexity_timeout_seconds: float = Field(30.0, alias="PERPLEXITY_TIMEOUT_SECONDS")

    # Perplexity Search API (source collection — separate from the sonar chat model).
    # Open web by default ([] = no domain restriction): interview experiences live anywhere,
    # and the Groq extractor's is_interview_experience gate filters non-experiences downstream.
    # Set PERPLEXITY_SEARCH_DOMAINS to narrow to specific sites if precision/cost demands it.
    perplexity_search_domains: Annotated[list[str], NoDecode] = Field(
        default_factory=list,
        alias="PERPLEXITY_SEARCH_DOMAINS",
    )

    @field_validator("perplexity_search_domains", mode="before")
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
    perplexity_search_recency: str = Field("year", alias="PERPLEXITY_SEARCH_RECENCY")
    perplexity_search_context_size: str = Field("high", alias="PERPLEXITY_SEARCH_CONTEXT_SIZE")
    perplexity_search_country: str = Field("IN", alias="PERPLEXITY_SEARCH_COUNTRY")
    collect_max_results: int = Field(20, alias="COLLECT_MAX_RESULTS")   # Search API hard cap is 20

    # --- Groq (extract + aggregate). Free-tier limits for qwen3-32b: RPM 60 · RPD 1k · TPM 6k · TPD 500k ---
    groq_api_key: str = Field(..., alias="GROQ_API_KEY")
    groq_model: str = Field("qwen/qwen3-32b", alias="GROQ_MODEL")
    groq_base_url: str = Field("https://api.groq.com/openai/v1", alias="GROQ_BASE_URL")
    groq_timeout_seconds: float = Field(60.0, alias="GROQ_TIMEOUT_SECONDS")
    # qwen3 is a reasoning model: suppress chain-of-thought so content is clean JSON + low tokens.
    # qwen3-32b -> reasoning_format="hidden"; reasoning_effort="none" is qwen3.6-27b-only (leave "").
    groq_reasoning_format: str = Field("hidden", alias="GROQ_REASONING_FORMAT")
    groq_reasoning_effort: str = Field("", alias="GROQ_REASONING_EFFORT")
    extract_max_sources: int = Field(40, alias="EXTRACT_MAX_SOURCES")   # cap sources sent to extractor
    # Bounded by Groq's per-minute tier (TPM 6000). With reasoning hidden, extracts are small;
    # 3 keeps bursts modest. The 429 handler honors Groq's retry-after, so brief overages self-heal.
    extract_concurrency: int = Field(3, alias="EXTRACT_CONCURRENCY")    # simultaneous Groq extract calls

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
    # Delay between sequential Perplexity calls (rate-limit hygiene).
    brief_inter_call_delay_seconds: float = Field(2.0, alias="BRIEF_INTER_CALL_DELAY_SECONDS")

    # --- Logging --- set to DEBUG for the most verbose output.
    log_level: str = Field("INFO", alias="LOG_LEVEL")


@lru_cache
def get_settings() -> Settings:
    return Settings()
