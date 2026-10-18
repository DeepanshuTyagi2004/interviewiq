"""The interviewer's voice: Deepgram Aura-2 voices by default (a Flux voice name, e.g. the Indian-English ones, still works).
Every interviewer is a man (decided 2026-10-16): the male voice always, and a blueprint prepared before that with a woman's
name (`blueprint/prompts.py: INTERVIEWER_NAMES` was mixed) is run under a man's name (`male_persona`)."""
from __future__ import annotations

from typing import Any

from livekit.agents import utils
from livekit.agents.tokenize import tokenizer as _tokenizer
from livekit.plugins import deepgram, sarvam

FEMALE = frozenset({"female", "woman", "f"})
MALE = frozenset({"male", "man", "m"})
# First names of the women in the interviewer pool; "Kaur" settles the unisex "Harpreet".
FEMALE_FIRST_NAMES = frozenset({"ananya", "priya", "meera", "sneha", "aisha", "neha", "divya", "kavya", "ishita", "pooja", "lakshmi",
                                "tanvi", "nandini", "ritika", "shreya", "zoya", "anjali"})
FEMALE_SURNAMES = frozenset({"kaur"})


def persona_gender(persona: dict[str, Any] | None) -> str:
    """"female" or "male": the persona's own `gender` if it says one, otherwise judged from its name."""
    persona = persona or {}
    stated = str(persona.get("gender") or "").strip().lower()
    if stated in FEMALE:
        return "female"
    if stated in MALE:
        return "male"
    parts = str(persona.get("name") or "").lower().split()
    if parts and (parts[0] in FEMALE_FIRST_NAMES or parts[-1] in FEMALE_SURNAMES):
        return "female"
    return "male"


def uses_sarvam(settings: Any) -> bool:
    return str(settings.interviewer_tts_provider).strip().lower() == "sarvam"


def tts_voice(settings: Any, persona: dict[str, Any] | None) -> str:
    """The male voice: every interviewer is a man."""
    return settings.sarvam_tts_voice if uses_sarvam(settings) else settings.interviewer_tts_voice


def male_persona(persona: dict[str, Any] | None, seed: str) -> dict[str, Any]:
    """The persona to run: a woman's (from a blueprint prepared when the pool was mixed) gets a man's name, the same one every
    time for this round, put in place of her first name wherever the persona text uses it."""
    persona = dict(persona or {})
    if persona_gender(persona) == "male":
        return persona
    from app.blueprint.stages import name_options      # the prep pool and its seeded pick
    old_first = str(persona.get("name") or "").split(" ")[0]
    name = name_options(f"live:{seed}", k=1)[0]
    first = name.split(" ")[0]
    out = {k: (v.replace(old_first, first) if old_first and isinstance(v, str) else v) for k, v in persona.items()}
    out["name"] = name
    out.pop("gender", None)
    return out


class _EachPushIsASentence(_tokenizer.SentenceStream):
    """Hands every pushed chunk to the voice at once. LiveKit's default sentence stream keeps the last sentence back until the next
    one has started (it cannot know a period ends a sentence), so the first sentence of a reply was only spoken after the model had
    finished writing the second."""

    def __init__(self) -> None:
        super().__init__()
        self._segment_id = utils.shortuuid()

    def push_text(self, text: str) -> None:
        self._check_not_closed()
        if text.strip():
            self._event_ch.send_nowait(_tokenizer.TokenData(token=text.strip(), segment_id=self._segment_id))

    def flush(self) -> None:
        self._segment_id = utils.shortuuid()

    def end_input(self) -> None:
        self.flush()
        self._do_close()

    async def aclose(self) -> None:
        self._do_close()


class WholeSentenceTokenizer(_tokenizer.SentenceTokenizer):
    """For text that arrives one finished sentence per push: InterviewerAgent.llm_node yields only sentences the leak guard has passed,
    and session.say() pushes one whole line. Not for a stream of arbitrary token fragments."""

    def tokenize(self, text: str, *, language: str | None = None) -> list[str]:
        return [text.strip()] if text.strip() else []

    def stream(self, *, language: str | None = None) -> _tokenizer.SentenceStream:
        return _EachPushIsASentence()


def build_tts_for(settings: Any, voice: str):
    if uses_sarvam(settings):
        tts = sarvam.TTS(model=settings.sarvam_tts_model, target_language_code="en-IN", speaker=voice,
                         api_key=settings.sarvam_api_key, speech_sample_rate=24000,
                         min_buffer_size=getattr(settings, "sarvam_tts_min_buffer_size", 30))
        # The plugin builds its own sentence tokenizer and offers no argument for it; each stream copies the options when it starts.
        tts._opts.word_tokenizer = WholeSentenceTokenizer()
        return tts
    return build_tts(voice, settings.deepgram_api_key, settings.deepgram_mip_opt_out)


def build_tts(voice: str, api_key: str, mip_opt_out: bool = True):
    """`flux-*` voices speak through the v2 endpoint; anything else is an Aura voice on the v1 endpoint. Candidates'
    speech is personal data, so by default Deepgram's model-improvement programme is opted out of."""
    if voice.startswith("flux-"):
        return deepgram.TTSv2(model=voice, api_key=api_key, mip_opt_out=mip_opt_out)
    return deepgram.TTS(model=voice, api_key=api_key, mip_opt_out=mip_opt_out)
