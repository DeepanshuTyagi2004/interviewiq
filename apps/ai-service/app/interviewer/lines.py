"""The lines the run says in fixed words, as small pools (decided 2026-10-18; spec "Lines that are fixed today get variety").

A fixed line carries a meaning the conductor and the checks depend on, so it cannot be left to a model; but one wording said in every round
sounds like a script. Each line is a pool of 3-6 wordings with the same meaning (warnings and endings: 2-3, the same firmness, and never softer),
picked at random with no repeat inside a round until the pool is used up (`LinePicker`). The first wording of each pool is today's. Every matcher
that used to key on today's exact words asks `matches(key, text)` instead, so it recognises every wording. No wording may contain a length of
time (the `time_spoken` guard), a question mark where the line is followed by another sentence, or a phrase that other guards read as a claim
(the line dropping, "leave it there" after a coding-over acknowledgement)."""
from __future__ import annotations

import hashlib
import random
import re
from typing import Any, Callable, Collection

from app.rounds.compose import PACKS, rules_of

ORDINALS = ("first", "second", "third", "fourth")
SENTENCE_END = re.compile(r"(?<=[.?!])\s+")

# The put-up line is said while the problem goes up; the intro line invites them to read it once the screen has changed. Both name the problem's
# position ("{o}"), and every second sentence keeps "give it a read" (the guards that look for the invitation key on it).
_PUT_UP = ("Let me put the {o} problem on your screen.", "I'll put the {o} problem up on your screen.", "Let me bring the {o} problem up on your screen.",
           "Let me get the {o} problem up on your screen.", "Let me pull the {o} problem up on your screen.")
_INTRO = ("Here's your {o} question. Give it a read, and let me know if you have any questions.",
          "Here's your {o} question. Give it a read, and let me know if anything is unclear.",
          "Here is your {o} question. Give it a read, and ask me if anything isn't clear.",
          "Here's your {o} question. Give it a read, and let me know if you'd like to ask anything.")

# A screen warning is said alone, in fixed words: the mention (what happened and what to do), the final warning (what to do and what follows) and
# the ending. Each kind's wordings say the same thing with the same firmness.
_MENTION = {
    "tab_hidden": ("I noticed you switched to another tab. Please stay on this screen for the rest of the round.",
                   "You switched to another tab just now. Please stay on this screen for the rest of the round.",
                   "I saw you move to another tab. Please stay on this screen for the rest of the round."),
    "window_blur": ("I noticed you moved to another window. Please stay on this screen for the rest of the round.",
                    "You moved to another window just now. Please stay on this screen for the rest of the round.",
                    "I saw you click away to another window. Please stay on this screen for the rest of the round."),
    "external_display": ("I noticed a second display is connected. Please use only this screen for the rest of the round.",
                         "A second display is connected. Please use only this screen for the rest of the round.",
                         "I see a second display connected. Please use only this screen for the rest of the round."),
    "fullscreen_exit": ("I noticed you left full screen. Please stay on this screen for the rest of the round.",
                        "You left full screen just now. Please stay on this screen for the rest of the round.",
                        "I saw you leave full screen. Please stay on this screen for the rest of the round."),
    "share_stopped": ("I noticed your screen share stopped. Please share your entire screen again.",
                      "Your screen share stopped just now. Please share your entire screen again.",
                      "I see your screen share has stopped. Please share your entire screen again."),
    "default": ("I noticed you left the interview screen. Please stay on this screen for the rest of the round.",
                "You left the interview screen just now. Please stay on this screen for the rest of the round.",
                "I saw you leave the interview screen. Please stay on this screen for the rest of the round."),
}
_FINAL = {
    "tab_hidden": ("please stay on this screen", "If you leave it again, I'll have to end the interview."),
    "window_blur": ("please stay in this window", "If you leave it again, I'll have to end the interview."),
    "external_display": ("please use only this screen", "If I see it again, I'll have to end the interview."),
    "fullscreen_exit": ("please stay in full screen", "If you leave it again, I'll have to end the interview."),
    "share_stopped": ("please keep sharing your entire screen", "If it stops again, I'll have to end the interview."),
}


def _final(ask: str, then: str) -> tuple[str, ...]:
    return (f"This is your final warning: {ask}. {then}", f"This is your final warning, {ask}. {then}", f"Final warning: {ask}. {then}")


LINES: dict[str, tuple[str, ...]] = {
    # Addressed-to-interviewer pools (decided 2026-10-19): a check-in when an unclear utterance may or may not be for the interviewer, a nudge
    # after silence following it, and a reading remark while the candidate reads the problem aloud. Neutral; none echoes the candidate's words.
    "addressed:checkin": (
        "Is that one for me, or are you thinking it through?", "Was that a question for me, or are you working it out?",
        "Do you want me to answer that, or are you thinking out loud?", "Is that for me, or just thinking aloud?",
        "Are you asking me, or working through it yourself?", "Should I jump in on that, or are you still thinking?",
        "Is that something you'd like me to answer?", "Was that aimed at me, or part of your thinking?",
        "Do you want my input there, or are you mid-thought?", "Is that for me, or are you talking it through?",
        "Quick check: was that a question for me?", "Just to be sure, are you asking me that?",
        "Do you want me to weigh in, or are you still working on it?", "Was that directed at me, or are you reasoning it out?",
        "Should I answer that one, or let you think?", "Is that a question for me, or one you're asking yourself?",
        "Do you need something from me there, or are you thinking?", "Was that for me? Happy to answer, or to let you think.",
        "Are you looking for an answer from me on that?", "Is that you thinking out loud, or something for me?",
        "Just checking, should I respond to that?", "Is that one you want me to take, or are you on it?",
        "Do you want me to step in there, or keep going?", "Was that meant for me, or are you working through it?"),
    "addressed:nudge": (
        "Take your time.", "No rush, I'm here whenever you want me.", "Go ahead whenever you're ready.", "Whenever you're ready, just say.",
        "I'm happy to wait.", "Whenever you want to continue, go ahead.", "Think it through, I'll wait.",
        "Let me know if you'd like me to weigh in.", "No pressure, keep going when you're ready.", "I'm here if you need me.",
        "Feel free to keep thinking.", "All good, carry on when you're ready.", "Take a moment, there's no hurry.",
        "Just say if you want me to jump in.", "Keep going at your own pace.", "I'll wait, carry on whenever you like."),
    "addressed:reading": (
        "Take your time reading it.", "No rush, read it through.", "Read it at your own pace.", "Take as long as you need with it.",
        "Go ahead and read it through.", "Take a moment with it.", "No hurry, have a good read.", "Read it through, I'll wait.",
        "Take your time with the problem.", "Have a read, no rush at all.", "Go through it at your own pace.",
        "Settle into it, take your time."),
    "swap_put_up": ("Sure, no problem. Let me put a different problem on your screen.", "Of course. Let me put a different problem on your screen.",
                    "Okay. I'll put a different problem up on your screen.", "No problem. Let me bring a different problem up on your screen.",
                    "Alright, let me swap it. I'll put a different problem on your screen."),
    "give_up": ("Okay, since you'd like a change, let's leave this one there.", "Alright, since you'd like a change, let's leave this one there.",
                "I hear you. Let's leave this one there.", "That's fine, let's leave this one there.", "No problem, let's leave this one there."),
    "coding_over": ("Okay, that's fine.", "Alright, that's fine.", "No problem, that's fine.", "Sure, that's alright.", "No worries, that's fine.",
                    "That's alright."),
    # The sentence that moves from the conversation to a problem, said by the run on its own just before the put-up line (the model never improvises
    # it, decided 2026-10-18 after live round c8e70bb8): "first" for the first problem of the round, "next" for a later one.
    "bridge:first": ("Okay, so I think it's time to head into the coding now.", "Alright, I think we can move into the coding part now.",
                     "Okay, so I think we should go into the coding now.", "Alright, I think we're ready to head into the coding now."),
    "bridge:next": ("Let's go on to the next problem.", "Let's turn to the next problem.", "Let's head to the next problem."),
    "unclear": ("Sorry, I didn't quite catch that.", "I didn't quite catch that.", "I missed that, sorry.", "I didn't get that last part."),
    "presence": ("Yes, I'm here.", "I'm here.", "Still here, yes.", "I'm with you."),
    "line_check": ("Yes, I'm here.", "I can hear you fine.", "You're coming through fine.", "I hear you loud and clear."),
    "yield": ("Sorry, go ahead.", "Please, go ahead.", "Oh, you go ahead.", "Carry on, please."),
    "go_ahead": ("Sure, go ahead.", "Okay, go ahead.", "Alright, go ahead.", "Go ahead, please."),
    "neutral": ("Could you say a bit more about that?", "What's your thinking there?", "Where would you take it from here?", "How would you approach that?",
                "What would you try next?"),
    "backchannel": ("Mm-hmm.", "Mm.", "Right.", "Yeah.", "Okay."),
    "proctor_end": ("I'm going to end the interview here, because of repeated screen switching. Thank you for your time.",
                    "I'm ending the interview here, because you have repeatedly left the screen. Thank you for your time.",
                    "I have to end the interview here, because of the repeated screen switching. Thank you for your time."),
    "conduct_warning": ("That isn't appropriate in an interview, and it must not happen again.",
                        "That's not appropriate in an interview, and it must not happen again.",
                        "That isn't acceptable in an interview, and it must not happen again."),
    "abuse_end": ("I'm going to end the interview here because of that remark. Thank you for your time.",
                  "I'm ending the interview here because of that remark. Thank you for your time.",
                  "I have to end the interview here because of that remark. Thank you for your time."),
    "conduct_end": ("I'm going to end the interview here, because of repeated unacceptable conduct. Thank you for your time.",
                    "I'm ending the interview here, because of repeated unacceptable conduct. Thank you for your time.",
                    "I have to end the interview here, because of repeated unacceptable conduct. Thank you for your time."),
    "away_overstay:mention_violation": ("You're still away from the screen. Please come back to it now.",
                                        "You still haven't come back to the screen. Please come back to it now.",
                                        "You're still not back on the screen. Please come back to it now."),
    "away_overstay:final_warning": ("You're still away from the screen. This is your final warning: come back now, or I'll have to end the interview.",
                                    "You still haven't come back to the screen. This is your final warning: come back now, or I'll have to end the interview.",
                                    "You're still not back on the screen. Final warning: come back now, or I'll have to end the interview."),
    # Said once when they come back after a warning (owner 2026-10-20); the round carries on from where it stopped. Nothing about time or the screen.
    "away:back": ("Welcome back.", "Okay, welcome back.", "Good, you're back.", "Alright, welcome back.", "Thanks for coming back.",
                  "Okay, let's pick up where we were.", "Good to have you back.", "Alright, let's carry on."),
}
for _n, _o in enumerate(ORDINALS):
    LINES[f"put_up:{_o}"] = tuple(v.format(o=_o) for v in _PUT_UP)
    LINES[f"intro:{_o}"] = tuple(v.format(o=_o) for v in _INTRO)
for _kind, _variants in _MENTION.items():
    LINES[f"violation:{_kind}"] = _variants
for _kind, (_ask, _then) in _FINAL.items():
    LINES[f"final_warning:{_kind}"] = _final(_ask, _then)

# What the run keeps in the history as "the interviewer warned": every mention, final warning and return warning (not the endings, not conduct).
SCREEN_WARNING_KEYS = ("violation", "final_warning", "away_overstay")
# Everything said alone and never softened: the warnings and the endings. Exempt from the opener guard.
SAFETY_KEYS = (*SCREEN_WARNING_KEYS, "proctor_end", "conduct_warning", "abuse_end", "conduct_end")


def _norm(text: str) -> str:
    t = (text or "").removesuffix(" (interrupted)").lower().replace("’", "'").replace("‘", "'")
    return " ".join(re.sub(r"[^a-z0-9 ]", " ", t.replace("'", "")).split())


def _group(key: str) -> str:
    return key.split("@")[0].split(":")[0]


def _sentences(text: str) -> list[str]:
    return [x for x in SENTENCE_END.split((text or "").strip()) if x]


# Which sentences of a wording carry its meaning and so match on their own. A line that is an acknowledgement and then the sentence that matters ("Sure,
# no problem. Let me put a different problem on your screen.") is known by the last one only ("Sure." and "No problem." are the interviewer's own words
# elsewhere), and an ending by its first sentence (the "Thank you for your time." that closes it is shared by every ending). The whole wording always matches.
_CARRIER = {"swap_put_up": slice(-1, None), "give_up": slice(-1, None), "proctor_end": slice(0, 1), "abuse_end": slice(0, 1), "conduct_end": slice(0, 1)}


def _index() -> dict[str, frozenset[str]]:
    out: dict[str, frozenset[str]] = {}
    for key, variants in LINES.items():
        forms = {_norm(v) for v in variants}
        for v in variants:
            forms.update(_norm(s) for s in _sentences(v)[_CARRIER.get(_group(key), slice(None))])
        out[key] = frozenset(f for f in forms if f)
    return out


_FORMS = _index()


def keys_of(key: str) -> list[str]:
    """`key` itself, or every key of the group it names ("put_up" is put_up:first, put_up:second, ...)."""
    if key in LINES:
        return [key, *(k for k in LINES if k.startswith(key + "@"))]       # the pack wordings of the same line count too
    return [k for k in LINES if k.startswith(key + ":")]


def matches(key: str, text: str) -> bool:
    """The text is one wording of the line (or one sentence of a wording of it): the whole text, as the history keeps it. A group key
    ("violation", "put_up") matches any key of the group."""
    t = _norm(text)
    return bool(t) and any(t in _FORMS[k] for k in keys_of(key))


def matches_any(text: str, keys: tuple[str, ...]) -> bool:
    return any(matches(k, text) for k in keys)


def contains(key: str, text: str) -> bool:
    """Some sentence of the text is a wording of the line ("Sorry, I missed that. Which project was it?" contains an "unclear" line)."""
    return any(matches(key, s) for s in _sentences(text))


def sentence_part(key: str, sentence: str) -> int | None:
    """Which sentence of a wording of `key` (0 is the first) this sentence is, or None. The intro line is two: the first names the question,
    the second invites them to read it."""
    t = _norm(sentence)
    if not t:
        return None
    for k in keys_of(key):
        for variant in LINES[k]:
            for n, s in enumerate(_sentences(variant)):
                if _norm(s) == t:
                    return n
    return None


def ordinal_of(sentence: str) -> str | None:
    """The position a put-up or intro sentence names ("second"), None for any other sentence."""
    t = _norm(sentence)
    return next((o for o in ORDINALS if t and any(t in _FORMS[k] for k in (*keys_of(f"put_up:{o}"), *keys_of(f"intro:{o}")))), None)


def _put_up_pattern(template: str) -> re.Pattern[str]:
    return re.compile(r"\b" + re.escape(template.rstrip(".")).replace(re.escape("{o}"), "(first|second|third|fourth)").replace("'", "['\u2019]") + r"\b",
                      re.IGNORECASE)


# (pattern, the ordinal it names when the wording has no "{o}": a design pack's "the design question" is the first)
_PUT_UP_PATTERNS: list[tuple[re.Pattern[str], str | None]] = [(_put_up_pattern(v), None) for v in _PUT_UP]


def put_up_ordinals(text: str) -> list[str]:
    """The positions named by every put-up wording found inside the text ("Let me put the second problem on your screen" gives ["second"]):
    what `puts_up_problem_again` reads. Searches, so a wording inside a longer sentence counts."""
    return [(fixed or m.group(1)).lower() for p, fixed in _PUT_UP_PATTERNS for m in p.finditer(text or "")]


# ------------------------------------------------------------------ picking

def realism_of(blueprint: dict[str, Any] | None) -> dict[str, Any] | None:
    r = (blueprint or {}).get("realism")
    return r if isinstance(r, dict) else None


def habits_of(blueprint: dict[str, Any] | None) -> dict[str, Any] | None:
    """The persona's speech habits (acks, backchannels, fillers per stage), or None for a blueprint without a realism block."""
    h = (realism_of(blueprint) or {}).get("habits")
    return h if isinstance(h, dict) and h.get("acks") else None


def seed_of(blueprint: dict[str, Any] | None) -> str:
    """What the line picker's rng is seeded from: the realism seed, or the session id when the blueprint has none (so a rehearsal replays)."""
    r = realism_of(blueprint)
    if r is not None and r.get("seed") is not None:
        return str(r["seed"])
    return str((blueprint or {}).get("session_id") or (blueprint or {}).get("blueprint_id") or "")


class LinePicker:
    """Hands out the wordings of the fixed lines: random, never the same wording twice in a round until every wording of that line was used (then
    a new cycle that does not begin with the last one said). `used` is what the run checkpointed; `pools` replaces the pool of a key (the persona's
    own backchannels)."""

    def __init__(self, rng: random.Random, used: dict[str, list[str]] | None = None, pools: dict[str, tuple[str, ...]] | None = None) -> None:
        self.rng = rng
        # The run sets these: `opener_of(wording)` and `avoid()` (the openers of the previous interviewer turn). A wording that would open the next turn
        # the way the last one opened is skipped while another is left, so two fixed lines in a row never share an opener.
        self.opener_of: Callable[[str], str | None] | None = None
        self.avoid: Callable[[], Collection[str]] | None = None
        self._log: list[str] = []         # the wordings handed out since the run last took the log: what the run may have said in fixed words
        self._used: dict[str, list[str]] = {k: list(v) for k, v in (used or {}).items()}
        self._pools = dict(pools or {})

    def pick(self, key: str) -> str:
        pool = self._pools.get(key) or LINES[key]
        used = self._used.setdefault(key, [])
        fresh = [v for v in pool if v not in used]
        if not fresh:
            used[:] = used[-1:]                       # a new cycle: the wording just said is the only one that is still "used"
            fresh = [v for v in pool if v not in used] or list(pool)
        if self.opener_of is not None and self.avoid is not None and (avoided := set(self.avoid())):
            fresh = [v for v in fresh if (self.opener_of(v) or "") not in avoided] or fresh
        choice = self.rng.choice(fresh)
        used.append(choice)
        self._log.append(choice)
        return choice

    def take_log(self) -> list[str]:
        """The wordings handed out since the last call (the run records which of them a turn said, so the trace check can tell the run's own
        fixed lines from the model's words)."""
        log, self._log = self._log, []
        return log

    def peek(self, key: str) -> str:
        """The wording the next `pick(key)` would give, without using it up (a view of the round that shows the talker the line it may say: building
        the view again, and again, must not eat the pool)."""
        rng_state, used, logged = self.rng.getstate(), {k: list(v) for k, v in self._used.items()}, len(self._log)
        try:
            return self.pick(key)
        finally:
            self.rng.setstate(rng_state)
            self._used = used
            del self._log[logged:]

    def state(self) -> dict[str, list[str]]:
        return {k: list(v) for k, v in self._used.items()}


def picker_for(blueprint: dict[str, Any] | None, used: dict[str, list[str]] | None = None) -> LinePicker:
    """The picker of one round. Its rng is seeded from the round (and from how many lines a restored round already used, so a restart does not
    replay the same draws), the persona's own backchannels replace the default pool."""
    seed = seed_of(blueprint)
    n = sum(len(v) for v in (used or {}).values())
    habits = habits_of(blueprint) or {}
    backchannels = tuple(str(x) for x in habits.get("backchannels") or [] if str(x).strip())
    pools = {"backchannel": backchannels} if len(backchannels) >= 2 else None
    return LinePicker(random.Random(f"lines:{seed}:{n}"), used, pools)


# ------------------------------------------------------------------ the links between parts

# A move to a new part starts with a short link to what came before. The orders give the interviewer one as an example ("something like ..."), and
# an example said back by every interviewer is a script, so with a realism block each session gets one wording of a small pool (stable for the
# session: the same text every time the order is built, never the same one as another session by chance alone). The first wording is today's, and a
# blueprint without a realism block keeps it. Keys: the phase, or "phase:style" for a style's own link.
BRIDGE_POOLS: dict[str, tuple[str, ...]] = {
    "framing": ("Alright, let me tell you how this round will run.", "Okay, here is how this round will go.",
                "Let's start with how this round will go.", "Before we start, let me tell you how the round will work."),
    "candidate_intro": ("But before the coding, let's start with you.", "But before we code, let's start with you.",
                        "But first, let's start with you.", "Before the coding, let's start with you."),
    "deep_dive": ("Alright, that's fine. Let's talk a bit more about your projects.", "Okay, let's talk a bit more about your projects.",
                  "Okay, I'd like to hear a bit more about your projects."),
    "candidate_questions": ("That's everything I wanted to ask, so now it's your turn.", "That covers what I wanted to ask, so now it's your turn.",
                            "I think I've asked what I wanted to, so now it's your turn."),
    # (no "dive into": a prep-written opening often begins "Let's dive into ...", which the leak guard read as the statement; decided 2026-10-18)
    "problem": ("Alright, let's get into the coding now.", "Okay, let's get into the coding now.", "Okay then, let's get into the coding now.",
                "Alright, let's get to the coding now."),
    "candidate_intro:after_coding": ("Now let's talk a bit about you.", "Now let's hear a bit about you.", "Now let's talk a little about you."),
    "candidate_intro:pointed_resume": ("Before we get going, I was looking at your resume.", "Before we begin, I had a look at your resume.",
                                       "I was going through your resume before this."),
    "candidate_intro:one_project": ("Before the coding, I'd like to hear about one of your projects.", "First, I'd like to hear about one of your projects.",
                                    "Before we code, I'd like to hear about one project of yours."),
}


def bridge_variant(blueprint: dict[str, Any] | None, key: str, pack_id: str | None = None) -> str:
    """The link for `key` in this session: the persona's wording of the pool when the blueprint has a realism block, else today's. The pool is the
    round pack's own (system design says "the design", not "the coding"), or `pack_id`'s when given (a culture slot uses the behavioural pack's)."""
    pool = BRIDGE_POOLS[pack_key(key, pack_id or pack_id_of(blueprint))]
    if realism_of(blueprint) is None:
        return pool[0]
    return pool[int(hashlib.sha256(f"{seed_of(blueprint)}:{key}".encode()).hexdigest(), 16) % len(pool)]


# ------------------------------------------------------------------ the pack pools

def pack_key(key: str, pack_id: str) -> str:
    """The key of the round pack's own pool for this line ("bridge:first@system-design"), or `key` itself when the pack has none (the DSA pack never
    has: its lines are the defaults above)."""
    k = f"{key}@{pack_id}"
    return k if k in LINES or k in BRIDGE_POOLS else key


def pack_id_of(blueprint: dict[str, Any] | None) -> str:
    return str(rules_of(blueprint).get("pack") or "dsa")


def _add_put_up_patterns(variants: tuple[str, ...], ordinal: str | None) -> None:
    for v in variants:
        pattern = _put_up_pattern(v)
        if not any(p.pattern == pattern.pattern and fixed == ordinal for p, fixed in _PUT_UP_PATTERNS):      # the design packs share their wordings
            _PUT_UP_PATTERNS.append((pattern, ordinal))


def _register_packs() -> None:
    """Add every pack's line pools next to the defaults, as "<key>@<pack id>" (decided 2026-10-20, round packs). A put-up or intro wording may carry
    "{o}", filled per ordinal as the defaults are; one without it is the pool of that key's own ordinal only. The matchers are rebuilt to cover them."""
    global _FORMS
    for pack in PACKS.values():
        for key, variants in pack.lines.items():
            name = f"{key}@{pack.pack_id}"
            if key in BRIDGE_POOLS:
                BRIDGE_POOLS[name] = tuple(variants)
                continue
            head, _, ordinal = key.partition(":")
            if head in ("put_up", "intro") and any("{o}" in v for v in variants):      # one pool per position, as the defaults are
                for o in ORDINALS:
                    if f"{head}:{o}" in pack.lines and f"{head}:{o}" != key:      # a position the pack words on its own keeps its own pool
                        continue
                    LINES[f"{head}:{o}@{pack.pack_id}"] = tuple(v.format(o=o) for v in variants)
                if head == "put_up":
                    _add_put_up_patterns(variants, None)
                continue
            LINES[name] = tuple(variants)
            if head == "put_up":
                _add_put_up_patterns(variants, ordinal)
    _FORMS = _index()


_register_packs()
