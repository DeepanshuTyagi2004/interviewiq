"""The speech vocabulary of the live interviewer, in one readable file (decided 2026-10-18; PRODUCT IP draft for the owner to review and edit).

Every phrase an interviewer can have as a habit lives here, grouped by kind and by the voice it suits:

  acknowledgements   the short reaction that opens a reply ("Understood.", "Gotcha, gotcha.", "Love that.")
  backchannels       the nod said while the candidate is thinking or talking ("Mm-hmm.", "Uh-huh.")
  fillers            what is said while the model is slow, in four stages as the wait grows (stage0 .. stage3, see fillers.py)
  lead-ins           the short way a turn can begin before its question ("So,", "Alright, let's see —")

A phrase is drawn for a persona only when it fits the persona's traits (`fits`: trait axis -> the levels it suits; an axis it does not
name suits any level). The axes are warmth (reserved / friendly / very warm), formality (casual / neutral / formal), verbosity (terse /
normal / chatty), pace (brisk / even / unhurried) and register (neutral / indian_english). Code draws the habits (realism.draw_habits);
no model writes them, so this file is the whole vocabulary and a phrase added here is used and recognised everywhere with no other change
(the talker builds its acknowledgement matchers from it).

Rules each phrase keeps (a test enforces them over this whole file):
  - A VERDICT acknowledgement ("Right.", "Nice.", "Love that.") says whether what they said was good or right; the verdict budget counts
    it. Every other acknowledgement is NEUTRAL and says only that it was heard. Never mark a verdict neutral to slip it past the budget.
  - No phrase gives a length of time ("one moment" is fine, "one second" is not), takes leave, asks a question, announces a move to
    another part, or says anything about the interviewer's own working.
  - A persona gets at most one phrase of a family (FAMILIES: near-duplicates, so "Understood." and "Okay, understood, thank you." are never both drawn)
    and at most one doubled phrase ("Okay, okay.", "Got it, got it.").
  - A backchannel is a bare sound of listening of at most three words: the run says it by itself while the candidate thinks, so nothing in it invites
    ("Go on.") or reassures ("Take your time."); the talker says those once, in its own words.
  - A brisk or terse interviewer only gets short phrases (realism.SHORT_WORDS); an unhurried or chatty one may get the longer ones.
  - The Indian-English phrases are what a courteous Indian interviewer says in an interview, not a caricature: no stage words, no
    mimicry, nothing that could read as mocking. They are drawn for a share of personas (the `register` trait).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field, replace
from typing import Literal

Kind = Literal["ack", "backchannel", "filler", "lead_in"]

# The trait axes a phrase can be tagged with, and their levels (realism.TRAIT_AXES holds the same words for the traits themselves).
LEVELS: dict[str, frozenset[str]] = {
    "warmth": frozenset({"reserved", "friendly", "very warm"}),
    "formality": frozenset({"casual", "neutral", "formal"}),
    "verbosity": frozenset({"terse", "normal", "chatty"}),
    "pace": frozenset({"brisk", "even", "unhurried"}),
    "register": frozenset({"neutral", "indian_english"}),
}
STAGES = ("stage0", "stage1", "stage2", "stage3")        # the wait fillers, as fillers.py says them: a moment, a little more, sorry, sorry again


@dataclass(frozen=True, eq=False)
class Phrase:
    text: str
    kind: Kind
    verdict: bool = False                                      # an acknowledgement or backchannel that judges what they said
    fits: dict[str, frozenset[str]] = field(default_factory=dict)
    stage: str | None = None                                   # fillers only: stage0 .. stage3
    family: str | None = None                                  # near-duplicates share one (FAMILIES below): a persona gets at most one phrase of a family

    @property
    def words(self) -> int:
        return len(self.text.split())

    @property
    def doubled(self) -> bool:
        """The phrase says a word or a pair of words twice ("Okay, okay.", "Got it, got it.", "Okay, I see, I see."). A persona gets at most one
        (said all the time they read as a caricature)."""
        w = re.findall(r"[a-z']+", self.text.lower())
        return any(w[i] == w[i + 1] for i in range(len(w) - 1)) or any(w[i:i + 2] == w[i + 2:i + 4] for i in range(len(w) - 3))


def _fits(**axes: str) -> dict[str, frozenset[str]]:
    """`warmth="friendly/very warm"` -> {"warmth": frozenset({"friendly", "very warm"})}; an unknown axis or level is a typo and raises."""
    out: dict[str, frozenset[str]] = {}
    for axis, levels in axes.items():
        chosen = frozenset(x.strip() for x in levels.split("/"))
        if axis not in LEVELS or not chosen <= LEVELS[axis]:
            raise ValueError(f"bad tag {axis}={levels!r}")
        out[axis] = chosen
    return out


def neutral(text: str, **fits: str) -> Phrase:
    return Phrase(text, "ack", False, _fits(**fits))


def verdict(text: str, **fits: str) -> Phrase:
    return Phrase(text, "ack", True, _fits(**fits))


def nod(text: str, **fits: str) -> Phrase:
    return Phrase(text, "backchannel", False, _fits(**fits))


def filler(stage: int, text: str, **fits: str) -> Phrase:
    return Phrase(text, "filler", False, _fits(**fits), f"stage{stage}")


def lead_in(text: str, **fits: str) -> Phrase:
    return Phrase(text, "lead_in", False, _fits(**fits))


IE = "indian_english"

# ---------------------------------------------------------------------------------------------------------------------------------
# ACKNOWLEDGEMENTS, neutral: they say it was heard, never that it was right.
# ---------------------------------------------------------------------------------------------------------------------------------
NEUTRAL_ACKS: tuple[Phrase, ...] = (
    # Plain and short.
    neutral("Okay."),
    neutral("Alright.", formality="casual/neutral"),
    neutral("Sure.", verbosity="terse/normal"),
    neutral("Got it.", formality="casual/neutral"),
    neutral("I see.", verbosity="terse/normal"),
    neutral("Makes sense.", formality="casual/neutral"),
    neutral("Fair enough.", formality="casual/neutral", warmth="reserved/friendly"),
    neutral("Mm, okay.", formality="casual/neutral", pace="even/unhurried"),
    neutral("Hmm, okay.", pace="even/unhurried"),
    neutral("Okay then.", warmth="reserved/friendly"),
    neutral("Okay, thank you.", formality="neutral/formal", warmth="reserved/friendly"),
    neutral("Appreciated.", formality="formal", warmth="reserved/friendly", verbosity="terse/normal"),
    neutral("Okay, I see.", formality="neutral/formal", warmth="reserved/friendly"),
    neutral("Okay, sure.", formality="casual/neutral"),
    neutral("Mm, makes sense.", formality="casual/neutral", warmth="reserved/friendly"),
    neutral("Mm, fair enough.", formality="casual/neutral", warmth="reserved/friendly"),
    neutral("Alright, okay.", formality="casual/neutral"),
    neutral("Mm, noted.", formality="neutral/formal", warmth="reserved/friendly"),
    neutral("Okay, noted.", warmth="reserved/friendly"),
    neutral("Gotcha.", formality="casual", warmth="friendly/very warm"),
    neutral("Okay, yeah.", formality="casual"),
    neutral("Yeah, okay.", formality="casual", pace="even/unhurried"),
    neutral("Ah, okay.", warmth="friendly/very warm", formality="casual/neutral"),
    neutral("Okay, I get it.", formality="casual/neutral", warmth="friendly/very warm"),
    # Reserved and formal.
    neutral("Understood.", formality="neutral/formal", warmth="reserved/friendly"),
    neutral("Noted.", formality="neutral/formal", warmth="reserved/friendly", verbosity="terse/normal"),
    neutral("I follow.", formality="neutral/formal", warmth="reserved/friendly"),
    neutral("I understand.", formality="neutral/formal", warmth="reserved/friendly"),
    neutral("Thank you.", formality="neutral/formal", warmth="reserved/friendly", verbosity="terse/normal"),
    neutral("Thank you, noted.", formality="neutral/formal", warmth="reserved/friendly"),
    neutral("Very well.", formality="formal", warmth="reserved/friendly"),
    neutral("All right.", formality="neutral/formal"),
    neutral("Thank you, understood.", formality="neutral/formal"),
    neutral("Thank you for that.", formality="neutral/formal", warmth="reserved/friendly", pace="even/unhurried"),
    neutral("Okay, understood.", formality="neutral/formal"),
    neutral("Okay, I understand.", formality="neutral/formal"),
    neutral("I see what you mean.", formality="neutral/formal", pace="even/unhurried"),
    neutral("Thank you for explaining.", formality="formal", pace="even/unhurried", warmth="friendly/very warm"),
    # Casual and friendly.
    neutral("Okay, cool.", formality="casual", warmth="friendly/very warm"),
    neutral("Ah, I see.", warmth="friendly/very warm", formality="casual/neutral"),
    neutral("Ah, got it.", warmth="friendly/very warm", formality="casual/neutral"),
    neutral("Ah, right.", warmth="friendly/very warm", formality="casual/neutral"),
    neutral("Okay, that helps.", warmth="friendly/very warm", pace="even/unhurried"),
    neutral("Thanks, that helps.", warmth="friendly/very warm", formality="casual/neutral", pace="even/unhurried"),
    neutral("Okay, thanks for explaining that.", warmth="friendly/very warm", pace="even/unhurried", verbosity="normal/chatty"),
    neutral("Thanks for walking me through that.", warmth="friendly/very warm", pace="even/unhurried", verbosity="normal/chatty"),
    neutral("Yeah, I get that.", formality="casual", warmth="friendly/very warm"),
    neutral("Yeah, that makes sense.", formality="casual", verbosity="normal/chatty"),
    neutral("Okay, that makes sense.", formality="casual/neutral", verbosity="normal/chatty"),
    neutral("Okay, I see where you're going.", verbosity="normal/chatty", pace="even/unhurried"),
    neutral("Okay, I can see that.", formality="casual/neutral", pace="even/unhurried"),
    neutral("Yeah, I can see why.", formality="casual", pace="even/unhurried", verbosity="normal/chatty"),
    # Chatty and very warm.
    neutral("Okay, yeah, that makes sense.", verbosity="chatty", warmth="friendly/very warm", formality="casual/neutral", pace="even/unhurried"),
    neutral("Gotcha, gotcha.", verbosity="chatty", formality="casual", warmth="friendly/very warm", pace="even/unhurried"),
    neutral("Okay, okay, I see.", verbosity="chatty", formality="casual/neutral", pace="even/unhurried"),
    neutral("Okay, I see what you're saying.", verbosity="chatty", formality="casual/neutral", pace="even/unhurried"),
    neutral("Okay, got it, thanks.", verbosity="normal/chatty", warmth="friendly/very warm", pace="even/unhurried"),
    neutral("Okay, thanks, that clears it up.", verbosity="chatty", warmth="friendly/very warm", pace="even/unhurried"),
    # Unhurried: a person who is taking it in.
    # Indian-English register: how a courteous Indian interviewer acknowledges.
    neutral("Okay, fine.", register=IE),
    neutral("Okay, okay.", register=IE, formality="casual/neutral"),
    neutral("Got it, got it.", register=IE, formality="casual/neutral"),
    neutral("Understood, understood.", register=IE, formality="neutral/formal"),
    neutral("Alright, alright.", register=IE, formality="casual/neutral"),
    neutral("Okay, I am following.", register=IE, pace="even/unhurried"),
    neutral("Okay, I get your point.", register=IE, pace="even/unhurried"),
    neutral("Okay, that is clear to me.", register=IE, formality="neutral/formal", pace="even/unhurried"),
    neutral("Okay, I see, I see.", register=IE, pace="even/unhurried", verbosity="normal/chatty"),
    neutral("Okay, understood, thank you.", register=IE, formality="neutral/formal", pace="even/unhurried"),
    neutral("Okay, yes, I follow.", register=IE, formality="neutral/formal", pace="even/unhurried"),
)

# ---------------------------------------------------------------------------------------------------------------------------------
# ACKNOWLEDGEMENTS, verdict: they judge what was said. An interviewer may have one or two as part of how they sound, but the talker's
# verdict budget lets a reply carry one at most, never in two replies in a row.
# ---------------------------------------------------------------------------------------------------------------------------------
VERDICT_ACKS: tuple[Phrase, ...] = (
    verdict("Right."),
    verdict("Exactly.", formality="casual/neutral"),
    verdict("Good.", verbosity="terse/normal"),
    verdict("Nice.", formality="casual/neutral", warmth="friendly/very warm"),
    verdict("Great.", warmth="friendly/very warm"),
    verdict("Perfect.", warmth="friendly/very warm", formality="casual/neutral"),
    verdict("Solid.", formality="casual/neutral", verbosity="terse/normal"),
    verdict("That's clear.", formality="neutral/formal", warmth="reserved/friendly"),
    verdict("That's fair.", formality="neutral/formal"),
    verdict("Good, good.", formality="casual/neutral", verbosity="normal/chatty", pace="even/unhurried"),
    verdict("Yes, exactly.", verbosity="normal/chatty", warmth="friendly/very warm"),
    verdict("Nice, okay.", formality="casual", warmth="friendly/very warm"),
    verdict("Good, okay.", formality="neutral/formal", warmth="reserved/friendly"),
    verdict("Great, okay.", formality="casual/neutral", warmth="friendly/very warm"),
    verdict("Perfect, okay.", formality="casual/neutral", warmth="friendly/very warm"),
    verdict("Good point.", formality="neutral/formal", verbosity="normal/chatty"),
    verdict("Great point.", warmth="friendly/very warm", verbosity="normal/chatty"),
    verdict("Well said.", formality="neutral/formal", warmth="friendly/very warm", pace="even/unhurried"),
    verdict("Very good.", formality="formal", warmth="reserved/friendly", pace="even/unhurried"),
    verdict("Excellent.", formality="formal", warmth="friendly/very warm"),
    verdict("Brilliant.", formality="casual/neutral", warmth="very warm"),
    verdict("Lovely.", formality="casual/neutral", warmth="very warm"),
    verdict("Awesome.", formality="casual", warmth="very warm"),
    verdict("Oh, that's interesting.", warmth="friendly/very warm", verbosity="normal/chatty", pace="even/unhurried"),
    verdict("Ah, interesting.", warmth="friendly/very warm", formality="casual/neutral"),
    verdict("Ah, okay, that's good to know.", warmth="friendly/very warm", formality="casual/neutral", verbosity="chatty", pace="even/unhurried"),
    verdict("Interesting, okay.", formality="casual/neutral", pace="even/unhurried"),
    verdict("Beautiful.", formality="casual/neutral", warmth="very warm", pace="even/unhurried"),
    verdict("Spot on.", formality="casual", warmth="friendly/very warm"),
    verdict("Good one.", formality="casual/neutral", warmth="friendly/very warm", verbosity="terse/normal"),
    verdict("Love that.", warmth="very warm", formality="casual/neutral"),
    verdict("Oh nice, okay.", warmth="very warm", formality="casual", verbosity="normal/chatty"),
    verdict("Ah, nice.", warmth="friendly/very warm", formality="casual"),
    # Indian-English register.
    verdict("Right, right.", register=IE, formality="casual/neutral"),
    verdict("Exactly, exactly.", register=IE, formality="casual/neutral", warmth="friendly/very warm", verbosity="normal/chatty"),
    verdict("Very good, okay.", register=IE, formality="neutral/formal"),
)

ACKS: tuple[Phrase, ...] = NEUTRAL_ACKS + VERDICT_ACKS

# ---------------------------------------------------------------------------------------------------------------------------------
# BACKCHANNELS: said while they think or talk, so they ask for nothing and judge nothing.
# ---------------------------------------------------------------------------------------------------------------------------------
BACKCHANNELS: tuple[Phrase, ...] = (
    # The run says these by itself while the candidate thinks or talks (a nod pool, never through the talker), so each is a bare sound of listening
    # of at most three words: nothing that invites ("Go on.") or reassures ("Take your time."; the talker says that once, in its own words).
    nod("Mm-hmm."),
    nod("Mm."),
    nod("Uh-huh.", formality="casual/neutral"),
    nod("Yeah.", formality="casual"),
    nod("Yep.", formality="casual", warmth="friendly/very warm", verbosity="terse/normal"),
    nod("Hmm.", pace="even/unhurried"),
    nod("Hm.", formality="neutral/formal", warmth="reserved/friendly", verbosity="terse/normal"),
    nod("Mm-hm.", formality="casual/neutral", verbosity="terse/normal"),
    nod("Mhm.", formality="casual", warmth="friendly/very warm", verbosity="terse/normal"),
    nod("Mm, yeah.", formality="casual", pace="even/unhurried"),
    nod("Yeah, mm-hmm.", formality="casual", pace="even/unhurried"),
    nod("Hmm, yeah.", formality="casual", pace="even/unhurried"),
    nod("Ah, yeah.", formality="casual", warmth="friendly/very warm"),
    nod("Oh yeah.", formality="casual", warmth="friendly/very warm"),
    nod("Oh, okay.", formality="casual/neutral", warmth="friendly/very warm", pace="even/unhurried"),
    nod("Oh, I see.", warmth="friendly/very warm", formality="casual/neutral"),
    nod("Mm, I see.", pace="even/unhurried"),
    nod("Mm-hmm, okay.", formality="neutral/formal"),
    nod("Okay, mm-hmm.", formality="neutral/formal", pace="even/unhurried"),
    nod("Uh-huh, okay.", formality="casual/neutral"),
    nod("Mm, sure.", formality="casual/neutral", warmth="reserved/friendly"),
    nod("Yeah, sure.", formality="casual", warmth="friendly/very warm"),
    nod("Mm, got it.", formality="neutral/formal"),
    nod("Got you.", formality="casual", warmth="friendly/very warm"),
    nod("I hear you.", warmth="friendly/very warm", pace="even/unhurried"),
    nod("I'm following.", formality="neutral/formal", pace="even/unhurried"),
    nod("Okay, I'm following.", formality="neutral/formal", pace="even/unhurried"),
    nod("Ah.", formality="casual/neutral", verbosity="terse/normal"),
    nod("Mm, I follow.", formality="neutral/formal", warmth="reserved/friendly"),
    nod("Mm, understood.", formality="neutral/formal", warmth="reserved/friendly"),
    nod("Mm-hmm, I see.", formality="neutral/formal", pace="even/unhurried"),
    nod("Hm, okay.", formality="neutral/formal", warmth="reserved/friendly"),
)

# ---------------------------------------------------------------------------------------------------------------------------------
# FILLERS: said while the model is slow, in four stages as the wait grows. Stage 0: a moment. 1: a little more. 2: an apology for the
# wait. 3: a longer apology. None gives a length of time ("one moment" is fine).
# ---------------------------------------------------------------------------------------------------------------------------------
FILLERS: tuple[Phrase, ...] = (
    # stage0: give me a moment.
    filler(0, "Give me a moment.", formality="casual/neutral"),
    filler(0, "One moment.", formality="neutral/formal"),
    filler(0, "Hmm, let me think about that."),
    filler(0, "Let me think for a moment.", formality="casual/neutral"),
    filler(0, "Just a moment.", formality="neutral/formal"),
    filler(0, "Hold on a moment.", formality="casual/neutral"),
    filler(0, "Let me think."),
    filler(0, "Mm, let me think.", formality="casual/neutral"),
    filler(0, "Hmm, let me see.", formality="casual/neutral"),
    filler(0, "Hold on, let me think.", formality="casual"),
    filler(0, "Hmm, one moment.", formality="casual/neutral"),
    filler(0, "Let me gather my thoughts.", formality="neutral/formal", verbosity="normal/chatty"),
    filler(0, "One moment, please.", formality="formal"),
    filler(0, "A moment, please.", formality="formal", warmth="reserved/friendly"),
    filler(0, "Let me consider that.", formality="formal", warmth="reserved/friendly"),
    filler(0, "Allow me a moment.", formality="formal"),
    filler(0, "Bear with me for a moment.", formality="neutral/formal"),
    filler(0, "Okay, let me think about that for a moment.", pace="unhurried", verbosity="normal/chatty", formality="casual/neutral"),
    filler(0, "Okay, one moment.", register=IE),
    filler(0, "Okay, one moment, let me think.", register=IE, pace="even/unhurried"),
    # stage1: a little more.
    filler(1, "Just a little more.", formality="casual/neutral"),
    filler(1, "Bear with me, almost there.", formality="neutral/formal"),
    filler(1, "Still with you, one moment.", warmth="friendly/very warm", pace="even/unhurried"),
    filler(1, "Almost there."),
    filler(1, "Give me just a bit longer.", formality="casual/neutral"),
    filler(1, "Still thinking, bear with me."),
    filler(1, "Bear with me.", formality="neutral/formal"),
    filler(1, "Nearly there.", formality="neutral/formal"),
    filler(1, "Still working on it.", formality="casual/neutral"),
    filler(1, "Just about there.", formality="casual", warmth="friendly/very warm"),
    filler(1, "Almost done.", formality="neutral/formal"),
    filler(1, "A little longer, please.", formality="formal"),
    filler(1, "Nearly there, thank you.", formality="neutral/formal"),
    filler(1, "Thanks for bearing with me.", formality="neutral/formal", warmth="friendly/very warm", pace="even/unhurried"),
    filler(1, "Hmm, still thinking about this.", formality="casual/neutral", pace="even/unhurried"),
    filler(1, "Just a bit more.", formality="casual"),
    filler(1, "Hang on, almost there.", formality="casual"),
    filler(1, "Still on it.", formality="casual"),
    filler(1, "Okay, almost there, bear with me.", register=IE),
    # stage2: sorry about the wait.
    filler(2, "Sorry about the wait.", formality="casual/neutral"),
    filler(2, "Apologies, this is taking a little longer than usual.", formality="neutral/formal", pace="even/unhurried", verbosity="normal/chatty"),
    filler(2, "Apologies for the delay.", formality="formal"),
    filler(2, "Sorry, still on it.", formality="casual"),
    filler(2, "Sorry, I'm taking longer than I'd like.", formality="casual/neutral", pace="even/unhurried", warmth="friendly/very warm"),
    filler(2, "I appreciate your patience, nearly there.", formality="formal"),
    filler(2, "Sorry about this, almost done.", formality="casual/neutral"),
    filler(2, "Thank you for your patience.", formality="neutral/formal"),
    filler(2, "Sorry to keep you waiting.", formality="neutral/formal"),
    filler(2, "Sorry, this is taking longer than I expected.", formality="casual/neutral", pace="even/unhurried", verbosity="normal/chatty"),
    filler(2, "Really sorry, nearly there.", formality="casual/neutral"),
    filler(2, "My apologies for the wait.", formality="formal"),
    filler(2, "Sorry, nearly done."),
    filler(2, "Thank you for waiting.", formality="neutral/formal"),
    filler(2, "Sorry for the delay.", formality="neutral/formal"),
    filler(2, "Apologies, almost there.", formality="formal"),
    filler(2, "Sorry, bear with me.", formality="casual/neutral"),
    filler(2, "Sorry, this is taking a while.", formality="casual/neutral"),
    filler(2, "Sorry for the wait, almost there.", register=IE, formality="neutral/formal"),
    # stage3: a longer apology.
    filler(3, "Sorry for the delay, thank you for your patience.", formality="neutral/formal", pace="even/unhurried"),
    filler(3, "I haven't forgotten you, nearly there.", formality="casual/neutral", warmth="friendly/very warm"),
    filler(3, "Sorry, I'm still working on this.", formality="casual/neutral"),
    filler(3, "Really sorry for the wait, almost there.", warmth="friendly/very warm", formality="casual/neutral"),
    filler(3, "Thank you for waiting, nearly there.", formality="neutral/formal"),
    filler(3, "Sorry, this is taking much longer than it should.", formality="casual/neutral", pace="even/unhurried", verbosity="normal/chatty"),
    filler(3, "I'm really sorry about this, I'm still here.", warmth="friendly/very warm", formality="casual", pace="even/unhurried"),
    filler(3, "Thank you for your patience, I'm still working on it.", formality="formal", pace="even/unhurried"),
    filler(3, "Apologies for the long wait, I'm nearly there.", formality="formal", pace="even/unhurried"),
    filler(3, "Sorry for making you wait, I'm nearly done.", formality="casual/neutral", warmth="friendly/very warm", pace="even/unhurried"),
    filler(3, "Thanks for staying with me, nearly there.", warmth="friendly/very warm", formality="casual/neutral"),
    filler(3, "Sorry, I'm nearly done.", formality="casual/neutral"),
    filler(3, "Sorry for the long wait.", formality="neutral/formal"),
    filler(3, "Apologies for the long delay.", formality="formal"),
    filler(3, "Thank you, nearly there.", formality="neutral/formal"),
    filler(3, "I appreciate your patience.", formality="formal"),
    filler(3, "Apologies, I'm nearly there.", formality="formal"),
    filler(3, "Sorry, still here, nearly done.", formality="casual"),
    filler(3, "Sorry for the wait, I am still working on it.", register=IE, formality="neutral/formal", pace="even/unhurried"),
    filler(3, "Thank you for your patience, almost done.", register=IE, formality="neutral/formal"),
)

# ---------------------------------------------------------------------------------------------------------------------------------
# LEAD-INS: the short way a turn can begin before what it asks. Never an acknowledgement and never a verdict, so none opens with "Right,",
# "Good,", "Nice," or "Great,", and none announces a move to another part.
# ---------------------------------------------------------------------------------------------------------------------------------
LEAD_INS: tuple[Phrase, ...] = (
    lead_in("So,"),
    lead_in("Now,"),
    lead_in("Okay, so…", formality="casual/neutral"),
    lead_in("Okay, now,", formality="casual/neutral"),
    lead_in("Alright, so,", formality="casual/neutral"),
    lead_in("Alright, now,", formality="neutral/formal"),
    lead_in("So then,", formality="casual/neutral"),
    lead_in("Alright, let's see —", formality="casual/neutral", pace="even/unhurried"),
    lead_in("Okay, let's see —", formality="casual/neutral", pace="even/unhurried"),
    lead_in("Let's see —", pace="even/unhurried"),
    lead_in("Okay, here's what I'm curious about —", verbosity="normal/chatty", pace="even/unhurried", warmth="friendly/very warm"),
    lead_in("I'm curious —", warmth="friendly/very warm", pace="even/unhurried"),
    lead_in("One thing I'd like to understand —", formality="neutral/formal", pace="even/unhurried"),
    lead_in("Help me understand —", warmth="friendly/very warm", pace="even/unhurried"),
    lead_in("Just so I'm clear —", pace="even/unhurried"),
    lead_in("Let me ask you this —", pace="even/unhurried", verbosity="normal/chatty"),
    lead_in("Staying with that —", pace="even/unhurried"),
    lead_in("Building on that —", pace="even/unhurried"),
    lead_in("Quick one —", formality="casual/neutral", pace="brisk/even", verbosity="terse/normal"),
    lead_in("Okay, quick one —", formality="casual", pace="brisk/even"),
    lead_in("Okay, picture this —", formality="casual", verbosity="normal/chatty", warmth="friendly/very warm"),
    lead_in("Let me push on that a bit —", pace="even/unhurried", verbosity="normal/chatty"),
    lead_in("Here's what I'm wondering —", warmth="friendly/very warm", pace="even/unhurried", verbosity="normal/chatty"),
    lead_in("Cool, so —", formality="casual", warmth="friendly/very warm"),
    lead_in("Alright cool, so —", formality="casual", warmth="friendly/very warm", verbosity="normal/chatty"),
    lead_in("Okay, yeah, so —", formality="casual", pace="even/unhurried"),
    lead_in("Yeah, so —", formality="casual", verbosity="terse/normal"),
    lead_in("Okay, so here's the thing —", formality="casual", verbosity="normal/chatty", pace="even/unhurried"),
    lead_in("Now then,", formality="neutral/formal"),
    lead_in("Alright then,", formality="neutral/formal"),
    lead_in("Well then,", formality="neutral/formal", warmth="reserved/friendly"),
    lead_in("So now,", formality="casual/neutral"),
    lead_in("Very well, now,", formality="formal", warmth="reserved/friendly", pace="even/unhurried"),
    lead_in("In that case,", formality="neutral/formal"),
    lead_in("With that in mind,", formality="neutral/formal", pace="even/unhurried"),
    lead_in("Given that,", formality="neutral/formal", verbosity="terse/normal"),
    lead_in("On that point,", formality="neutral/formal"),
    lead_in("If I may —", formality="formal", warmth="reserved/friendly"),
    lead_in("May I ask —", formality="formal"),
    lead_in("Allow me to ask —", formality="formal", pace="even/unhurried", verbosity="normal/chatty"),
    # Indian-English register.
    lead_in("Okay, so basically —", register=IE, formality="casual/neutral", pace="even/unhurried"),
    lead_in("Okay, so now —", register=IE, formality="casual/neutral"),
    lead_in("Okay, let us see —", register=IE, formality="neutral/formal", pace="even/unhurried"),
    lead_in("Okay, so what about —", register=IE, formality="casual/neutral", pace="even/unhurried"),
)

# ---------------------------------------------------------------------------------------------------------------------------------
# FAMILIES: phrases that say nearly the same thing. A persona gets at most one phrase of a family ("Understood." and "Okay, understood, thank you."
# are one), so its habits are not near-copies of each other. Fillers' families are per stage. A phrase in no family is free.
# ---------------------------------------------------------------------------------------------------------------------------------
FAMILIES: dict[str, tuple[str, ...]] = {
    # acknowledgements and nods
    "got_it": ("Got it.", "Ah, got it.", "Got it, got it.", "Okay, got it, thanks.", "Mm, got it."),
    "gotcha": ("Gotcha.", "Gotcha, gotcha.", "Got you."),
    "get_it": ("Okay, I get it.", "Yeah, I get that.", "Okay, I get your point."),
    "understood": ("Understood.", "Mm, understood.", "Understood, understood.", "Okay, understood.", "Okay, understood, thank you.", "Thank you, understood.", "I understand.",
                   "Okay, I understand."),
    "noted": ("Noted.", "Okay, noted.", "Thank you, noted.", "Mm, noted."),
    "follow": ("I follow.", "Mm, I follow.", "Okay, yes, I follow.", "Okay, I am following.", "I'm following.", "Okay, I'm following."),
    "see": ("I see.", "Mm-hmm, I see.", "Okay, I see.", "Ah, I see.", "Okay, I see, I see.", "Okay, okay, I see.", "Mm, I see.", "Oh, I see."),
    "see_what_you_mean": ("I see what you mean.", "Okay, I see what you're saying.", "Okay, I see where you're going.", "Okay, I can see that.", "Yeah, I can see why."),
    "makes_sense": ("Makes sense.", "Mm, makes sense.", "Yeah, that makes sense.", "Okay, that makes sense.", "Okay, yeah, that makes sense."),
    "thanks": ("Thank you.", "Okay, thank you.", "Appreciated.", "Thank you for that.", "Thank you for explaining.", "Thanks for walking me through that.", "Okay, thanks for explaining that."),
    "helps": ("Okay, that helps.", "Thanks, that helps.", "Okay, thanks, that clears it up."),
    "alright": ("Alright.", "All right.", "Alright, alright.", "Alright, okay."),
    "fair": ("Fair enough.", "Mm, fair enough."),
    "okay_sure": ("Okay, sure.",),
    "mm_okay": ("Mm, okay.", "Hm, okay.", "Hmm, okay.", "Mm-hmm, okay.", "Okay, mm-hmm.", "Uh-huh, okay."),
    "okay_then": ("Okay then.", "Okay, fine.", "Okay, okay.", "Okay, yeah.", "Yeah, okay."),
    # verdicts
    "right": ("Right.", "Right, right."),
    "exactly": ("Exactly.", "Yes, exactly.", "Exactly, exactly.", "Spot on."),
    "good": ("Good.", "Good, okay.", "Good, good.", "Good one."),
    "point": ("Good point.", "Great point."),
    "great": ("Great.", "Great, okay."),
    "nice": ("Nice.", "Nice, okay.", "Ah, nice.", "Oh nice, okay."),
    "perfect": ("Perfect.", "Perfect, okay."),
    "very_good": ("Very good.", "Very good, okay.", "Excellent."),
    "interesting": ("Interesting, okay.", "Ah, interesting.", "Oh, that's interesting.", "Ah, okay, that's good to know."),
    "praise": ("Lovely.", "Beautiful.", "Brilliant.", "Awesome.", "Love that."),
    # backchannels
    "hmm": ("Hmm.", "Hm.", "Hmm, yeah."),
    "mm_hmm": ("Mm-hmm.", "Mm-hm.", "Mhm.", "Yeah, mm-hmm."),
    "uh_huh": ("Uh-huh.",),
    "yeah": ("Yeah.", "Yep.", "Mm, yeah.", "Ah, yeah.", "Oh yeah.", "Yeah, sure."),
    "mm": ("Mm.", "Mm, sure."),
    "sure": ("Sure.",),
    # lead-ins
    "lead_so": ("So,", "So then,", "So now,"),
    "lead_okay_so": ("Okay, so…", "Alright, so,", "Yeah, so —", "Cool, so —", "Alright cool, so —", "Okay, yeah, so —"),
    "lead_so_x": ("Okay, so here's the thing —", "Okay, so basically —", "Okay, so now —", "Okay, so what about —"),
    "lead_now": ("Now,", "Okay, now,", "Alright, now,"),
    "lead_then": ("Now then,", "Alright then,", "Well then,", "Very well, now,"),
    "lead_see": ("Let's see —", "Alright, let's see —", "Okay, let's see —", "Okay, let us see —"),
    "lead_curious": ("I'm curious —", "Okay, here's what I'm curious about —", "Here's what I'm wondering —", "Help me understand —",
                     "One thing I'd like to understand —", "Just so I'm clear —"),
    "lead_ask": ("Let me ask you this —", "May I ask —", "Allow me to ask —", "If I may —", "Let me push on that a bit —"),
    "lead_stay": ("Staying with that —", "Building on that —", "On that point,"),
    "lead_case": ("In that case,", "With that in mind,", "Given that,"),
    "lead_quick": ("Quick one —", "Okay, quick one —", "Okay, picture this —"),
}
# fillers, per stage (the family names are only compared within a stage)
FILLER_FAMILIES: dict[str, tuple[str, ...]] = {
    "one_moment": ("One moment.", "One moment, please.", "Okay, one moment.", "Hmm, one moment."),
    "just_moment": ("Just a moment.", "A moment, please."),
    "give_moment": ("Give me a moment.", "Allow me a moment.", "Hold on a moment."),
    "let_me_think": ("Let me think.", "Mm, let me think.", "Hold on, let me think."),
    "think_about": ("Hmm, let me think about that.", "Okay, let me think about that for a moment.", "Let me think for a moment.", "Okay, one moment, let me think."),
    "bear": ("Bear with me, almost there.", "Bear with me.", "Still thinking, bear with me.", "Okay, almost there, bear with me.", "Thanks for bearing with me."),
    "there": ("Almost there.", "Nearly there.", "Just about there.", "Nearly there, thank you.", "Hang on, almost there."),
    "more": ("Just a little more.", "Give me just a bit longer.", "A little longer, please.", "Just a bit more."),
    "still": ("Still with you, one moment.", "Still working on it.", "Hmm, still thinking about this.", "Still on it."),
    "wait": ("Sorry about the wait.", "Sorry for the wait, almost there.", "Sorry to keep you waiting."),
    "apology": ("Apologies for the delay.", "My apologies for the wait.", "Apologies, almost there.", "Sorry for the delay."),
    "longer": ("Sorry, I'm taking longer than I'd like.", "Sorry, this is taking longer than I expected.", "Sorry, this is taking a while."),
    "still_on": ("Sorry, still on it.", "Sorry, bear with me."),
    "nearly": ("Sorry about this, almost done.", "Really sorry, nearly there.", "Sorry, nearly done."),
    "long_wait": ("Sorry for the long wait.", "Apologies for the long wait, I'm nearly there.", "Apologies for the long delay."),
    "thanks_patience": ("Thank you for your patience.", "Thank you for waiting.", "I appreciate your patience, nearly there."),
    "thanks_nearly": ("Thank you for waiting, nearly there.", "Thanks for staying with me, nearly there.", "Thank you, nearly there.", "Thank you for your patience, almost done."),
    "thanks_working": ("Sorry for the delay, thank you for your patience.", "Thank you for your patience, I'm still working on it.", "I appreciate your patience."),
    "done": ("Sorry, I'm nearly done.", "Sorry for making you wait, I'm nearly done.", "Apologies, I'm nearly there.", "Sorry, still here, nearly done."),
    "working": ("Sorry, I'm still working on this.", "Sorry for the wait, I am still working on it.", "I'm really sorry about this, I'm still here."),
}


def _with_families(group: tuple[Phrase, ...], table: dict[str, tuple[str, ...]]) -> tuple[Phrase, ...]:
    of = {text: family for family, texts in table.items() for text in texts}
    return tuple(replace(p, family=of.get(p.text)) for p in group)


ACKS = _with_families(ACKS, FAMILIES)
NEUTRAL_ACKS = tuple(p for p in ACKS if not p.verdict)
VERDICT_ACKS = tuple(p for p in ACKS if p.verdict)
BACKCHANNELS = _with_families(BACKCHANNELS, FAMILIES)
FILLERS = _with_families(FILLERS, FILLER_FAMILIES)
LEAD_INS = _with_families(LEAD_INS, FAMILIES)
_known = {p.text for p in ACKS + BACKCHANNELS + FILLERS + LEAD_INS}
_unknown = [t for table in (FAMILIES, FILLER_FAMILIES) for texts in table.values() for t in texts if t not in _known]
if _unknown:                                                           # a typo in a family would silently leave the phrase free
    raise ValueError(f"families name phrases that are not in the vocabulary: {_unknown}")


VOCABULARY: tuple[Phrase, ...] = ACKS + BACKCHANNELS + FILLERS + LEAD_INS


# ---------------------------------------------------------------------------------------------------------------------------------
# Lookups the drawing and the matchers use.
# ---------------------------------------------------------------------------------------------------------------------------------

def fits(phrase: Phrase, traits: dict[str, str]) -> bool:
    """Whether the phrase suits a persona with these traits (an axis the phrase does not name suits any level; a trait the persona does
    not have counts as its default level: a blueprint from before the `register` trait has the neutral register)."""
    return all((traits.get(axis) or ("neutral" if axis == "register" else None)) in levels for axis, levels in phrase.fits.items())


def by_kind(kind: Kind, stage: str | None = None) -> tuple[Phrase, ...]:
    return tuple(p for p in VOCABULARY if p.kind == kind and (stage is None or p.stage == stage))


def texts(kind: Kind, stage: str | None = None) -> tuple[str, ...]:
    return tuple(p.text for p in by_kind(kind, stage))


def phrase_of(text: str, kind: Kind | None = None, stage: str | None = None) -> Phrase | None:
    for p in VOCABULARY:
        if p.text == text and (kind is None or p.kind == kind) and (stage is None or p.stage == stage):
            return p
    return None


# ---------------------------------------------------------------------------------------------------------------------------------
# Matchers derived from the vocabulary: the talker recognises every phrase above as it is tagged, so a new phrase needs no regex.
# ---------------------------------------------------------------------------------------------------------------------------------
_WORD = re.compile(r"[A-Za-z0-9']+")
_SEPARATOR = r"[\s,.;:!—–-]+"


def phrase_pattern(text: str) -> str:
    """A regex fragment for the words of `text` (case-insensitive use): punctuation between the words is free, an apostrophe may be curly,
    the end punctuation is not part of it."""
    return _SEPARATOR.join(re.escape(w).replace("'", "['’]") for w in _WORD.findall(text.replace("’", "'")))


def alternation(phrases_texts: tuple[str, ...] | list[str]) -> str:
    """`(?:a|b|c)` over the phrases' patterns, longest first, without duplicates."""
    seen: dict[str, str] = {}
    for t in phrases_texts:
        seen.setdefault(phrase_pattern(t), t)
    return "(?:" + "|".join(sorted(seen, key=len, reverse=True)) + ")"


# A bare acknowledgement: every neutral acknowledgement and nod of the vocabulary. Said alone it judges nothing and asks for nothing, so the
# talker's rules for a reply that only acknowledges apply (an empty reply to a real answer, a second one in a turn, one after the question).
# Not in it: a verdict ("Perfect.", "Love that."): a lone verdict is kept as the reply, governed by the verdict budget instead (the matchers
# below).
BARE_TEXTS = tuple(p.text for p in ACKS + BACKCHANNELS if not p.verdict)
BARE_PATTERN = alternation(BARE_TEXTS)
# A verdict, as the opening of a sentence ("Love that you named the invariant." opens with the verdict "Love that.").
VERDICT_PATTERN = alternation([p.text for p in ACKS + BACKCHANNELS if p.verdict])
# A lead-in at the start of a sentence, whole ("One thing I'd like to understand —"): the talker counts it as the turn's opener.
LEAD_IN_PATTERN = alternation([p.text for p in LEAD_INS])
