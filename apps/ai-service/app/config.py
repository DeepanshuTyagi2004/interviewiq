"""Service configuration. Everything comes from the environment.

Required vars have NO default — if any is unset the service fails fast at startup
(pydantic raises listing exactly which are missing). Infrastructure connections and
API keys must never silently fall back to a guessed default.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# Absolute path to the vendored seed data directory, resolved relative to this file.
# app/config.py lives at <repo>/app/config.py → parent is <repo>/app → data is <repo>/app/questions/data.
_DEFAULT_QUESTIONS_DATA_DIR = str(Path(__file__).resolve().parent / "questions" / "data")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False, hide_input_in_errors=True)

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
    # 120s, not 60: Gemma 4 31B always emits a <thought> preamble, so responses are slow (seen 12-31s)
    # and the tail runs past 60s -> httpx ReadTimeout (surfaces as "transport error", not a 429).
    llm_timeout_seconds: float = Field(120.0, alias="LLM_TIMEOUT_SECONDS")
    # Research only: optional Groq primary, with the existing LLM configuration as fallback.
    groq_api_keys: Annotated[list[str], NoDecode] = Field(default_factory=list, alias="GROQ_API_KEY")
    groq_model: str = Field("openai/gpt-oss-120b", alias="GROQ_MODEL_NAME")
    # Additional Groq models, in order, before the existing LLM_* fallback. Opt-in.
    groq_fallback_models: Annotated[list[str], NoDecode] = Field(
        default_factory=list, alias="GROQ_FALLBACK_MODELS",
    )
    groq_base_url: str = Field("https://api.groq.com/openai/v1", alias="GROQ_BASE_URL")
    groq_timeout_seconds: float = Field(30.0, alias="GROQ_TIMEOUT_SECONDS", gt=0, allow_inf_nan=False)
    # Reasoning effort sent to Groq's gpt-oss models ("" sends none). Their reasoning tokens count against the output
    # cap, which must stay small to fit the free tier's per-minute ledger: low keeps answers from being cut off.
    groq_reasoning_effort: Literal["", "low", "medium", "high"] = Field("low", alias="GROQ_GPT_OSS_REASONING_EFFORT")
    # Bytes per token the quota ledger assumes when reserving a prompt. Measured 2026-10-08 on blueprint prompts:
    # ~4.0; 3.6 stays conservative without refusing prompts the provider would accept.
    groq_bytes_per_token: float = Field(3.6, alias="GROQ_BYTES_PER_TOKEN", ge=2.0, le=6.0)

    @field_validator("groq_api_keys", "groq_fallback_models", mode="before")
    @classmethod
    def _split_groq_values(cls, v):
        values = v.split(",") if isinstance(v, str) else v
        return list(dict.fromkeys(value.strip() for value in values if value.strip()))

    # Google Gemini over the native generateContent API (a paid key). When set, every routed call
    # (research, question content, profile scoring, interview blueprints) tries Gemini first, then
    # Groq -> Cloudflare -> LLM_*. Comma-separated keys rotate like Groq's.
    gemini_api_keys: Annotated[list[str], NoDecode] = Field(default_factory=list, alias="GEMINI_API_KEY", repr=False)
    gemini_model: str = Field("gemini-3.8-flash", alias="GEMINI_MODEL_NAME", min_length=1)
    gemini_base_url: str = Field("https://generativelanguage.googleapis.com/v1beta", alias="GEMINI_BASE_URL")
    # Per request. Measured 2026-10-08: a 2.3k-token playbook takes 20-28s alone but 2-4x that with a dozen calls in
    # flight, so 90s sent slow-but-fine calls to the free-tier fallback.
    gemini_timeout_seconds: float = Field(180.0, alias="GEMINI_TIMEOUT_SECONDS", gt=0, allow_inf_nan=False)
    # Gemini's output budget per call (thinking tokens count against it). The caller's own cap wins when larger;
    # the smaller caps elsewhere exist only to fit Groq's free-tier per-minute token ledger.
    gemini_max_output_tokens: int = Field(8192, alias="GEMINI_MAX_OUTPUT_TOKENS", ge=256, le=65536)
    # Gemini 3 thinking level; "" leaves the model default (dynamic, slower).
    gemini_thinking_level: Literal["", "minimal", "low", "medium", "high"] = Field("low", alias="GEMINI_THINKING_LEVEL")

    @field_validator("gemini_api_keys", mode="before")
    @classmethod
    def _split_gemini_keys(cls, v):
        values = v.split(",") if isinstance(v, str) else (v or [])
        return list(dict.fromkeys(value.strip() for value in values if value.strip()))

    # Research only: optional Workers AI fallback after Groq and before LLM_*.
    cloudflare_api_token: str = Field("", alias="CLOUDFLARE_API_TOKEN", repr=False)
    cloudflare_account_id: str = Field("", alias="CLOUDFLARE_ACCOUNT_ID", pattern=r"^[A-Za-z0-9]*$")
    cloudflare_model: str = Field(
        "@cf/openai/gpt-oss-120b", alias="CLOUDFLARE_MODEL_NAME", min_length=1,
    )
    cloudflare_timeout_seconds: float = Field(
        30.0, alias="CLOUDFLARE_TIMEOUT_SECONDS", gt=0, allow_inf_nan=False,
    )
    cloudflare_max_tokens: int = Field(4096, alias="CLOUDFLARE_MAX_TOKENS", ge=1, le=24000)

    @field_validator("cloudflare_api_token", "cloudflare_account_id", "cloudflare_model", mode="before")
    @classmethod
    def _strip_cloudflare_values(cls, v):
        return v.strip() if isinstance(v, str) else v

    @model_validator(mode="after")
    def _validate_cloudflare_credentials(self):
        if bool(self.cloudflare_api_token) != bool(self.cloudflare_account_id):
            raise ValueError("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be configured together")
        return self

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

    # --- Live interviewer (Module 03; docs/superpowers/specs/2026-10-08-live-interviewer-design.md §3) ---
    # Optional for the HTTP service; the interviewer worker checks them at start (app/interviewer/worker.py).
    livekit_url: str = Field("", alias="LIVEKIT_URL")
    livekit_api_key: str = Field("", alias="LIVEKIT_API_KEY")
    livekit_api_secret: str = Field("", alias="LIVEKIT_API_SECRET")
    deepgram_api_key: str = Field("", alias="DEEPGRAM_API_KEY")
    openrouter_api_key: str = Field("", alias="OPENROUTER_API_KEY")
    openrouter_base_url: str = Field("https://openrouter.ai/api/v1", alias="OPENROUTER_BASE_URL")
    # OpenRouter Decisions API (TypeSafe Jev classifier) behind the decision gates. Mode: off | shadow (log only) | on (may skip the LLM).
    decisions_model: str = Field("typesafe/jev-1.14", alias="DECISIONS_MODEL")
    decisions_url: str = Field("https://openrouter.ai/api/alpha/decisions", alias="DECISIONS_URL")
    decisions_timeout_seconds: float = Field(8.0, alias="DECISIONS_TIMEOUT_SECONDS")
    # *_GATE_AUDIT_RATE: in `on` mode, the share of would-be skips that still run the LLM (and get labelled).
    research_window_gate_mode: Literal["off", "shadow", "on"] = Field("shadow", alias="RESEARCH_WINDOW_GATE_MODE")
    research_window_gate_skip_below: float = Field(0.05, ge=0.0, le=0.5, alias="RESEARCH_WINDOW_GATE_SKIP_BELOW")
    research_window_gate_audit_rate: float = Field(0.05, ge=0.0, le=1.0, alias="RESEARCH_WINDOW_GATE_AUDIT_RATE")
    brief_source_gate_mode: Literal["off", "shadow", "on"] = Field("shadow", alias="BRIEF_SOURCE_GATE_MODE")
    brief_source_gate_skip_below: float = Field(0.05, ge=0.0, le=0.5, alias="BRIEF_SOURCE_GATE_SKIP_BELOW")
    brief_source_gate_audit_rate: float = Field(0.05, ge=0.0, le=1.0, alias="BRIEF_SOURCE_GATE_AUDIT_RATE")
    key_review_gate_mode: Literal["off", "shadow", "on"] = Field("shadow", alias="KEY_REVIEW_GATE_MODE")
    key_review_gate_skip_below: float = Field(0.05, ge=0.0, le=0.5, alias="KEY_REVIEW_GATE_SKIP_BELOW")
    key_review_gate_audit_rate: float = Field(0.05, ge=0.0, le=1.0, alias="KEY_REVIEW_GATE_AUDIT_RATE")
    decision_gate_log_ttl_days: int = Field(60, ge=1, alias="DECISION_GATE_LOG_TTL_DAYS")
    interviewer_agent_name: str = Field("interviewer", alias="INTERVIEWER_AGENT_NAME")
    # Comma-separated host:port or URLs; the worker stops itself when one stays unreachable ("" = never). Dev only: `pnpm dev` sets it.
    interviewer_stop_when_down: str = Field("", alias="INTERVIEWER_STOP_WHEN_DOWN")
    interviewer_talker_model: str = Field("deepseek/deepseek-v4.1-flash", alias="INTERVIEWER_TALKER_MODEL")
    # "none" turns reasoning off on the speaking path; anything else is sent as OpenRouter's reasoning effort.
    interviewer_talker_reasoning: str = Field("none", alias="INTERVIEWER_TALKER_REASONING")
    interviewer_director_model: str = Field("deepseek/deepseek-v4.1-flash", alias="INTERVIEWER_DIRECTOR_MODEL")
    interviewer_director_reasoning: str = Field("medium", alias="INTERVIEWER_DIRECTOR_REASONING")
    # Sampling temperature (decided 2026-10-18): moderate for the speaking path so two interviewers do not say the same words, low for the director.
    interviewer_talker_temperature: float = Field(0.7, alias="INTERVIEWER_TALKER_TEMPERATURE", ge=0.0, le=2.0)
    interviewer_director_temperature: float = Field(0.2, alias="INTERVIEWER_DIRECTOR_TEMPERATURE", ge=0.0, le=2.0)
    # The model raced against a slow talker model and used by the director when its own fails; "" turns it off.
    # GLM 5.3 flash cannot turn reasoning off, so it is kept to the lightest effort.
    interviewer_fallback_model: str = Field("z-ai/glm-5.3-flash", alias="INTERVIEWER_FALLBACK_MODEL")
    interviewer_fallback_reasoning: str = Field("minimal", alias="INTERVIEWER_FALLBACK_REASONING")
    # Deepgram Aura-2 voices (English-only; none has an Indian accent): "aura-2-orpheus-en" (male, professional, clear) and
    # "aura-2-athena-en" (female, calm, professional). A woman interviewer gets the female voice. The Indian-accented
    # Flux voices ("flux-naveen-en", "flux-priya-en", "flux-meena-en") still work if named here.
    interviewer_tts_voice: str = Field("aura-2-orpheus-en", alias="INTERVIEWER_TTS_VOICE")
    # Candidates' speech is personal data: Deepgram's model-improvement programme is opted out of (speech-to-text and voice).
    deepgram_mip_opt_out: bool = Field(True, alias="DEEPGRAM_MIP_OPT_OUT")
    interviewer_female_tts_voice: str = Field("aura-2-athena-en", alias="INTERVIEWER_FEMALE_TTS_VOICE")
    # Voice provider: "sarvam" (Bulbul v4 Flash, Indian-English voices) or "deepgram" (the voices above). With "sarvam" the two
    # voices below are Sarvam speaker names, and a missing SARVAM_API_KEY keeps the worker from starting.
    interviewer_tts_provider: str = Field("sarvam", alias="INTERVIEWER_TTS_PROVIDER")
    sarvam_api_key: str = Field("", alias="SARVAM_API_KEY")
    sarvam_tts_model: str = Field("bulbul:v4-flash", alias="SARVAM_TTS_MODEL")
    sarvam_tts_voice: str = Field("shubh_enhi_ads", alias="SARVAM_TTS_VOICE")
    sarvam_female_tts_voice: str = Field("roopa_en_conversational", alias="SARVAM_FEMALE_TTS_VOICE")
    # How long the talker model gets to start answering before the fallback is raced against it, and how long
    # the interviewer keeps trying (saying short fillers meanwhile) before giving up on a reply.
    interviewer_talker_timeout_seconds: float = Field(3.0, alias="INTERVIEWER_TALKER_TIMEOUT_SECONDS", gt=0)
    interviewer_talker_deadline_seconds: float = Field(32.0, alias="INTERVIEWER_TALKER_DEADLINE_SECONDS", gt=0)
    interviewer_director_timeout_seconds: float = Field(45.0, alias="INTERVIEWER_DIRECTOR_TIMEOUT_SECONDS", gt=0)
    # Reply latency. OpenRouter's `session_id` is its sticky-routing key: every turn of a round then goes to the same upstream provider, so
    # its prompt cache (the 5-9k token prefix) is hit instead of rebuilt (docs: "Sticky sessions expire after 10 minutes of inactivity").
    interviewer_sticky_routing: bool = Field(True, alias="INTERVIEWER_STICKY_ROUTING")
    # Optional hard pin: comma-separated OpenRouter provider names tried in this order for the talker ("" = latency-sorted routing).
    # OpenRouter disables sticky routing when `order` is set, so the first healthy name is the sticky choice; fallbacks stay allowed.
    interviewer_talker_provider_order: str = Field("", alias="INTERVIEWER_TALKER_PROVIDER_ORDER")
    # A max_tokens=1 request sent when the interviewer joins and when the candidate enters the room, so the greeting does not pay
    # the cold first call (a round measured 4.4 s with no cached tokens).
    interviewer_warm_up: bool = Field(True, alias="INTERVIEWER_WARM_UP")
    interviewer_stt_keyterms: bool = Field(True, alias="INTERVIEWER_STT_KEYTERMS")      # nova-3 keyterm prompting from the resume, company and names
    # Turn-taking (decided 2026-10-18). LiveKit's built-in turn detector (local model, no download) scores from the candidate's audio whether they
    # have finished. A turn it judges finished is committed after this many seconds of silence (it was a flat 1.0 s); one it judges unfinished
    # waits the 6 s ceiling. Off = no detector and a flat 1.0 s wait. See the comment above TURN_HANDLING in app/interviewer/agent.py.
    interviewer_turn_detector: bool = Field(True, alias="INTERVIEWER_TURN_DETECTOR")
    interviewer_endpointing_min_delay_seconds: float = Field(0.5, alias="INTERVIEWER_ENDPOINTING_MIN_DELAY_SECONDS", gt=0)
    # The detector's "this turn is unfinished" line: a score under it waits the long ceiling. The server's calibrated default
    # (0.56 seen live) read short finished replies ("Yes, Ashwin." 0.28, "I don't know." 0.31) as unfinished: each waited 3 s
    # (decided 2026-10-18). 0 = keep the server's default.
    interviewer_eot_unlikely_threshold: float = Field(0.3, alias="INTERVIEWER_EOT_UNLIKELY_THRESHOLD", ge=0, lt=1)
    # Sarvam holds text until this many characters have arrived (or the reply ends) before it starts speaking; its lowest is 30 (default 50).
    sarvam_tts_min_buffer_size: int = Field(30, alias="SARVAM_TTS_MIN_BUFFER_SIZE", ge=30, le=200)

    # --- Brief generation schedule ---
    scheduler_enabled: bool = Field(True, alias="SCHEDULER_ENABLED")
    brief_refresh_interval_days: int = Field(7, alias="BRIEF_REFRESH_INTERVAL_DAYS")
    # A brief is regenerated when older than this many days (matches the refresh cadence).
    brief_stale_after_days: int = Field(7, alias="BRIEF_STALE_AFTER_DAYS")
    # Delay between sequential search/LLM calls per combo (rate-limit hygiene).
    brief_inter_call_delay_seconds: float = Field(2.0, alias="BRIEF_INTER_CALL_DELAY_SECONDS")

    # --- Company research pipeline (app/research; spec 2026-10-02) ---
    research_enabled: bool = Field(True, alias="RESEARCH_ENABLED")
    # Weekly run, APScheduler crontab syntax, Asia/Kolkata. Use day NAMES ("mon"): APScheduler numbers
    # weekdays from Monday=0, unlike cron, so digits are a trap.
    research_cron: str = Field("0 2 * * mon", alias="RESEARCH_CRON")
    # live = real Exa/LLM; record = live + save every response to RESEARCH_FIXTURES_DIR;
    # replay = serve ONLY from saved fixtures (free, deterministic, offline).
    research_mode: Literal["live", "record", "replay"] = Field("live", alias="RESEARCH_MODE")
    research_fixtures_dir: str = Field(".research-fixtures", alias="RESEARCH_FIXTURES_DIR")
    research_concurrency: int = Field(2, alias="RESEARCH_CONCURRENCY", ge=1)
    research_results_per_query: int = Field(5, alias="RESEARCH_RESULTS_PER_QUERY", ge=1)
    research_stale_after_days: int = Field(7, alias="RESEARCH_STALE_AFTER_DAYS", ge=0)
    research_max_roles: int = Field(8, alias="RESEARCH_MAX_ROLES", ge=1)
    # Per-run caps; reaching one auto-pauses the run (raise the cap in the UI, then resume).
    research_max_exa_calls: int = Field(400, alias="RESEARCH_MAX_EXA_CALLS", ge=0)
    research_max_llm_calls: int = Field(2000, alias="RESEARCH_MAX_LLM_CALLS", ge=0)
    # Crash-loop guard: a company found mid-run after this many restarts is failed, not retried.
    research_max_attempts: int = Field(2, alias="RESEARCH_MAX_ATTEMPTS", ge=1)
    research_trace_ttl_days: int = Field(14, alias="RESEARCH_TRACE_TTL_DAYS", ge=1)
    # Run-wide caps on concurrent external calls (cache hits and replay reads are not counted).
    research_exa_concurrency: int = Field(2, alias="RESEARCH_EXA_CONCURRENCY", ge=1)
    research_llm_concurrency: int = Field(4, alias="RESEARCH_LLM_CONCURRENCY", ge=1)
    research_llm_deadline_seconds: float = Field(75.0, alias="RESEARCH_LLM_DEADLINE_SECONDS", gt=0, allow_inf_nan=False)
    research_operation_timeout_seconds: float = Field(90.0, alias="RESEARCH_OPERATION_TIMEOUT_SECONDS", gt=0, allow_inf_nan=False)
    research_groq_stage_seconds: float = Field(25.0, alias="RESEARCH_GROQ_STAGE_SECONDS", gt=0, allow_inf_nan=False)
    research_google_timeout_seconds: float = Field(12.0, alias="RESEARCH_GOOGLE_TIMEOUT_SECONDS", gt=0, allow_inf_nan=False)
    research_max_output_tokens: int = Field(2048, alias="RESEARCH_MAX_OUTPUT_TOKENS", ge=128, le=8192)
    research_groq_tpm: int = Field(8000, alias="RESEARCH_GROQ_TPM", ge=1)
    # Profile scoring (item assessment + company context) uses the same Groq-first routing as research
    # with its own limits. One call (plus one repair) must finish well inside the API's 120s wait.
    profile_scoring_llm_deadline_seconds: float = Field(50.0, alias="PROFILE_SCORING_LLM_DEADLINE_SECONDS", gt=0, allow_inf_nan=False)
    profile_scoring_groq_stage_seconds: float = Field(40.0, alias="PROFILE_SCORING_GROQ_STAGE_SECONDS", gt=0, allow_inf_nan=False)
    profile_scoring_max_output_tokens: int = Field(4096, alias="PROFILE_SCORING_MAX_OUTPUT_TOKENS", ge=256, le=8192)
    research_groq_rpm: int = Field(30, alias="RESEARCH_GROQ_RPM", ge=1)
    research_chunk_chars: int = Field(4500, alias="RESEARCH_CHUNK_CHARS", ge=1000, le=12000)
    research_max_chunks: int = Field(4, alias="RESEARCH_MAX_CHUNKS", ge=1, le=12)
    # Targeted follow-up searches per company for fields still empty after the main pass (0 = off).
    research_followup_max_queries: int = Field(6, alias="RESEARCH_FOLLOWUP_MAX_QUERIES", ge=0)

    # --- Question set collection ---
    # Bump to force re-collection of the question bank (mirrors PIPELINE_VERSION).
    collection_version: str = Field("v1", alias="COLLECTION_VERSION")
    # GitHub repo tarball host — one request pulls a whole repo (no per-file rate limit).
    github_codeload_base: str = Field("https://codeload.github.com", alias="GITHUB_CODELOAD_BASE")
    github_timeout_seconds: float = Field(60.0, alias="GITHUB_TIMEOUT_SECONDS")
    # Concurrent LLM enrich calls for SD/LLD. Same RPM discipline as EXTRACT_CONCURRENCY.
    question_enrich_concurrency: int = Field(2, alias="QUESTION_ENRICH_CONCURRENCY")
    # Content generation (docs/question-bank.md): parallel generations, output budget per problem,
    # per-call deadline, and the sandbox wall-clock for verifying a DSA reference solution.
    question_content_concurrency: int = Field(6, alias="QUESTION_CONTENT_CONCURRENCY", ge=1, le=32)
    # Must stay well under the per-key per-minute token cap (Groq free tier: 8000 TPM) or no request is ever schedulable.
    question_content_max_output_tokens: int = Field(5500, alias="QUESTION_CONTENT_MAX_OUTPUT_TOKENS", ge=1024, le=16000)
    # Grounded DSA problems return only prose (the examples are supplied): a small budget fits more calls per minute.
    question_content_grounded_max_output_tokens: int = Field(2600, alias="QUESTION_CONTENT_GROUNDED_MAX_OUTPUT_TOKENS", ge=512, le=8000)
    question_content_deadline_seconds: float = Field(150.0, alias="QUESTION_CONTENT_DEADLINE_SECONDS", gt=0, allow_inf_nan=False)
    question_content_groq_stage_seconds: float = Field(90.0, alias="QUESTION_CONTENT_GROQ_STAGE_SECONDS", gt=0, allow_inf_nan=False)
    question_content_sandbox_timeout_seconds: float = Field(10.0, alias="QUESTION_CONTENT_SANDBOX_TIMEOUT_SECONDS", gt=0, allow_inf_nan=False)
    # Free-tier keys exhaust per-minute quota under load: wait and retry this many times before failing an item.
    question_content_quota_retries: int = Field(30, alias="QUESTION_CONTENT_QUOTA_RETRIES", ge=0, le=60)
    # DSA problems must prove correct: failed checks go back to the model with the exact failures, this many times.
    question_content_repair_rounds: int = Field(3, alias="QUESTION_CONTENT_REPAIR_ROUNDS", ge=0, le=6)
    # DSA problems are generated only when a validated source statement (with two readable examples) exists:
    # the source's examples are the ground truth the solutions must reproduce. Set true to also generate
    # the rest from the index alone (two solutions must still agree on every test).
    question_content_allow_ungrounded: bool = Field(False, alias="QUESTION_CONTENT_ALLOW_UNGROUNDED")
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

    # --- Interview blueprint (prep phase; docs/superpowers/specs/2026-10-07-interview-blueprint-design.md) ---
    # Groq-first research client budgets for the blueprint's LLM stages (persona, personalization,
    # playbooks, answer keys). The quota ledger reserves prompt + this cap per call and refuses any
    # reservation above RESEARCH_GROQ_TPM (8000): a playbook prompt is ~3-4k tokens, so the cap must
    # stay around 3500 or no call can ever be scheduled. Truncated replies get a repair round plus
    # BLUEPRINT_TRANSIENT_RETRIES fresh attempts instead of a bigger budget.
    blueprint_max_output_tokens: int = Field(3500, alias="BLUEPRINT_MAX_OUTPUT_TOKENS", ge=1024, le=16000)
    # One routed call, Gemini included (it gets 60% of this, then the free-tier chain gets the rest).
    blueprint_deadline_seconds: float = Field(300.0, alias="BLUEPRINT_DEADLINE_SECONDS", ge=10)
    blueprint_groq_stage_seconds: float = Field(120.0, alias="BLUEPRINT_GROQ_STAGE_SECONDS", ge=5)
    # Concurrent LLM calls inside one run (playbooks fan out one call per slot).
    blueprint_concurrency: int = Field(4, alias="BLUEPRINT_CONCURRENCY", ge=1, le=16)
    @property
    def blueprint_parallel(self) -> int:
        """Parallel LLM calls in a run: the configured number with Gemini; exactly 1 on the free-tier chain: Groq limits are per organization, so all keys share one 8k tokens/minute budget and
        parallel calls only rate-limit each other and the run stalls behind the slower fallbacks (measured 2026-10-08)."""
        return self.blueprint_concurrency if self.gemini_api_keys else 1

    # Whole-run ceiling; the API times a run out a little later (BLUEPRINT_RUN_TIMEOUT_MINUTES).
    blueprint_run_timeout_seconds: float = Field(900.0, alias="BLUEPRINT_RUN_TIMEOUT_SECONDS", ge=30)
    # Free-tier quota waits, as in question-content generation. With a paid Gemini key only the first two are used:
    # a Gemini failure is better retried soon than parked for minutes behind Groq's per-minute ledger.
    blueprint_quota_retries: int = Field(20, alias="BLUEPRINT_QUOTA_RETRIES", ge=0, le=60)
    # Retries of one LLM call on a transient failure (a malformed or truncated reply, a dropped connection).
    blueprint_transient_retries: int = Field(2, alias="BLUEPRINT_TRANSIENT_RETRIES", ge=0, le=10)
    # Runs executing at once; the rest queue (every run crawls when the free-tier quota is shared too widely).
    blueprint_max_parallel_runs: int = Field(3, alias="BLUEPRINT_MAX_PARALLEL_RUNS", ge=1, le=32)
    # Run traces are kept this long, except the run behind a session's current blueprint.
    blueprint_run_retention_days: int = Field(30, alias="BLUEPRINT_RUN_RETENTION_DAYS", ge=1)
    # Selection weights (§7.4) as JSON overrides of the defaults in app/blueprint/selection.py.
    blueprint_selection_weights: str = Field("", alias="BLUEPRINT_SELECTION_WEIGHTS")

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
