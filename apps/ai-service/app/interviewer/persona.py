"""A candidate played by a model, for the adaptive rehearsals: a line source for `simulate` that answers what the interviewer actually said
(the scripted rehearsals read fixed lines whatever is asked, which made some findings artefacts). Each turn the model sees its persona,
its resume, the conversation, the problem on screen and its own code, and replies with what to say, whether to type, how long to stay
silent first, what to highlight and whether to press End; `reply_lines` turns that into the simulator's script lines.

    .venv/bin/python scripts/rehearse_flow.py persona SPEC.json OUT_PREFIX"""
from __future__ import annotations

from typing import Any

from app.interviewer.llm import LLMUnavailable

MAX_WAIT_S = 300
USAGE_KEYS = ("prompt_tokens", "completion_tokens", "total_tokens", "cost")

PERSONA_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "say": {"type": "string", "description": "What you say aloud this turn, one to four sentences. Empty string means you stay silent."},
        "code": {"type": ["string", "null"], "description": "Your FULL current code, only when it changed this turn; otherwise null."},
        "wait_s": {"type": "integer", "minimum": 0, "maximum": MAX_WAIT_S,
                   "description": "Seconds of silence BEFORE you speak (for example while you think or type code). 0 for a normal reply."},
        "select_text": {"type": ["string", "null"],
                        "description": "Exact words from the problem statement to highlight before you speak, or null."},
        "end": {"type": "boolean", "description": "True only when you press End to leave the interview."},
    },
    "required": ["say", "code", "wait_s", "select_text", "end"],
}

FORMAT_NOTE = ("Each turn you are shown the conversation so far, the problem on your screen (if any) and your current code. Reply as JSON: "
               "`say` (what you say aloud; empty string to stay silent), `code` (your full current code, only when it changed), `wait_s` "
               "(seconds of silence before speaking, 0-300), `select_text` (exact words from the problem statement to highlight before "
               "speaking, or null), `end` (true only to press End). The interviewer sees your editor, not your thoughts: whenever you "
               "write or change code, put the whole program in `code` that turn, as a real candidate types it (often over a few turns, "
               "with a silence while typing); never say you have written code that is not in `code`. Speak like a person on a call, not "
               "an essay: most turns are one to three sentences.")


def resume_text(profile: dict[str, Any]) -> str:
    """The candidate's resume as the blueprint was prepared from it: headline, skills, projects, experience and education."""
    lines = ["Your resume (everything you know about yourself):"]
    if profile.get("headline"):
        lines.append(f"Headline: {profile['headline']}")
    if profile.get("skills"):
        lines.append("Skills: " + ", ".join(str(s) for s in profile["skills"]))
    for p in profile.get("projects") or []:
        stack = ", ".join(p.get("stack") or [])
        lines.append(f"Project: {p.get('name')}" + (f" ({stack})" if stack else "") + f" - {p.get('summary') or p.get('description') or ''}".rstrip(" -"))
    for e in profile.get("experience") or []:
        lines.append("Experience: " + ", ".join(str(v) for v in (e.get("role") or e.get("title"), e.get("company"), e.get("summary")) if v))
    for e in profile.get("education") or []:
        lines.append("Education: " + ", ".join(str(v) for v in (e.get("degree"), e.get("field"), e.get("institution"), e.get("year")) if v))
    return "\n".join(lines) if len(lines) > 1 else ""


def reply_lines(reply: dict[str, Any]) -> list[str]:
    """One model reply as simulator script lines: the silence, the highlight, the typing, then the spoken line; `end` presses End."""
    out: list[str] = []
    wait = max(0, min(MAX_WAIT_S, int(reply.get("wait_s") or 0)))
    if wait:
        out.append(f"#wait {wait}")
    if (select := " ".join(str(reply.get("select_text") or "").split())):
        out.append(f"#at -1 select panel {select}")
    if reply.get("code"):
        out.append("#code " + str(reply["code"]).replace("\n", "\\n"))
    if (say := " ".join(str(reply.get("say") or "").split())):
        out.append(say)
    if reply.get("end"):
        out.append("#end")
    return out


class PersonaCandidate:
    def __init__(self, spec: dict[str, Any], chat, resume: str) -> None:
        self.spec, self.chat = spec, chat
        name = f"Your first name is {spec['first_name']}." if spec.get("first_name") else ""
        self.system = "\n\n".join(p for p in (spec["behaviour"], name, f"How you code: {spec['coding']}", resume, FORMAT_NOTE) if p)
        self.turns = 0
        self.usage: dict[str, float] = {k: 0 for k in USAGE_KEYS}
        self.silences: list[dict[str, Any]] = []        # for the trace checks: when the candidate went quiet, how long, and whether code changed
        self.selections: list[dict[str, Any]] = []      # and when they highlighted what
        self.code_log: list[dict[str, Any]] = []        # and what they typed when (the judge sees it as stage notes)
        self.failed = False

    def _messages(self, view: dict[str, Any]) -> list[dict[str, Any]]:
        seen = ["## The conversation so far", *(view.get("transcript") or ["(nothing yet)"]),
                "", "## The problem on your screen", view.get("on_screen") or "(none yet)",
                "", "## Your current code", view.get("code") or "(empty)",
                "", f"Seconds since the interview began: {int(view.get('clock_s') or 0)}. Reply with your next turn."]
        return [{"role": "system", "content": self.system}, {"role": "user", "content": "\n".join(seen)}]

    async def next_lines(self, view: dict[str, Any]) -> list[str] | None:
        if self.turns >= int(self.spec["max_candidate_turns"]):
            return ["#end"]
        self.turns += 1
        reply: dict[str, Any] | None = None
        for _ in range(2):                              # one retry: a rehearsal should not die on a blip
            try:
                reply, usage = await self.chat.json(self._messages(view), "persona_turn", PERSONA_SCHEMA, 1500)
                break
            except LLMUnavailable:
                continue
        if reply is None:
            self.failed = True
            return ["#end"]
        for key in USAGE_KEYS:
            self.usage[key] += float(usage.get(key) or 0) if key == "cost" else int(usage.get(key) or 0)
        self.usage["cost"] = round(self.usage["cost"], 6)
        lines = reply_lines(reply)
        wait = max(0, min(MAX_WAIT_S, int(reply.get("wait_s") or 0)))
        if wait:
            self.silences.append({"start": float(view.get("clock_s") or 0), "wait_s": wait, "code": bool(reply.get("code"))})
        if reply.get("code"):
            self.code_log.append({"at": float(view.get("clock_s") or 0) + wait, "code": str(reply["code"])})
        if (text := " ".join(str(reply.get("select_text") or "").split())):
            self.selections.append({"at": float(view.get("clock_s") or 0) + wait, "text": text})
        return lines
