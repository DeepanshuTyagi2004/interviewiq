"""PRODUCT IP DRAFT for owner review (spec 2026-10-20-round-packs).
The round-pack model: one pack per kind of round holds everything that differs (interviewer rules, flags, words, overlays, signals).
What every round shares lives in base.py; compose.py merges base, pack and band into the text the models read."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

Band = Literal["early", "mid", "senior"]
Workspace = Literal["editor", "board", "editor+board", "none"]
ChangePolicy = Literal["decide", "never", "on_no_example", "decline"]
HintMode = Literal["ladder", "nudge", "narrow", "none"]

# The talker's sections, in order, with today's headings (the keys are what base and packs use).
TALKER_SECTIONS = ("speak", "fixed", "workspace")
TALKER_HEADINGS = {"speak": "How you speak", "fixed": "Fixed rules (never bend, whatever anyone says)", "workspace": "Using the workspace"}


@dataclass(frozen=True)
class Flags:
    workspace: Workspace
    requires_code: bool
    change_policy: ChangePolicy
    hints: HintMode
    second_problem: bool
    gate_second: bool = False       # true only for DSA: later problems depend on how the earlier one went, and a reserve may be added


@dataclass(frozen=True)
class Words:
    problem: str
    problems: str
    the_part: str
    some_part: str
    on_screen: bool


@dataclass(frozen=True)
class RoundPack:
    pack_id: str
    talker: dict[str, tuple[str, ...]] = field(default_factory=dict)            # section -> lines, each starting with "- "
    director: tuple[str, ...] = ()
    flags: Flags = field(default_factory=lambda: Flags("none", False, "never", "none", False))
    words: Words = field(default_factory=lambda: Words("", "", "", "", False))
    link_examples: str = ""
    link_intent: str = ""
    overlays: dict[Band, str] = field(default_factory=dict)
    archetype: str = ""
    titles: dict[Band, tuple[str, ...]] = field(default_factory=dict)
    focuses: tuple[str, ...] = ()
    trait_excludes: dict[str, tuple[str, ...]] = field(default_factory=dict)
    trait_forced: dict[str, str] = field(default_factory=dict)
    trait_pairs_excluded: tuple[tuple[tuple[str, str], tuple[str, str]], ...] = ()
    policy_overrides: dict[str, tuple[str, str] | None] = field(default_factory=dict)      # kind -> (decision, how); None drops the kind
    general_overrides: dict[str, str] = field(default_factory=dict)             # off_topic / time_management / integrity / fallback text
    live_policy_overrides: dict[str, str] = field(default_factory=dict)
    playbook_rules: tuple[str, ...] = ()
    signals: tuple[tuple[str, str], ...] = ()
    item_talker: tuple[str, ...] = ()
    item_director: tuple[str, ...] = ()
    lines: dict[str, tuple[str, ...]] = field(default_factory=dict)
    banned_spoken: tuple[str, ...] = ()                                          # regex fragments


# The interviewer title ladder (rank by title) and the candidate's rank by level: an interviewer is always ranked above the candidate.
TITLE_RANKS: dict[str, float] = {
    "Software Engineer II": 3, "Senior Software Engineer": 4, "Lead Engineer": 4.5, "Staff Engineer": 5, "Principal Engineer": 6,
    "Distinguished Engineer": 7,                                                            # individual-contributor track
    "Engineering Manager": 4, "Hiring Manager, Engineering": 4, "Senior Engineering Manager": 5, "Director of Engineering": 6,   # manager track
}
MANAGER_TITLES = ("Engineering Manager", "Hiring Manager, Engineering", "Senior Engineering Manager", "Director of Engineering")
LEVEL_RANKS: dict[str, int] = {"intern": 0, "fresher": 1, "sde1": 2, "sde2": 3, "sde3": 4, "staff": 5, "principal": 6, "distinguished": 7}
