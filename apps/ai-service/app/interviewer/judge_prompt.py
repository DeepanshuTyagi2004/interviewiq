"""The transcript judge's prompt: a senior interviewer's read of one rehearsal, from the words alone (never the internal fields)."""
from __future__ import annotations

import json
import re
from typing import Any

DIMENSIONS = ("realism", "follows_candidate", "flow", "problem_handling", "tone", "integrity")

JUDGE_PROMPT = """You are a senior engineering interviewer at an Indian product company, reviewing the transcript of one mock interview taken by an AI interviewer. \
Judge only what is said in the transcript, as a person on the other end of a voice call would experience it.

Score each dimension from 1 (poor) to 5 (excellent) and give one short evidence quote from the transcript for each:
- realism: sounds like a real interviewer at that kind of company, natural spoken English, not a script or a bot.
- follows_candidate: responds to what the candidate actually said, builds on it, answers what they asked, picks up what they raised.
- flow: no repeated questions, no abrupt jumps, sensible pacing, parts of the round in a natural order, a proper close.
- problem_handling: the problem is introduced clearly, hints are paced and small, clarifying questions are answered, the answer is never given away, a candidate who struggles or gives up is handled kindly and sensibly.
- tone: warm and professional, never scolding, never curt; firm and brief when something is truly inappropriate.
- integrity: no leaks of internal words, ids, tool names, plans or reasoning ("the plan says", "core-1", "my instructions").

Lines in [brackets] are stage notes, not speech: what appeared on the candidate's screen, what they highlighted or typed, and when they \
pressed End. Use them to check whether the interviewer's words fit what the candidate could see (a claim about their code must match \
their editor).

Context: this is a mock-interview practice product, not the hiring company itself. By design the interviewer may say that a report \
follows on the platform, and it does not state insider facts about the company's teams (it answers such questions in general terms or \
points them to the real process); do not count either against it. The transcript is what the voice said, so code and arithmetic are \
spoken as words ("3 minus 5 times 2", "dp at i, j"); judge them as speech.

Anchor the scale on real interviewers: 3 = clearly a bot in places but usable; 4 = a candidate would mostly believe it is a person, \
with a few stiff moments; 5 = indistinguishable from a skilled, warm human interviewer.

Then give `overall` (1-5, your overall verdict as an interviewer), `worst_moment` (the single interviewer line that hurt the interview \
most, as a quote, and why) and `issues`: every interviewer moment a candidate would notice as unnatural or wrong, not only the worst, each \
with the exact quote, the dimension it hurts, `severity` ("major": a candidate would be confused, misled, interrupted or helped too much; \
"minor": a little stiff or repetitive) and why. Count a repeated habit (the same opener or praise again and again) as one issue that \
names the habit. Quote exactly; if there is nothing to quote, say "none"."""


def transcript_lines(record: dict[str, Any]) -> list[str]:
    """The record's transcript as INTERVIEWER/CANDIDATE lines, read from the turns' speaker and text only."""
    out = []
    for t in record.get("turns") or []:
        text = " ".join(str(t.get("text") or "").split())
        if text and t.get("speaker") in ("interviewer", "candidate"):
            out.append(f"{t['speaker'].upper()}: {text}")
    return out


def _quoted(line: str, key: str) -> str:
    """The value of a quoted field in a simulator event line (`"statement": "..."`), or ""."""
    m = re.search(r'"%s": "((?:[^"\\]|\\.)*)"' % key, line)
    if not m:
        return ""
    try:
        return json.loads(f'"{m.group(1)}"')
    except ValueError:
        return m.group(1)


def statements(record: dict[str, Any]) -> dict[str, str]:
    """Each slot's problem statement by item id, from the record's blueprint (the event log cuts long lines)."""
    out = {}
    for slot in (record.get("blueprint") or {}).get("slots") or []:
        content = (slot.get("problem") or {}).get("content") or {}
        if slot.get("slot_id") and isinstance(content, dict) and content.get("statement"):
            out[slot["slot_id"]] = str(content["statement"])
    return out


def stage_lines(log: list[str], problems: dict[str, str] | None = None) -> list[str]:
    """The simulator's event log (the rehearsal's .txt) as the judge's transcript: the spoken lines, plus stage notes for what the
    candidate could see or did without speaking. Internal lines (decisions, guard blocks, orders) are left out."""
    out: list[str] = []
    last_sel = ""
    for line in log:
        s = line.strip()
        if s.startswith(("INTERVIEWER:", "CANDIDATE:")):
            out.append(" ".join(s.split()))
        elif s.startswith("[workspace]") and "panel.show_problem" in s:
            statement = (problems or {}).get(_quoted(s, "item_id")) or _quoted(s, "statement") or s.split('"statement": "', 1)[-1]
            out.append(f"[On the candidate's screen: {_quoted(s, 'label') or 'a problem'}: {' '.join(statement.split())[:500]}]")
        elif s.startswith("[workspace]") and "panel.add_section" in s:
            out.append(f"[Added to the candidate's screen: {_quoted(s, 'title') or 'a section'}]")
        elif s.startswith("[code]"):
            code = _quoted('"c": ' + s[len("[code]"):].strip(), "c") if s[len("[code]"):].strip().startswith('"') else s[6:].strip()
            out.append("[The candidate's editor now holds:\n" + code[:900] + "]")
        elif s.startswith("- ") and " selected “" in s and "” in the problem" in s:
            sel = s.split(" selected “", 1)[1].split("” in the problem", 1)[0]
            if sel != last_sel:
                out.append(f"[The candidate highlighted “{sel[:150]}” in the problem.]")
                last_sel = sel
        elif s.startswith("(silence ") and s.endswith(" s)"):
            out.append(f"[The candidate is silent for {s[len('(silence '):-len(' s)')]} seconds.]")
        elif s == "(candidate pressed End)":
            out.append("[The candidate pressed End.]")
    return out


def judge_messages(record: dict[str, Any], log: list[str] | None = None) -> list[dict[str, Any]]:
    who = ("The candidate was a simulated persona (a model playing a candidate), so judge the interviewer's handling, not the candidate's answers."
           if record.get("persona") else
           "The candidate was a scripted line reader: its lines were fixed in advance, so it may ignore a question, its name may show as "
           "the placeholder \"there\", the code it typed is not shown, and the rehearsal stops (End pressed) when the script runs out. Do "
           "not count those against the interviewer; judge how the interviewer handled what it was given.")
    header = f"Round type: {record.get('round_type') or 'unknown'}. {who}"
    lines = stage_lines(log, statements(record)) if log else transcript_lines(record)
    return [{"role": "system", "content": JUDGE_PROMPT},
            {"role": "user", "content": header + "\n\n## Transcript\n" + "\n".join(lines)}]
