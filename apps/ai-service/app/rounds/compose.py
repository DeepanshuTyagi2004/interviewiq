"""PRODUCT IP DRAFT for owner review (spec 2026-10-20-round-packs).
Merges the shared base, a round pack and the level band into the text the talker and the director read, and builds the `rules` block
a blueprint carries (so a stored interview keeps the rules it was prepared with)."""
from __future__ import annotations

from dataclasses import asdict

from app.blueprint.vocabulary import family
from app.rounds import behavioural, dsa, hiring_manager, lld, online_assessment, system_design
from app.rounds.base import BASE_DIRECTOR, BASE_DIRECTOR_HEAD, BASE_TALKER, BASE_TALKER_TAIL
from app.rounds.pack import TALKER_HEADINGS, TALKER_SECTIONS, Band, RoundPack

RULES_VERSION = "rules1"

# Registered packs, keyed by round type or by family.
PACKS: dict[str, RoundPack] = {"dsa": dsa.PACK, "system-design": system_design.PACK, "lld": lld.PACK, "behavioural": behavioural.PACK,
                               "hiring-manager": hiring_manager.PACK, "online-assessment": online_assessment.PACK}

# The packs whose rounds hold a behavioural culture slot, and so also carry the behavioural pack's rules for running one question.
_ITEM_RULE_PACKS = ("dsa", "lld", "system-design")

_BANDS: dict[str, Band] = {"intern": "early", "fresher": "early", "sde1": "mid", "sde2": "mid", "sde3": "senior", "staff": "senior",
                           "principal": "senior", "distinguished": "senior"}


def band_for(level: str | None) -> Band:
    return _BANDS.get(level or "", "mid")


def pack_for(round_type: str | None) -> RoundPack:
    """The pack registered for this exact round type, else for its family, else the DSA pack."""
    if round_type in PACKS:
        return PACKS[round_type]
    return PACKS.get(family(round_type or ""), PACKS["dsa"])


def _overlay_line(pack: RoundPack, band: Band) -> str:
    text = (pack.overlays.get(band) or "").strip()
    return text if not text or text.startswith("- ") else "- " + text


def compose_talker(pack: RoundPack, band: Band) -> str:
    """Per section: the base lines, then the pack's; the band overlay and the log_turn tail close the last section."""
    blocks = []
    for n, section in enumerate(TALKER_SECTIONS):
        lines = [*BASE_TALKER.get(section, ()), *pack.talker.get(section, ())]
        if n == len(TALKER_SECTIONS) - 1:
            lines += [overlay for overlay in (_overlay_line(pack, band),) if overlay] + [BASE_TALKER_TAIL]
        blocks.append("\n".join([TALKER_HEADINGS[section], *lines]))
    return "\n\n".join(blocks).replace("{link_examples}", pack.link_examples)


def compose_director(pack: RoundPack, band: Band) -> str:
    lines = [*BASE_DIRECTOR, *pack.director] + [overlay for overlay in (_overlay_line(pack, band),) if overlay]
    return "\n".join([BASE_DIRECTOR_HEAD, *lines])


def _item_rules(pack: RoundPack) -> dict:
    if pack.pack_id not in _ITEM_RULE_PACKS:
        return {}
    return {"behavioural": {"talker": "\n".join(behavioural.PACK.item_talker), "director": "\n".join(behavioural.PACK.item_director)}}


def compose_rules(round_type: str | None, level: str | None, focus: str | None = None) -> dict:
    pack, band = pack_for(round_type), band_for(level)
    return {
        "version": RULES_VERSION, "pack": pack.pack_id, "band": band,
        "talker": compose_talker(pack, band), "director": compose_director(pack, band),
        "item_rules": _item_rules(pack),
        "flags": asdict(pack.flags), "words": asdict(pack.words), "part_nouns": [pack.words.some_part, pack.words.the_part],
        "link_examples": pack.link_examples, "link_intent": pack.link_intent,
        "live_policies": dict(pack.live_policy_overrides), "focus": focus, "banned_spoken": list(pack.banned_spoken),
    }


def rules_of(blueprint: dict | None) -> dict:
    """The rules stored on the blueprint; a blueprint prepared before packs gets them composed from its round. Never raises."""
    try:
        stored = (blueprint or {}).get("rules")
        if stored:
            flags = stored.get("flags") or {}
            if "gate_second" not in flags:      # a block stored before gate_second existed: the flag defaults from its pack
                stored = {**stored, "flags": {**flags, "gate_second": bool(pack_for(stored.get("pack")).flags.gate_second)}}
            return stored
        rnd = (blueprint or {}).get("round") or {}
        return compose_rules(rnd.get("type"), rnd.get("level_canonical") or rnd.get("level"))
    except Exception:
        return compose_rules(None, None)
