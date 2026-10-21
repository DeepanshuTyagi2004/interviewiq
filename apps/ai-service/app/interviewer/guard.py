"""The leak guard (spec §5.5): checks each sentence before the voice speaks it, and every code insert
before it is sent. Deterministic rules; the director's leak_review audits what rules can't catch."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

NGRAM = 6
MIN_SHARED_NGRAMS = 2
STATEMENT_GRAM = 4          # words in a row copied from the problem statement...
STATEMENT_MIN_WORDS = 8     # ...in a sentence at least this long...
STATEMENT_MIN_GRAMS = 2     # ...at least this many times: the statement is being read out, however loosely
SELECTION_MIN_GRAMS = 4     # while they ask about text they highlighted: the selection itself is free to explain, other parts need this many
NEUTRAL_LINE = "Could you say a bit more about that?"   # never "what do you think?": said right after a problem goes up it asks about nothing
_WORD = re.compile(r"[a-z]{4,}")
_PLAIN_WORD = re.compile(r"[a-z]+")
# Words in a problem's original name that are ordinary speech anywhere in an interview: never a giveaway.
_COMMON = frozenset("""best time with from into that this what when where then than them they have will your you about after
    before between number numbers list array arrays string strings find finding given using sum maximum minimum largest smallest
    longest shortest first last each every second third other same only more most less least less equal sorted unique
    distinct duplicate duplicates value values index indices element elements count pair pairs sequence subarray substring
    problem question level node nodes tree trees graph path""".split())
_TOKEN = re.compile(r"[A-Za-z_][A-Za-z0-9_]*|\d+|==|!=|<=|>=|[-+*/%<>=\[\](){}:,.]")
_PLAIN_RESULTS = frozenset({"true", "false", "null", "none"})
_DIFFICULTY = re.compile(
    r"\b(easy|medium|hard)\b[^.?!]{0,20}\b(problem|question|one|level)\b|\b(problem|question)\b[^.?!]{0,20}\b(easy|medium|hard)\b",
    re.IGNORECASE)


@dataclass
class Verdict:
    ok: bool
    rule: str = ""
    match: str = ""


def _ngrams(text: str) -> set[tuple[str, ...]]:
    tokens = _TOKEN.findall(text)
    return {tuple(tokens[i:i + NGRAM]) for i in range(len(tokens) - NGRAM + 1)}


def _word_grams(text: str, n: int = STATEMENT_GRAM) -> set[tuple[str, ...]]:
    words = _PLAIN_WORD.findall(text.lower())
    return {tuple(words[i:i + n]) for i in range(len(words) - n + 1)}


# Words any interviewer says ("tell me how you'd approach it"). A run of them shared with a problem's prepared opening is not the
# problem read aloud: a live round blocked every "tell me how you'd start" because problem 2's opening said it.
_CONVERSATIONAL = frozenset("""a about ahead an and approach are at be can could d do first for go how i idea if in is it let ll look me
    moment more now of on ready s so start take tell that the then think this through time to up us walk we what when with would
    you your re ve alright okay ok right dive get into move jump""".split())

# A prepared opening often begins with the interviewer's own lead-in ("Alright, let's dive into a classic shipping problem..."): that is speech any bridge
# to the coding may repeat ("Alright, let's get into the coding now."), never the problem's statement, so it is cut before the opening's grams are
# taken (decided 2026-10-18; a live round blocked the bridge as statement_read_aloud, the retry asked a question and put the problem up in one turn).
_PREAMBLE = re.compile(r"^\W*(?:(?:alright|all right|okay|ok|so|now|well|right|then)\b\W*)*let'?s\s+(?:dive|get|jump|move|go|step)\s+"
                       r"(?:right\s+)?(?:in(?:to)?|on(?:to)?|over to)\b\W*", re.IGNORECASE)


def strip_preamble(text: str) -> str:
    """The text without the conversational lead-in of each of its sentences ("Alright, let's dive into a classic problem." -> "a classic problem.")."""
    return " ".join(x for x in (_PREAMBLE.sub("", s).strip() for s in re.split(r"(?<=[.?!])\s+", (text or "").strip())) if x)


def _shared_problem_grams(grams: set[tuple[str, ...]], statement: set[tuple[str, ...]]) -> int:
    return sum(1 for g in grams & statement if not set(g) <= _CONVERSATIONAL)


def _squash(text: str) -> str:
    return re.sub(r"\s+", "", text.lower())


_KIND = re.compile(
    r"\b(?:graph|search|binary search|dynamic programming|dp|tree|stack|heap|greedy|sorting|backtracking|recursion|two[- ]pointers?|"
    r"sliding window|linked list|matrix|string|array|queue|trie|bfs|dfs|topological|interval|bit(?:wise)?)\b", re.IGNORECASE)
_NEXT_ONE = re.compile(r"\bnow (?:a|an) [a-z\- ]{0,30}(?:problem|question)\b|\b(?:this one|next one|next problem|next question|another (?:problem|one|question)|one more|second (?:problem|one|question))\b",
                       re.IGNORECASE)


_STEM_WORD = re.compile(r"[a-z]{6,}")
_GENERIC_STEMS = frozenset({"optima", "strate", "global", "theref", "proble", "allows", "yields", "equals", "linear", "better", "should"})


_NUMBER_WORDS = {"1": "one", "2": "two", "3": "three", "4": "four", "5": "five", "6": "six", "7": "seven", "8": "eight", "9": "nine", "10": "ten"}


def name_pattern(title: str) -> re.Pattern[str] | None:
    """A problem's name however it is spoken: "4Sum" is also "four-sum", "four sum" and "4 sum" (a live round confirmed "it is a
    four-sum problem" because only the written "4sum" was checked)."""
    parts = re.findall(r"[a-z]+|\d+", title.lower())
    if not parts:
        return None
    alts = [f"(?:{p}|{_NUMBER_WORDS[p]})" if p in _NUMBER_WORDS else re.escape(p) for p in parts]
    return re.compile(r"\b" + r"[\s\-_]*".join(alts) + r"\b", re.IGNORECASE)


def _stems(text: str) -> set[str]:
    """Words of six letters or more, cut to six: "adding", "positive" and "differences" stay distinctive, "adds" or "difference" match them."""
    return {w[:6] for w in _STEM_WORD.findall((text or "").lower())}


def name_words(slot: dict[str, Any]) -> set[str]:
    """Distinctive words of a problem's original name that its statement on screen never uses ("combination" for Combination
    Sum): saying one gives away which known problem it is. The talker is told them (prompts.item_details); the guard blocks them."""
    title = ((slot.get("problem") or {}).get("title") or "").strip().lower()
    content = (slot.get("problem") or {}).get("content") or {}
    shown = {w.rstrip("s") for w in _WORD.findall((content.get("statement") or content.get("question") or "").lower())}
    return {w.rstrip("s") for w in _WORD.findall(title)
            if w not in _COMMON and w.rstrip("s") not in _COMMON and w.rstrip("s") not in shown}


# Confirming a guess and then explaining why it works ("... is exactly that, it saves you from re-scanning"): the interviewer completes the
# insight with the candidate's own words, which the key-insight word count never sees (b0 struggler_gives_up).
_CONFIRMS = re.compile(r"\bexactly (?:that|it|right|why)\b|\bthat'?s (?:it|right|correct)\b|\byou'?ve got it\b|\bprecisely\b", re.IGNORECASE)
_EXPLAINS = re.compile(r"\b(?:it )?(?:saves|lets you|allows you|stops you|spares you|avoids|prevents|that'?s why|which is why|which means|because|so that)\b",
                       re.IGNORECASE)
_EXPLAINED_MIN_WORDS = 3


def explains_after_confirming(text: str, said: str = "", key_terms: frozenset[str] | set[str] = frozenset(), hint_step: int = 0) -> bool:
    """After at least one hint, a confirmation followed by the reason it works: at least three words after the cue word ("saves", "which",
    "because"...) that the candidate did not use, and at least one of them a key-insight term. The cue words themselves do not count."""
    if hint_step < 1:
        return False
    confirm = _CONFIRMS.search(text)
    if confirm is None:
        return False
    rest = text[confirm.end():]
    explain = _EXPLAINS.search(rest)
    if explain is None:
        return False
    after = rest[explain.end():].lower()
    cue_words = {"which", "means", "because", "that", "saves", "lets", "allows", "stops", "spares", "avoids", "prevents", "again", "other"}
    heard = {w[:5] for w in re.findall(r"[a-z]{5,}", said.lower())}
    new = [w for w in re.findall(r"[a-z]{5,}", after) if w not in cue_words and w[:5] not in heard]
    return len(new) >= _EXPLAINED_MIN_WORDS and any(w[:6] in key_terms for w in new)


# "The problem asks for / expects / requires ...": a requirement the interviewer states as the problem's own. A follow-up is a question, never
# that. The claim's complexity terms must be in the text on screen (b0 strong_fresher turned a follow-up into "the problem asks for O of 1
# extra space", twice).
_REQUIRES = re.compile(r"\b(?:the|this) (?:problem|question|task|statement)\s+(?:also\s+)?(?:asks(?: for)?|expects|requires|wants|needs|demands)\b([^.?!]*)", re.IGNORECASE)
_BIG_O = re.compile(r"\bo\s*(?:of\s+|\()\s*([a-z0-9^*+ ]+?)\s*\)?(?=[\s,.;:?!]|$)")
_COMPLEXITY_WORDS = ("constant", "linear", "logarithmic", "quadratic", "extra", "in-place", "in place", "inplace")


def _complexity_terms(text: str) -> set[str]:
    low = (text or "").lower()
    terms = {"o(" + re.sub(r"\s+", "", m.group(1)) + ")" for m in _BIG_O.finditer(low)}
    return terms | {w for w in _COMPLEXITY_WORDS if w in low}


class LeakGuard:
    def __init__(self, blueprint: dict[str, Any]) -> None:
        self.solutions: dict[str, set[tuple[str, ...]]] = {}
        self.examples: dict[str, list[str]] = {}
        self.titles: list[str] = []
        self.names: list[tuple[str, re.Pattern[str]]] = []    # each problem's name as it may be spoken
        self.statements: dict[str, set[tuple[str, ...]]] = {}    # each problem's statement as runs of STATEMENT_GRAM words
        self.insights: dict[str, set[str]] = {}      # per problem: distinctive words of the key insights and the optimal approach
        self.ladders: dict[str, list[tuple[int, set[str]]]] = {}
        self.visible: dict[str, str] = {}        # per problem: the text a candidate can read (statement, examples, constraints, formats)
        self.facts: dict[str, str] = {}          # per problem: everything the interviewer may say about it as a fact (visible text, follow-ups, probes, clarifications)
        self.title_words: set[str] = set()      # distinctive words of the problems' original names (see check_sentence)
        for slot in blueprint.get("slots", []):
            sid = slot["slot_id"]
            key = (slot.get("answer_key") or {}).get("key") or {}
            self.solutions[sid] = _ngrams(((key.get("reference_solution") or {}).get("code")) or "")
            content = (slot.get("problem") or {}).get("content") or {}
            literals: list[str] = []
            for ex in (content.get("examples") or [])[:2]:
                for value in [*(ex.get("args") or {}).values(), ex.get("expected")]:
                    lit = _squash(json.dumps(value, ensure_ascii=False)).strip('"')
                    if lit in _PLAIN_RESULTS:
                        continue     # "true", "false" and "null" are ordinary words in any follow-up, never a giveaway
                    if len(lit) >= 4 or lit.startswith("["):
                        literals.append(lit)
            self.examples[sid] = literals
            optimal = " ".join(str(a.get("idea") or "") for a in key.get("approaches") or [] if "brute" not in str(a.get("name") or "").lower())
            shown_text = (content.get("statement") or content.get("question") or "") + " " + ((slot.get("ask") or {}).get("opening") or "")
            self.insights[sid] = _stems(" ".join(str(i) for i in key.get("key_insights") or []) + " " + optimal) - _stems(shown_text) - _GENERIC_STEMS
            self.visible[sid] = " ".join(str(x) for x in (content.get("statement") or content.get("question") or "", json.dumps(content.get("examples") or []),
                                                           " ".join(str(c) for c in content.get("constraints") or []), content.get("input_format") or "",
                                                           content.get("output_format") or ""))
            self.facts[sid] = " ".join([self.visible[sid], *(str(x) for x in slot.get("follow_ups") or []), *(str(x) for x in slot.get("probes") or []),
                                        *(f"{c.get('question') or ''} {c.get('answer') or ''}" for c in (slot.get("ask") or {}).get("clarifications") or [])])
            self.ladders[sid] = [(int(h.get("step") or 0), _stems(h.get("hint") or "")) for h in slot.get("hint_ladder") or []]
            self.statements[sid] = _word_grams(content.get("statement") or content.get("question") or "") \
                | _word_grams(strip_preamble((slot.get("ask") or {}).get("opening") or ""))
            title = ((slot.get("problem") or {}).get("title") or "").strip().lower()
            if len(title) >= 4:
                self.titles.append(title)
                if (pattern := name_pattern(title)) is not None:
                    self.names.append((title, pattern))
            self.title_words |= name_words(slot)

    def duration_text(self, current_slot: str | None) -> str:
        """The words a length of time may come from: the current problem's facts only, never the candidate's words
        (`closing.says_duration` exempts a length that exactly matches one found here; decided 2026-10-18, owner-approved)."""
        return self.facts.get(current_slot or "", "")

    def _solution(self, text: str) -> Verdict | None:
        grams = _ngrams(text)
        for sid, solution in self.solutions.items():
            if solution and len(grams & solution) >= MIN_SHARED_NGRAMS:
                return Verdict(False, "solution_code", sid)
        return None

    def check_sentence(self, text: str, *, current_slot: str | None, candidate_said: str = "", spoken: bool = True, selection: str = "") -> Verdict:
        if (v := self._solution(text)) is not None:
            return v
        flat = _squash(text)
        for literal in self.examples.get(current_slot or "", []):
            if literal in flat:
                return Verdict(False, "example_read_aloud", literal)
        if spoken and len(_PLAIN_WORD.findall(text.lower())) >= STATEMENT_MIN_WORDS:
            # Any problem of the round, shown yet or not: the interviewer never reads one out (screen text may quote it).
            grams = _word_grams(text)
            # They asked about text they highlighted (a live round blocked every answer about it): quoting or paraphrasing that text is
            # fine, and reading on past it still is not (more shared runs of the rest of the statement are needed to block).
            chosen, limit = (_word_grams(selection), SELECTION_MIN_GRAMS) if selection.strip() else (set(), STATEMENT_MIN_GRAMS)
            if any(_shared_problem_grams(grams, statement - chosen) >= limit for statement in self.statements.values()):
                return Verdict(False, "statement_read_aloud", text[:60])
        low, said = text.lower(), candidate_said.lower()
        for title, pattern in self.names:
            if pattern.search(low) and not pattern.search(said):
                return Verdict(False, "name_or_topic", title)
        # A paraphrase of the original problem ("a list of daily stock prices") gives away what the problem is even when
        # the exact name is never said: a distinctive word of the name that neither the screen nor the candidate used.
        if current_slot is not None:           # in the conversation parts these are ordinary words ("a remote ships a change")
            heard = {w.rstrip("s") for w in _WORD.findall(said)}
            for word in {w.rstrip("s") for w in _WORD.findall(low)} & self.title_words:
                if word not in heard:
                    return Verdict(False, "name_or_topic", word)
        if _NEXT_ONE.search(text):
            # Announcing a problem must not name its kind ("this one's a search problem"), unless they said the word first.
            heard = set(re.findall(r"[a-z]+", said))
            for kind in _KIND.findall(text):
                if not all(w in heard for w in kind.lower().split()):
                    return Verdict(False, "name_or_topic", kind)
        if (m := _DIFFICULTY.search(text)) is not None:
            return Verdict(False, "difficulty", m.group(0))
        return Verdict(True)

    def check_insight(self, text: str, *, current_slot: str | None, candidate_said: str = "", hint_step: int = 0, last_said: str = "",
                      next_step_allowed: bool = True) -> Verdict:
        """The interviewer says the candidate's half-formed idea back more completely than they said it: two or more distinctive words of the
        key insight that neither they, the statement nor a hint already given has used."""
        words = self.insights.get(current_slot or "")
        if current_slot is not None and words and explains_after_confirming(text, last_said or candidate_said, words, hint_step):
            return Verdict(False, "insight_completed", "confirms their guess and explains why it works")
        if not words:
            return Verdict(True)
        given: set[str] = set()
        for step, stems in self.ladders.get(current_slot or "", []):
            # The hint being given in this very turn is the next one, unless the turn may not give one (a refusal turn gave hint 1 and 2 in
            # ladder words the guard exempted, live round 781a1f0a, turns 27-33).
            if step <= hint_step + (1 if next_step_allowed else 0):
                given |= stems
        hits = {w for w in _stems(text) if w in words} - _stems(candidate_said) - given
        return Verdict(False, "insight_completed", ",".join(sorted(hits))) if len(hits) >= 2 else Verdict(True)

    def check_requirement(self, text: str, *, current_slot: str | None) -> Verdict:
        """A sentence that says the problem asks for or expects something whose complexity terms the problem's own text never uses."""
        m = _REQUIRES.search(text)
        if m is None or current_slot is None:
            return Verdict(True)
        on_screen = _complexity_terms(self.visible.get(current_slot, ""))
        invented = _complexity_terms(m.group(1)) - on_screen
        return Verdict(False, "requirement_invented", ",".join(sorted(invented))) if invented else Verdict(True)

    def check_text(self, text: str, candidate_said: str = "") -> Verdict:
        """Text the talker puts on the candidate's screen (sections, notes, comments, labels): the sentence
        rules without the example check, which only makes sense for speech about the current problem."""
        return self.check_sentence(text, current_slot=None, candidate_said=candidate_said, spoken=False)

    def check_code(self, text: str) -> Verdict:
        return self._solution(text) or Verdict(True)
