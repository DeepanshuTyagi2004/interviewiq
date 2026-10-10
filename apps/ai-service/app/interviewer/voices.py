"""The interviewer's voice: Deepgram Aura-2 voices by default (a Flux voice name, e.g. the Indian-English ones, still works).
A woman interviewer speaks with the female voice and a man with the male one. The blueprint's persona carries a name from
the fixed interviewer pool (`blueprint/prompts.py: INTERVIEWER_NAMES`) and no gender field, so the gender comes from the
persona's `gender` when it has one, otherwise from that pool's first names; a name nobody knows gets the male voice."""
from __future__ import annotations

from typing import Any

from livekit.plugins import deepgram

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


def tts_voice(settings: Any, persona: dict[str, Any] | None) -> str:
    return settings.interviewer_female_tts_voice if persona_gender(persona) == "female" else settings.interviewer_tts_voice


def build_tts(voice: str, api_key: str, mip_opt_out: bool = True):
    """`flux-*` voices speak through the v2 endpoint; anything else is an Aura voice on the v1 endpoint. Candidates'
    speech is personal data, so by default Deepgram's model-improvement programme is opted out of."""
    if voice.startswith("flux-"):
        return deepgram.TTSv2(model=voice, api_key=api_key, mip_opt_out=mip_opt_out)
    return deepgram.TTS(model=voice, api_key=api_key, mip_opt_out=mip_opt_out)
