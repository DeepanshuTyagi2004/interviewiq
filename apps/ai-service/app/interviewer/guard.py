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
NEUTRAL_LINE = "What do you think?"
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


def _squash(text: str) -> str:
    return re.sub(r"\s+", "", text.lower())


_KIND = re.compile(
    r"\b(?:graph|search|binary search|dynamic programming|dp|tree|stack|heap|greedy|sorting|backtracking|recursion|two[- ]pointers?|"
    r"sliding window|linked list|matrix|string|array|queue|trie|bfs|dfs|topological|interval|bit(?:wise)?)\b", re.IGNORECASE)
_NEXT_ONE = re.compile(r"\bnow (?:a|an) [a-z\- ]{0,30}(?:problem|question)\b|\b(?:this one|next one|next problem|next question|another (?:problem|one|question)|one more|second (?:problem|one|question))\b",
                       re.IGNORECASE)


class LeakGuard:
    def __init__(self, blueprint: dict[str, Any]) -> None:
        self.solutions: dict[str, set[tuple[str, ...]]] = {}
        self.examples: dict[str, list[str]] = {}
        self.titles: list[str] = []
        self.statements: dict[str, set[tuple[str, ...]]] = {}    # each problem's statement as runs of STATEMENT_GRAM words
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
            self.statements[sid] = _word_grams(content.get("statement") or content.get("question") or "") \
                | _word_grams((slot.get("ask") or {}).get("opening") or "")
            title = ((slot.get("problem") or {}).get("title") or "").strip().lower()
            if len(title) >= 4:
                self.titles.append(title)
            shown = set(_WORD.findall((content.get("statement") or content.get("question") or "").lower()))
            shown = {w.rstrip("s") for w in shown}
            self.title_words |= {w.rstrip("s") for w in _WORD.findall(title)
                                 if w not in _COMMON and w.rstrip("s") not in _COMMON and w.rstrip("s") not in shown}

    def _solution(self, text: str) -> Verdict | None:
        grams = _ngrams(text)
        for sid, solution in self.solutions.items():
            if solution and len(grams & solution) >= MIN_SHARED_NGRAMS:
                return Verdict(False, "solution_code", sid)
        return None

    def check_sentence(self, text: str, *, current_slot: str | None, candidate_said: str = "", spoken: bool = True) -> Verdict:
        if (v := self._solution(text)) is not None:
            return v
        flat = _squash(text)
        for literal in self.examples.get(current_slot or "", []):
            if literal in flat:
                return Verdict(False, "example_read_aloud", literal)
        if spoken and len(_PLAIN_WORD.findall(text.lower())) >= STATEMENT_MIN_WORDS:
            # Any problem of the round, shown yet or not: the interviewer never reads one out (screen text may quote it).
            grams = _word_grams(text)
            if any(len(grams & statement) >= STATEMENT_MIN_GRAMS for statement in self.statements.values()):
                return Verdict(False, "statement_read_aloud", text[:60])
        low, said = text.lower(), candidate_said.lower()
        for title in self.titles:
            if title in low and title not in said:
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

    def check_text(self, text: str, candidate_said: str = "") -> Verdict:
        """Text the talker puts on the candidate's screen (sections, notes, comments, labels): the sentence
        rules without the example check, which only makes sense for speech about the current problem."""
        return self.check_sentence(text, current_slot=None, candidate_said=candidate_said, spoken=False)

    def check_code(self, text: str) -> Verdict:
        return self._solution(text) or Verdict(True)
