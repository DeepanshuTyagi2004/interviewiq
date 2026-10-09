"""The leak guard (spec §5.5): checks each sentence before the voice speaks it, and every code insert
before it is sent. Deterministic rules; the director's leak_review audits what rules can't catch."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

NGRAM = 6
MIN_SHARED_NGRAMS = 2
NEUTRAL_LINE = "What do you think?"
_TOKEN = re.compile(r"[A-Za-z_][A-Za-z0-9_]*|\d+|==|!=|<=|>=|[-+*/%<>=\[\](){}:,.]")
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


def _squash(text: str) -> str:
    return re.sub(r"\s+", "", text.lower())


class LeakGuard:
    def __init__(self, blueprint: dict[str, Any]) -> None:
        self.solutions: dict[str, set[tuple[str, ...]]] = {}
        self.examples: dict[str, list[str]] = {}
        self.titles: list[str] = []
        for slot in blueprint.get("slots", []):
            sid = slot["slot_id"]
            key = (slot.get("answer_key") or {}).get("key") or {}
            self.solutions[sid] = _ngrams(((key.get("reference_solution") or {}).get("code")) or "")
            content = (slot.get("problem") or {}).get("content") or {}
            literals: list[str] = []
            for ex in (content.get("examples") or [])[:2]:
                for value in [*(ex.get("args") or {}).values(), ex.get("expected")]:
                    lit = _squash(json.dumps(value, ensure_ascii=False)).strip('"')
                    if len(lit) >= 4 or lit.startswith("["):
                        literals.append(lit)
            self.examples[sid] = literals
            title = ((slot.get("problem") or {}).get("title") or "").strip().lower()
            if len(title) >= 4:
                self.titles.append(title)

    def _solution(self, text: str) -> Verdict | None:
        grams = _ngrams(text)
        for sid, solution in self.solutions.items():
            if solution and len(grams & solution) >= MIN_SHARED_NGRAMS:
                return Verdict(False, "solution_code", sid)
        return None

    def check_sentence(self, text: str, *, current_slot: str | None, candidate_said: str = "") -> Verdict:
        if (v := self._solution(text)) is not None:
            return v
        flat = _squash(text)
        for literal in self.examples.get(current_slot or "", []):
            if literal in flat:
                return Verdict(False, "example_read_aloud", literal)
        low, said = text.lower(), candidate_said.lower()
        for title in self.titles:
            if title in low and title not in said:
                return Verdict(False, "name_or_topic", title)
        if (m := _DIFFICULTY.search(text)) is not None:
            return Verdict(False, "difficulty", m.group(0))
        return Verdict(True)

    def check_text(self, text: str, candidate_said: str = "") -> Verdict:
        """Text the talker puts on the candidate's screen (sections, notes, comments, labels): the sentence
        rules without the example check, which only makes sense for speech about the current problem."""
        return self.check_sentence(text, current_slot=None, candidate_said=candidate_said)

    def check_code(self, text: str) -> Verdict:
        return self._solution(text) or Verdict(True)
