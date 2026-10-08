"""Typed boundary for LLM-assisted profile feature assessment.

The request is intentionally narrower than a candidate profile: callers must select and
minimize the evidence before it crosses into the LLM service.  The response is a set of
independent 0..100 feature inferences.  There is intentionally no overall profile-score
field anywhere in the LLM output or response models.
"""
from __future__ import annotations

import json
import re
import unicodedata
from datetime import datetime
from typing import Annotated, Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel

PROFILE_ASSESSMENT_ALGORITHM_VERSION = "profile-scoring-assessment-v1"
PROFILE_ASSESSMENT_PROMPT_VERSION = "profile-scoring-assessment-prompt-v5"
COMPANY_CONTEXT_PROMPT_VERSION = "profile-scoring-company-context-prompt-v5"

MAX_FEATURES = 24
MAX_EVIDENCE_ITEMS = 20
MAX_EXCERPTS_PER_ITEM = 8
MAX_TOTAL_INPUT_CHARS = 50_000


class _StrictCamelModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
        strict=True,
        hide_input_in_errors=True,
        str_strip_whitespace=True,
    )


ShortText = Annotated[str, Field(min_length=1, max_length=500)]
EvidenceExcerpt = Annotated[str, Field(min_length=1, max_length=800)]


class ProfileScoringUserContext(_StrictCamelModel):
    """Non-identifying context needed to interpret evidence."""

    target_role: str | None = Field(default=None, max_length=120)
    declared_level: str | None = Field(default=None, max_length=40)
    specialization: str | None = Field(default=None, max_length=120)
    years_experience: float | None = Field(default=None, ge=0, le=80, allow_inf_nan=False)


class ProfileScoringEvidence(_StrictCamelModel):
    """A caller-minimized project, employment, or internship evidence item.

    There are no identity, contact, URL, raw-document, or arbitrary metadata fields here.
    ``excerpts`` should be short caller-selected snippets rather than an entire résumé.
    """

    id: str | None = Field(default=None, max_length=80)
    title: ShortText
    summary: Annotated[str | None, Field(default=None, max_length=1_000)] = None
    technologies: list[ShortText] = Field(default_factory=list, max_length=20)
    outcomes: list[ShortText] = Field(default_factory=list, max_length=12)
    excerpts: list[EvidenceExcerpt] = Field(default_factory=list, max_length=MAX_EXCERPTS_PER_ITEM)


class ProfileScoringFeature(_StrictCamelModel):
    key: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
    description: Annotated[str | None, Field(default=None, max_length=500)] = None

    @field_validator("key")
    @classmethod
    def reject_aggregate_feature(cls, value):
        normalized = "".join(char for char in value.lower() if char.isalnum())
        if normalized in {"score", "overall", "overallscore", "overallprofilescore", "profilescore",
                          "finalscore", "finalprofilescore", "rank", "ranking", "recommendation"}:
            raise ValueError("aggregate profile decisions cannot be requested as features")
        return value


class ProfileScoringAssessmentRequest(_StrictCamelModel):
    """Minimized API -> ai-service request.

    ``experiences`` and ``experience`` are both accepted at the boundary for compatibility;
    serialization always emits ``experience``.  Requested features may be short strings or
    objects with a key/description, which keeps the caller contract convenient without making
    the prompt less explicit.
    """

    user_context: ProfileScoringUserContext
    projects: list[ProfileScoringEvidence] = Field(default_factory=list, max_length=MAX_EVIDENCE_ITEMS)
    experience: list[ProfileScoringEvidence] = Field(
        default_factory=list,
        validation_alias=AliasChoices("experience", "experiences"),
        max_length=MAX_EVIDENCE_ITEMS,
    )
    internships: list[ProfileScoringEvidence] = Field(default_factory=list, max_length=MAX_EVIDENCE_ITEMS)
    requested_features: list[ProfileScoringFeature] = Field(
        min_length=1,
        max_length=MAX_FEATURES,
        validation_alias=AliasChoices("requested_features", "requestedFeatures", "features"),
    )

    @field_validator("requested_features", mode="before")
    @classmethod
    def normalize_requested_features(cls, value):
        if not isinstance(value, list):
            return value
        return [{"key": item} if isinstance(item, str) else item for item in value]

    @model_validator(mode="after")
    def validate_request_budget(self):
        keys = [feature.key for feature in self.requested_features]
        if len(set(keys)) != len(keys):
            raise ValueError("requested_features must contain unique keys")
        # Field-level limits prevent individual oversized values. This aggregate cap prevents a
        # large number of individually valid snippets from becoming an unbounded prompt.
        serialized = json.dumps(self.model_dump(mode="json"), separators=(",", ":"))
        if len(serialized) > MAX_TOTAL_INPUT_CHARS:
            raise ValueError("minimized profile-scoring evidence exceeds the input size limit")
        return self


class ProfileScoringFeatureAssessment(_StrictCamelModel):
    """One bounded inference; values are percentages, not a final profile score."""

    feature: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
    value: float = Field(ge=0, le=100, allow_inf_nan=False)
    rationale: Annotated[str, Field(min_length=1, max_length=1_000)]
    evidence_excerpts: list[EvidenceExcerpt] = Field(max_length=8)
    evidence_type: Literal["INFERRED"]


class ProfileScoringLLMOutput(_StrictCamelModel):
    """Only the shape the model is allowed to produce.

    Strict extras are important: an ``overall_score`` emitted by a model must fail validation,
    rather than silently becoming an accepted decision signal.
    """

    assessments: list[ProfileScoringFeatureAssessment] = Field(min_length=1, max_length=MAX_FEATURES)


class ProfileScoringAssessmentResponse(_StrictCamelModel):
    """Validated response returned to the API caller; no aggregate score is representable."""

    assessments: list[ProfileScoringFeatureAssessment] = Field(min_length=1, max_length=MAX_FEATURES)
    provider: str = Field(min_length=1, max_length=120)
    model: str = Field(min_length=1, max_length=200)
    generated_at: datetime
    algorithm_version: str = Field(min_length=1, max_length=80)
    prompt_version: str = Field(min_length=1, max_length=80)


# Differences a model introduces when it copies a quote: typographic quotes, any hyphen or dash
# variant (gpt-oss often writes "long\u2011running" with a non-breaking hyphen), compatibility forms,
# markdown markers it drops, spacing it tidies or adds ("latency ." -> "latency.", "sub-200ms" ->
# "sub-200 ms") and "..." where it shortened the quote.
_QUOTE_FOLD = str.maketrans({
    "\u2018": "'", "\u2019": "'", "\u201a": "'", "\u201b": "'", "\u2032": "'",
    "\u201c": '"', "\u201d": '"', "\u201e": '"', "\u201f": '"', "\u2033": '"',
    "\u2010": "-", "\u2011": "-", "\u2012": "-", "\u2013": "-", "\u2014": "-", "\u2015": "-", "\u2212": "-",
    "\ufe58": "-", "\ufe63": "-", "\uff0d": "-", "\u2192": "->", "\u00ad": "",
})
_QUOTE_SKIP = frozenset("*`")
# Where a model joins or shortens quotes: "..." and line breaks (it joins separate bullets with "\n").
_QUOTE_BREAK = re.compile(r"\.{3,}|…|\n")
_MIN_QUOTE_CHARS = 3
_MAX_QUOTES = 8
_UNSUPPORTED_RATIONALE = "The quoted evidence was not found in the input, so this feature is not assessed."


def _canonical(text: str) -> tuple[str, list[int]]:
    """Lower-cased text without those differences (and without any whitespace), plus the index in
    ``text`` of each kept character."""

    chars: list[str] = []
    index: list[int] = []
    for i, raw in enumerate(text):
        for char in unicodedata.normalize("NFKC", raw).translate(_QUOTE_FOLD):
            if char in _QUOTE_SKIP or char.isspace():
                continue
            lower = char.lower()
            chars.append(lower if len(lower) == 1 else char)
            index.append(i)
    return "".join(chars), index


def _locate(fragment: str, snippets: list[tuple[str, str, list[int]]]) -> str | None:
    """The verbatim input span that ``fragment`` quotes, or None."""

    target, _ = _canonical(fragment)
    if len(target) < _MIN_QUOTE_CHARS:
        return None
    for snippet, text, index in snippets:
        if fragment in snippet:
            return fragment
        at = text.find(target)
        if at >= 0:
            return snippet[index[at]: index[at + len(target) - 1] + 1]
    return None


def ground_llm_assessment(
    output: ProfileScoringLLMOutput,
    request: ProfileScoringAssessmentRequest,
) -> tuple[ProfileScoringLLMOutput, list[str]]:
    """Replace every quoted excerpt with the exact input text it quotes.

    Each quote (or each part of a quote shortened with "..." or joined across lines) is matched against the input while
    ignoring the copy differences above, then replaced by the verbatim input span, so the exact
    checks downstream (here and in the API) hold. A quote that matches nothing is dropped. A
    feature left without a quote has no supported value: it becomes 0 with no excerpts, which the
    API treats as unavailable, not as a weak score. Returns the grounded output and those features.
    """

    snippets = [(text, *_canonical(text))
                for item in [*request.projects, *request.experience, *request.internships]
                for text in [item.title, item.summary or "", *item.outcomes, *item.excerpts] if text]
    grounded: list[ProfileScoringFeatureAssessment] = []
    unsupported: list[str] = []
    for assessment in output.assessments:
        quotes: list[str] = []
        for quote in assessment.evidence_excerpts:
            for part in _QUOTE_BREAK.split(quote):
                span = _locate(part.strip(), snippets)
                if span and span not in quotes:
                    quotes.append(span)
        quotes = quotes[:_MAX_QUOTES]
        if not quotes and assessment.value != 0:
            unsupported.append(assessment.feature)
            grounded.append(assessment.model_copy(update={"value": 0.0, "evidence_excerpts": [], "rationale": _UNSUPPORTED_RATIONALE}))
        else:
            grounded.append(assessment.model_copy(update={"evidence_excerpts": quotes}))
    return output.model_copy(update={"assessments": grounded}), unsupported


def validate_llm_assessment(
    output: ProfileScoringLLMOutput,
    request: ProfileScoringAssessmentRequest,
) -> None:
    """Apply deterministic request/response checks after Pydantic shape validation."""

    expected = [feature.key for feature in request.requested_features]
    actual = [assessment.feature for assessment in output.assessments]
    if len(actual) != len(expected) or set(actual) != set(expected) or len(set(actual)) != len(actual):
        raise ValueError("LLM assessment features must exactly match requested_features")
    for assessment in output.assessments:
        if assessment.evidence_type != "INFERRED":
            raise ValueError("LLM assessment evidence_type must be INFERRED")
        snippets = [text for item in [*request.projects, *request.experience, *request.internships]
                    for text in [item.title, item.summary or "", *item.outcomes, *item.excerpts]]
        if any(not any(quote in snippet for snippet in snippets)
               for quote in assessment.evidence_excerpts):
            raise ValueError("LLM assessment excerpts must quote supplied evidence")
        if not assessment.evidence_excerpts and assessment.value != 0:
            raise ValueError("unsupported feature assessments must have zero value")


# --- company context (general knowledge for the scoring knowledge base) -------------------------

# The bands LinkedIn and most company profiles use, so a stated band maps one to one.
SizeBand = Literal["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-20000", "20000+"]
ShortTag = Annotated[str, Field(min_length=1, max_length=80)]


class CompanyContextRequest(_StrictCamelModel):
    """Only a company name crosses this boundary: never a candidate's own text or identity."""

    company_name: str = Field(min_length=1, max_length=120)


SIZE_BANDS: tuple[tuple[str, int], ...] = (("1-10", 10), ("11-50", 50), ("51-200", 200), ("201-500", 500), ("501-1000", 1000),
                                            ("1001-5000", 5000), ("5001-20000", 20000), ("20000+", 10**9))


def size_band(value):
    """An allowed band as-is; a headcount or a range ("201-500", "300+", "about 2,000") mapped to the band
    containing its midpoint; anything else null."""
    if value is None or not isinstance(value, str | int | float) or isinstance(value, bool):
        return None
    text = str(value).strip()
    if text in {band for band, _ in SIZE_BANDS}:
        return text
    numbers = [float(n.replace(",", "")) for n in re.findall(r"\d[\d,]*(?:\.\d+)?", text)]
    if not numbers:
        return None
    k = 1000 if re.search(r"\d\s*k\b", text, re.I) else 1
    estimate = (numbers[0] + numbers[1]) / 2 * k if len(numbers) >= 2 else numbers[0] * k
    return next(band for band, upper in SIZE_BANDS if estimate <= upper)


def headcount(value):
    """A stated headcount as an int: 282, "282", "170+", "about 2,000", "15k". Anything else null."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        return int(value) if 1 <= value <= 10_000_000 else None
    if not isinstance(value, str):
        return None
    match = re.search(r"\d[\d,]*(?:\.\d+)?", value)
    if not match:
        return None
    number = float(match.group(0).replace(",", "")) * (1000 if re.search(r"\d\s*k\b", value, re.I) else 1)
    return int(number) if 1 <= number <= 10_000_000 else None


def _keyword(value, rules: list[tuple[str, tuple[str, ...]]]):
    """Map free text to the first allowed value whose keywords it contains; otherwise null."""
    if not isinstance(value, str):
        return None
    text = value.strip().lower()
    for allowed, words in rules:
        if text == allowed or any(word in text for word in words):
            return allowed
    return None


class CompanyContextLLMOutput(_StrictCamelModel):
    """Engineering-relevant facts from general knowledge. There is no score or prestige field.

    ``known`` must be false (with every fact null/empty) when the model cannot confidently identify
    the company; unknown companies must never be guessed into the knowledge base.
    """

    known: bool
    industry: str | None = Field(default=None, max_length=120)
    company_size: SizeBand | None = None
    engineering_size: SizeBand | None = None
    product_type: Literal["product", "services", "mixed", "non_tech"] | None = None
    technical_domains: list[ShortTag] = Field(default_factory=list, max_length=8)
    known_technologies: list[ShortTag] = Field(default_factory=list, max_length=10)
    internship_program: str | None = Field(default=None, max_length=200)
    internship_selectivity: float | None = Field(default=None, ge=0, le=100, allow_inf_nan=False)
    geographic_scope: Literal["local", "national", "multinational"] | None = None
    company_stage: Literal["startup", "growth", "late-stage", "public", "enterprise"] | None = None
    # The stated numbers behind the bands, and where they come from (explainable size).
    company_headcount: int | None = Field(default=None, ge=1, le=10_000_000)
    engineering_headcount: int | None = Field(default=None, ge=1, le=10_000_000)
    size_evidence: str | None = Field(default=None, max_length=300)

    @field_validator("company_headcount", "engineering_headcount", mode="before")
    @classmethod
    def _headcount(cls, value):
        return headcount(value)

    @field_validator("size_evidence", mode="before")
    @classmethod
    def _short_evidence(cls, value):
        return value.strip()[:300] or None if isinstance(value, str) else None

    @field_validator("technical_domains", "known_technologies", mode="before")
    @classmethod
    def _null_list_is_empty(cls, value, info):
        # Models often send null for "no known domains" (an empty list, not invalid output) or a few
        # more entries than the cap; keep the first ones rather than discarding the whole answer.
        if value is None:
            return []
        limit = 8 if info.field_name == "technical_domains" else 10
        return value[:limit] if isinstance(value, list) else value

    # Near-miss values ("201-500", "Late-stage startup", "India and global") are mapped to the closest
    # allowed value; anything unrecognizable becomes null (unknown). Output stays strictly valid.
    @field_validator("company_size", "engineering_size", mode="before")
    @classmethod
    def _size_band(cls, value):
        return size_band(value)

    @field_validator("product_type", mode="before")
    @classmethod
    def _product_type(cls, value):
        return _keyword(value, [("non_tech", ("non_tech", "non-tech", "non tech")), ("mixed", ("mixed", "both", "hybrid")),
                                ("services", ("service", "consult", "outsourc", "agency")), ("product", ("product", "platform", "saas"))])

    @field_validator("geographic_scope", mode="before")
    @classmethod
    def _geographic_scope(cls, value):
        return _keyword(value, [("multinational", ("multinational", "global", "international", "worldwide")),
                                ("national", ("national", "india", "country")), ("local", ("local", "city", "regional"))])

    @field_validator("company_stage", mode="before")
    @classmethod
    def _company_stage(cls, value):
        return _keyword(value, [("public", ("public", "listed", "ipo")), ("late-stage", ("late",)), ("enterprise", ("enterprise", "conglomerate")),
                                ("growth", ("growth", "series", "scale")), ("startup", ("startup", "seed", "early"))])

    @field_validator("internship_program", mode="before")
    @classmethod
    def _internship_program(cls, value):
        if value is True:
            return "Runs an internship program."
        return None if value is False else value

    @model_validator(mode="after")
    def bands_follow_headcount(self):
        # A stated number decides its band, so a band and its headcount can never disagree.
        if self.company_headcount is not None:
            self.company_size = size_band(self.company_headcount)
        if self.engineering_headcount is not None:
            self.engineering_size = size_band(self.engineering_headcount)
        return self

    @model_validator(mode="after")
    def unknown_is_empty(self):
        if not self.known and (self.industry or self.company_size or self.engineering_size or self.product_type or self.technical_domains
                               or self.known_technologies or self.internship_program or self.internship_selectivity is not None
                               or self.geographic_scope or self.company_stage or self.company_headcount or self.engineering_headcount
                               or self.size_evidence):
            raise ValueError("an unknown company must not carry guessed facts")
        return self


EvidenceUrl = Annotated[str, Field(min_length=1, max_length=500)]
MAX_EVIDENCE_URLS = 5


class CompanyContextWebOutput(CompanyContextLLMOutput):
    """Facts extracted from web search results. Every fact must be backed by cited result URLs."""

    evidence_urls: list[EvidenceUrl] = Field(default_factory=list, max_length=MAX_EVIDENCE_URLS)

    @field_validator("evidence_urls", mode="before")
    @classmethod
    def _null_urls_is_empty(cls, value):
        return [] if value is None else value


class CompanyContextResponse(CompanyContextLLMOutput):
    # Where the facts came from: the model's own knowledge, web search results, or nowhere (unknown).
    basis: Literal["model_knowledge", "web_search", "none"]
    evidence_urls: list[EvidenceUrl] = Field(default_factory=list, max_length=MAX_EVIDENCE_URLS)
    provider: str = Field(min_length=1, max_length=120)
    model: str = Field(min_length=1, max_length=200)
    generated_at: datetime
    prompt_version: str = Field(min_length=1, max_length=80)
