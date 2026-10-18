"""A small, realistic blueprint and run context for the interviewer tests, and a manual clock."""
from __future__ import annotations

REFERENCE = ("def pair_sum(nums, target):\n    seen = {}\n    for i, x in enumerate(nums):\n"
             "        if target - x in seen:\n            return [seen[target - x], i]\n        seen[x] = i\n")


def _slot(slot_id: str, kind: str, order: int, title: str) -> dict:
    return {
        "slot_id": slot_id, "kind": kind, "order": order, "purpose": "", "timebox_mins": 20,
        "problem": {"round_type": "dsa", "slug": f"slug-{slot_id}", "title": title, "difficulty": "medium", "content_hash": "h",
                    "content": {"statement": f"Given an array of integers nums and an integer target, solve {title.lower()}.",
                                "examples": [{"args": {"nums": [2, 7, 11, 15], "target": 9}, "expected": [0, 1], "explanation": "2 + 7 = 9"},
                                             {"args": {"nums": [3, 3], "target": 6}, "expected": [0, 1], "explanation": "3 + 3 = 6"}],
                                "constraints": ["2 <= len(nums) <= 10^4", "exactly one answer"],
                                "input_format": "nums: list[int], target: int", "output_format": "list[int] of two indices",
                                "patterns": ["hash map"]}},
        "answer_key": {"key": {"approaches": [{"name": "Brute force", "idea": "check every pair", "time_complexity": "O(n^2)", "space_complexity": "O(1)"},
                                              {"name": "One pass", "idea": "remember each value's index", "time_complexity": "O(n)", "space_complexity": "O(n)"}],
                               "complexity_target": "O(n) time", "key_insights": ["look up the complement", "one pass is enough"],
                               "common_wrong_paths": [{"path": "sorting first", "why_wrong": "loses the indices", "nudge": "What happens to the indices?"}],
                               "edge_cases": ["duplicates", "negative numbers"],
                               "reference_solution": {"language": "python", "entry_point": "pair_sum", "code": REFERENCE}}},
        "ask": {"opening": f"Let's work on a problem about {title.lower()}.", "clarifications": [{"question": "Can values repeat?", "answer": "Yes."}]},
        "hint_ladder": [{"step": 1, "hint": "What do you need to remember as you scan?"},
                        {"step": 2, "hint": "A lookup structure could help."},
                        {"step": 3, "hint": "Store each value's index as you go."}],
        "branches": [{"condition": "stuck", "action": "give_hint", "say": "Let's take a step back.", "notes": ""},
                     {"condition": "asks_for_answer", "action": "decline_politely", "say": "I'd rather see how you think it through.", "notes": ""}],
        "probes": ["Why that structure?"], "follow_ups": ["What if the array were sorted?"],
        "expectations": {"must_show": ["an O(n) approach"], "strong_signals": [], "weak_signals": []},
        "evaluation_signals": [{"signal": "approach", "observe": "moves from brute force to one pass"}],
    }


def blueprint() -> dict:
    return {
        "blueprint_id": "bp1", "session_id": "s1", "candidate_id": "c1", "version": 1, "status": "current",
        "input_hash": "h", "run_id": "run1", "created_at": "2026-10-08T00:00:00+00:00",
        "round": {"company": "salescode", "type": "dsa", "duration_mins": 60},
        "persona": {"name": "Siddharth Menon", "seniority": "Software Engineer", "style": "warm, asks probing follow-ups",
                    "disposition": "Patient and curious; lets the candidate think.", "opening": "Hi, I'm Siddharth. Thanks for joining.",
                    "closing": "Thanks for your time today. That's all from my side.", "grounded_in": []},
        "arc": [{"phase": "greeting", "timebox_mins": 1, "scored": False, "guidance": "Greet warmly."},
                {"phase": "candidate_intro", "timebox_mins": 2, "scored": True, "guidance": "Ask for a short intro."},
                {"phase": "core", "timebox_mins": 40, "scored": True, "guidance": ""},
                {"phase": "candidate_questions", "timebox_mins": 4, "scored": True, "guidance": "Invite their questions."},
                {"phase": "wrap_up", "timebox_mins": 1, "scored": False, "guidance": "Close warmly."}],
        "personalization": {"rapport_hooks": [{"line": "I saw your split-bill app.", "source": "projects"}],
                            "resume_probes": [{"prompt": "Tell me about the split-bill app's settlement logic.", "grounded_in": "projects", "what_it_tests": "ownership"}],
                            "level_expectations": "SDE-1: working code, complexity, a few edge cases.", "round_questions": []},
        "slots": [_slot("core-1", "core", 1, "Pair Sum"), _slot("core-2", "core", 2, "Window Peak"),
                  _slot("reserve-alternate", "reserve", 3, "Island Count")],
        "policies": {"version": "pol1",
                     "requests": [{"kind": "extend_time", "decision": "partial", "how": "Allow a minute or two."},
                                  {"kind": "ask_solution", "decision": "decline", "how": "Decline kindly; offer a hint."}],
                     "off_topic": "Steer back.", "time_management": "Watch the timebox.", "integrity": "Ask them to explain.",
                     "fallback": "Act as a fair interviewer."},
        "evaluation": {"global_signals": [{"signal": "communication", "observe": "thinks aloud"}]},
        "briefing": {"interviewer_name": "Siddharth Menon", "interviewer_style": "warm", "format": "coding", "duration_mins": 60},
        "provenance": {},
    }


def context() -> dict:
    return {"session_id": "s1", "candidate_id": "c1", "first_name": "Asha",
            "round": {"company": "salescode", "company_name": "Salescode", "role": "Software Engineer", "level": "sde1",
                      "round_type": "dsa", "duration_mins": 60},
            "profile": {"headline": "Backend engineer", "skills": ["Java", "SQL", "React"], "projects": ["Split app"]}}


class Clock:
    def __init__(self, t: float = 1000.0) -> None:
        self.t = t

    def __call__(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


def deep_dive_blueprint(framing: bool = True) -> dict:
    """The salescode fresher round from the rehearsal evidence: a 12-minute deep dive with two resume probes and four round questions
    (two of them on SQL, one on Java, one about motivation)."""
    bp = blueprint()
    bp["round"]["deep_dive_mins"] = 12
    bp["personalization"]["resume_probes"] = [
        {"prompt": "You mentioned leading a team of three engineers for the Experience Portal. Can you walk me through how you planned the sprint "
                   "and performed code reviews?", "grounded_in": "experience.summary", "what_it_tests": "leadership"},
        {"prompt": "In the Relay project you used SQLite and Claude API together. How did you design the data schema and handle persistence for "
                   "the command history?", "grounded_in": "projects[0].stack", "what_it_tests": "database design"}]
    bp["personalization"]["round_questions"] = [
        {"prompt": "Can you explain how a Java HashMap works internally?", "covers": "java-hashmap", "what_it_tests": "collections"},
        {"prompt": "What is the difference between WHERE and HAVING in SQL, and how would you find customers with more than five orders?",
         "covers": "sql-where-having", "what_it_tests": "SQL"},
        {"prompt": "In your Vibe project you used Prisma with a PostgreSQL backend. How do you model a one-to-many relationship in Prisma, "
                   "and what SQL constraints does it generate?", "covers": "SQL fundamentals", "what_it_tests": "foreign keys"},
        {"prompt": "Why are you interested in joining Salescode.ai now, and how does the work you've done align with our AI-driven sales platform?",
         "covers": "resume-based question", "what_it_tests": "motivation"}]
    if framing:
        bp["arc"].insert(1, {"phase": "framing", "timebox_mins": 1, "scored": False, "guidance": ""})
    return bp


def realism_blueprint(promises: tuple[str, ...] = ("projects:Relay", "fundamentals:Java", "fundamentals:databases")) -> dict:
    """The deep-dive round after the realism stage: its outline (the arc's order, the deep dive after the core) promises `promises`."""
    bp = deep_dive_blueprint()
    parts = [{"part": a["phase"], "promises": []} for a in bp["arc"]]
    parts.insert(next(n for n, p in enumerate(parts) if p["part"] == "core") + 1, {"part": "deep_dive", "promises": list(promises)})
    bp["realism"] = {"seed": 7, "traits": {}, "habits": {"acks": [], "backchannels": [], "fillers": {}}, "outline": parts,
                     "change": {"firmness": "normal", "refusals_prior": 1}}
    return bp
