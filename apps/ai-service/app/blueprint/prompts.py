"""Blueprint prompts. PRODUCT IP — drafts for human review before production use (spec §13).

Bump a stage's version when its prompt changes materially; versions are recorded in every
blueprint's provenance and the answer-key cache is keyed on KEY_VERSION.
"""
from __future__ import annotations

import json

KEY_VERSION = "k2"            # DSA keys: sandbox-verified solutions; k2 adds a reviewer pass over the prose
EXTRAS_KEY_VERSION = "k3"     # other rounds; k2 company-neutral, k3 per level band (one key had served freshers and staff alike)
PERSONA_VERSION = "p4"   # p3: the seeded name is given, not chosen
PERSONALIZATION_VERSION = "z4"   # z2: round questions for what the round's notes call for
PLAYBOOK_VERSION = "b5"       # b2: condition meanings, company, candidate and level rules; b3: STAR stays the candidate's, no placeholders

# Bank categories that belong to one company's culture; a key may name that company only for these.
PRINCIPLE_CATEGORIES = {"amazon-lp": "Amazon", "googleyness": "Google"}


# Non-DSA keys are cached per problem AND per level band: a strong answer differs by seniority.
LEVEL_BAND = {"intern": "early", "fresher": "early", "sde1": "early", "sde2": "mid", "sde3": "mid",
              "staff": "senior", "principal": "senior", "distinguished": "senior"}
BAND_TEXT = {
    "early": "an intern, new graduate or SDE-1: college projects, internships, hackathons, a first job; no team leadership",
    "mid": "an SDE-2 or SDE-3: owns features and services end to end, mentors juniors, handles production issues",
    "senior": "a staff, principal or distinguished engineer: leads across teams, sets technical direction, handles ambiguity at org scale",
}


def level_band(level: str) -> str:
    return LEVEL_BAND.get(level, "early")


def key_version(round_type: str, band: str | None = None) -> str:
    """The answer-key cache version (keys are cached per problem across companies; non-DSA keys per level band)."""
    if round_type in ("dsa", "online-assessment"):
        return KEY_VERSION
    return f"{EXTRAS_KEY_VERSION}-{band}" if band else EXTRAS_KEY_VERSION

PLATFORM = (
    "You prepare mock software-engineering interviews for InterviewIQ, a practice platform for Indian engineering "
    "students and working professionals. The interview is a realistic MOCK: never claim to represent the company, "
    "never promise hiring outcomes. Respond with VALID JSON ONLY: one object, no markdown, no preamble."
)


def _j(value) -> str:
    return json.dumps(value, ensure_ascii=False, indent=1, default=str)


# ================================================================ answer keys

KEY_SYSTEM = PLATFORM + (
    " You write the interviewer's private answer key for one problem: what a correct answer looks like, the insights "
    "that unlock it, the wrong paths candidates commonly take and how to nudge them back, and the edge cases."
)


def dsa_key_prompt(problem: dict) -> str:
    c = problem.get("content") or {}
    params = list(((c.get("examples") or [{}])[0].get("args") or {}).keys())
    facts = {
        "title": problem.get("title"), "difficulty": problem.get("difficulty"),
        "statement": c.get("statement"), "input_format": c.get("input_format"), "output_format": c.get("output_format"),
        "constraints": c.get("constraints"),
        "examples": [{"args": e.get("args"), "expected": e.get("expected")} for e in c.get("examples") or []],
        "answer_order_irrelevant": c.get("answer_order_irrelevant", False),
    }
    return (
        f"Problem:\n{_j(facts)}\n\n"
        "Return exactly:\n{\n"
        '  "approaches": [{"name": "Brute force", "idea": "...", "time_complexity": "O(...)", "space_complexity": "O(...)"}, '
        '{"name": "<optimal>", "idea": "...", "time_complexity": "O(...)", "space_complexity": "O(...)"}],\n'
        '  "complexity_target": "<what an optimal answer achieves, e.g. O(n) time, O(1) space>",\n'
        '  "key_insights": ["<the observation that unlocks the optimal approach>", "..."],\n'
        '  "common_wrong_paths": [{"path": "<a tempting wrong approach>", "why_wrong": "...", "nudge": "<a question that steers back without giving the answer>"}, ... 2 or more],\n'
        '  "edge_cases": ["...", "..."],\n'
        f'  "reference_solution": {{"language": "python", "entry_point": "<function name>", "code": "<complete Python 3.11 code defining that function with EXACTLY these parameters: {", ".join(params) or "(see examples)"}; stdlib only; no I/O; deterministic>"}}\n'
        "}\n"
        "The reference solution will be executed on the examples above and MUST return exactly their expected values."
    )


def dsa_key_repair(problem: dict, mismatches: list[str], previous: dict) -> str:
    return (dsa_key_prompt(problem) + "\n\nYour previous reference solution was executed and failed:\n"
            + "\n".join(f"- {m}" for m in mismatches) + "\n\nPrevious reply:\n" + _j(previous)[:8000]
            + "\n\nReturn the COMPLETE corrected JSON. The examples are ground truth: fix the solution.")


KEY_REVIEW_SYSTEM = PLATFORM + (
    " You are a strict reviewer of an interviewer's answer key for one coding problem. The reference solution has "
    "already been run against the examples; you check the prose: every complexity claim, insight, wrong path and edge "
    "case must be true and consistent with the statement and its constraints."
)


def dsa_key_review(problem: dict, key: dict) -> str:
    c = problem.get("content") or {}
    facts = {"title": problem.get("title"), "statement": c.get("statement"), "input_format": c.get("input_format"),
             "output_format": c.get("output_format"), "constraints": c.get("constraints")}
    return (
        f"Problem:\n{_j(facts)}\n\nAnswer key:\n{_j(key)[:7000]}\n\n"
        "Find every factual error: a wrong time or space complexity (for example calling an O(n) algorithm O(n^2), or "
        "treating a fixed alphabet of 26 as n), an insight or wrong path that is false, an edge case that contradicts the "
        "statement or its constraints. Return exactly:\n{\n"
        '  "errors": [{"field": "<approaches|complexity_target|key_insights|common_wrong_paths|edge_cases>", '
        '"claim": "<the wrong text>", "correction": "<what is true>"}],\n'
        '  "approaches": null, "complexity_target": null, "key_insights": null, "common_wrong_paths": null, "edge_cases": null\n'
        "}\n"
        "Replace a null with the COMPLETE corrected field (same shape as in the key) only for fields with an error. "
        "An empty errors list means the key is correct; then leave every field null."
    )


def extras_prompt(problem: dict, base: dict, band: str = "early") -> str:
    """The key is cached per problem and reused for every company, so it stays company-neutral unless the
    question itself belongs to one company's culture (its category is that company's principles)."""
    owner = PRINCIPLE_CATEGORIES.get(problem.get("category") or "")
    content = dict(problem.get("content") or {})
    if not owner:
        content.pop("principle", None)
        base = {k: v for k, v in base.items() if k != "principle"}
    facts = {"title": problem.get("title"), "round_type": problem.get("round_type"), "difficulty": problem.get("difficulty"),
             "category": problem.get("category"), "content": content}
    neutral = (f"This question belongs to {owner}'s principles: you may name them. Name no other company. "
               if owner else
               "This key is reused for interviews at many companies: never name a company, a company's principles "
               "or values (no 'Leadership Principles', no 'Googleyness'); say 'the team' or 'the company'. ")
    return (
        f"Problem:\n{_j(facts)[:9000]}\n\nWhat the bank already says a strong answer contains:\n{_j(base)[:4000]}\n\n"
        + neutral
        + f"Calibrate everything to {BAND_TEXT.get(band, BAND_TEXT['early'])}: what a strong answer at that level contains, "
          "nothing only a more senior engineer would say, and no jargon a candidate at that level wouldn't know. "
        + "Add what an interviewer needs on top of that. Return exactly:\n{\n"
        '  "must_cover": ["<points a passing answer must cover>", "..."],\n'
        '  "key_insights": ["<what separates a strong answer from an average one>", "..."],\n'
        '  "common_wrong_paths": [{"path": "<a common weak or wrong direction>", "why_wrong": "...", "nudge": "<a question that steers back>"}, ... 2 or more],\n'
        '  "edge_cases": ["<failure scenarios, scale limits, concurrency, or for behavioural: unusual candidate situations '
        'such as no work experience -> accept a project or academic example>", "..."]\n'
        "}"
    )


# ================================================================ persona + arc

PERSONA_SYSTEM = PLATFORM + (
    " You create the interviewer persona for one round: a believable engineer from the company's India office, "
    "warm but rigorous, with a distinct style grounded in what candidates report about this company's interviewers."
)


# A varied pool so interviewers differ across sessions (genders and regions); the run offers a seeded few.
INTERVIEWER_NAMES = (
    "Ananya Iyer", "Arjun Nair", "Priya Deshpande", "Karthik Raman", "Meera Kulkarni", "Vikram Sethi", "Sneha Reddy",
    "Rahul Banerjee", "Aisha Khan", "Siddharth Menon", "Neha Agarwal", "Farhan Qureshi", "Divya Pillai", "Aditya Joshi",
    "Kavya Hegde", "Rohan Malhotra", "Ishita Chatterjee", "Nikhil Verma", "Pooja Shetty", "Imran Siddiqui", "Lakshmi Narayanan",
    "Harpreet Kaur", "Manish Tiwari", "Tanvi Bhatt", "Sameer Gupta", "Nandini Rao", "Abhishek Das", "Ritika Saxena",
    "Gaurav Chauhan", "Shreya Mukherjee", "Varun Kapoor", "Zoya Sheikh", "Pranav Kulkarni", "Anjali Mishra", "Deepak Yadav",
)


def persona_prompt(ctx_view: dict, phases: list[str], names: list[str] | None = None) -> str:
    name_rule = (f"The persona's name is {names[0]}. " if names and len(names) == 1
                 else f"Choose the persona's name from: {', '.join(names)}. " if names else "")
    return (
        f"Round:\n{_j(ctx_view)}\n\n" + name_rule +
        "Return exactly:\n{\n"
        '  "persona": {"name": "<first name and surname, common in India>", "seniority": "<e.g. Senior Software Engineer>", '
        '"style": "<one short line, e.g. calm, asks a lot of why-questions>", "disposition": "<how they react to struggle and to strong answers>", '
        '"opening": "<the first thing they say: greeting + name + a light, natural question>", '
        '"closing": "<how they end: thanks, what happens next on the platform; never a hiring promise>", '
        '"grounded_in": ["<which brief notes shaped this persona>"]},\n'
        '  "phase_guidance": [' + ", ".join(f'{{"phase": "{p}", "guidance": "<how this persona runs {p}>"}}' for p in phases) + "]\n"
        "}\n"
        "Use ONLY the minutes in `phase_minutes` and `time_plan` when guidance mentions time; never state another figure. "
        "small_talk must be natural and unscored (how is your day, something light); framing explains the round's format "
        "without naming topics; candidate_questions answers questions about the role and company honestly and generically."
    )


# ================================================================ personalization

PERSONALIZATION_SYSTEM = PLATFORM + (
    " You tailor one interview to one candidate using ONLY facts present in their profile. Never invent a project, "
    "employer, skill or achievement. Every hook and probe names the profile item it comes from."
)


def personalization_prompt(round_view: dict, profile: dict, needs_probes: bool, round_questions: bool | None = None) -> str:
    probes_rule = ("At least 2 resume_probes are REQUIRED (a project or experience deep-dive). If the profile is thin, "
                   "ground them in education, listed skills or coding practice." if needs_probes
                   else "resume_probes are optional for this round (0-2).")
    if round_questions is None:
        round_questions = needs_probes
    if round_questions:
        probes_rule += (
            " round_questions (0-4): questions the round's `round_topics` or `round_notes` call for that "
            "`questions_already_planned` don't cover, as a real interviewer of this round would ask them: CS fundamentals "
            "(OOP, DBMS, SQL, OS, networks, a language) asked through the candidate's own projects where possible, and HR "
            "checks the notes name (relocation, shifts, why this company). Never repeat a planned question or an "
            "introduction; skip what doesn't apply. For CS fundamentals or a language (OOP, DBMS, SQL, OS, networks, Java, "
            "Python, JavaScript, React, data modelling), take the questions from `fundamentals_pool` and keep their expected "
            "answer (you may tie the wording to the candidate's own project); write your own only for what the pool lacks "
            "(puzzles, HR checks, the resume). Never another coding or algorithm problem: the round's slots hold those. "
            "Never assert a fact about the company (its workload, locations, culture, pay) that isn't in `round_notes`: "
            "ask the candidate about their own side instead. \"Compensation\" means the candidate's salary expectations "
            "and notice period; \"Relocation\" or \"shifts\" only when the notes name them.")
    else:
        probes_rule += " round_questions: []."
    return (
        f"Round:\n{_j(round_view)}\n\nCandidate profile (facts only):\n{_j(profile)[:7000]}\n\n"
        "Return exactly:\n{\n"
        '  "rapport_hooks": [{"line": "<a light, unscored small-talk line grounded in the profile>", "source": "<profile item>"}, ... 1-3],\n'
        '  "resume_probes": [{"prompt": "<a deep-dive question>", "grounded_in": "<profile item>", "what_it_tests": "..."}],\n'
        '  "level_expectations": "<2-4 sentences: what a candidate at this level must show in this round>",\n'
        '  "round_questions": [{"prompt": "<the question, spoken>", "covers": "<the round topic or note it covers>", '
        '"what_it_tests": "...", "expected": "<what a good answer at this level contains>"}]\n'
        "}\n" + probes_rule + " Calibrate every probe and question to the candidate's level: freshers are asked about "
        "college projects and internships, never about leading teams."
    )


# ================================================================ playbooks

PLAYBOOK_SYSTEM = PLATFORM + (
    " You write the interviewer's playbook for ONE question: how to ask it, what to clarify, a hint ladder, and a rule "
    "for every situation. The live interviewer classifies each moment into a condition and follows your rule, so rules "
    "must be concrete and in the persona's voice. Hints never give away the answer outright."
)


def playbook_prompt(view: dict, conditions: list[str], actions: list[str]) -> str:
    from app.blueprint.vocabulary import CONDITION_MEANINGS, PINNED_ACTIONS

    company = (view.get("round") or {}).get("company") or "the company"
    meanings = "\n".join(f"- {c}: {CONDITION_MEANINGS.get(c, c)}"
                         + (f" (action: {PINNED_ACTIONS[c]})" if c in PINNED_ACTIONS else "") for c in conditions)
    return (
        f"Context:\n{_j(view)[:10000]}\n\n"
        "Return exactly:\n{\n"
        '  "ask": {"opening": "<how the persona poses this question, natural and spoken>", "clarifications": [{"question": "<a question the candidate may ask>", "answer": "<what the interviewer answers>"}, ...]},\n'
        '  "hint_ladder": [{"step": 1, "hint": "<gentle>"}, {"step": 2, "hint": "<more explicit>"}, {"step": 3, "hint": "<almost the approach>"}],\n'
        '  "branches": [{"condition": "<one of the conditions>", "action": "<one of the actions>", "say": "<what the persona says>", "notes": "<when/how>"}, ...],\n'
        '  "probes": ["<deeper question once the main answer is in>", "..."],\n'
        '  "follow_ups": ["<harder variant or constraint change>", "..."],\n'
        '  "expectations": {"must_show": ["..."], "strong_signals": ["..."], "weak_signals": ["..."]},\n'
        '  "evaluation_signals": [{"signal": "<e.g. clarifies before coding>", "observe": "<what to watch for>"}, ...]\n'
        "}\n"
        f"Conditions (write AT LEAST ONE branch for EVERY one; the live interviewer detects these moments):\n{meanings}\n"
        f"Actions (use only these): {', '.join(actions)}\n"
        "Rules:\n"
        f"- This is a mock interview for {company}. Never name another company or another company's principles or "
        f"values. If the question or its notes were written for another company, adapt them to {company} or keep "
        "them company-neutral.\n"
        "- Use only facts in `candidate`. Never assume an employer, project, domain or role the candidate doesn't have; "
        "with little candidate data, ask open questions (\"a project you worked on\").\n"
        "- Calibrate to the level: interns and freshers talk about college projects, internships, hackathons and "
        "teams, never about leading teams, products or budgets. Expectations match the level too.\n"
        "- In a coding or design question every branch, probe and signal is about the problem itself; culture and "
        "behavioural questions belong to behavioural questions only.\n"
        "- A behavioural question asks for the candidate's OWN past example: never describe a hypothetical scenario "
        "for them to answer, and clarifications only say what kind of example fits (a college project counts); they "
        "never supply facts about the candidate's past.\n"
        "- Every line must work spoken as written: no placeholders such as X, Y, [project], <name> or '...'; refer back "
        "with words like \"what you said earlier\" instead.\n"
        "- Vary how questions open: \"Hey,\" suits a casual coding round at most once; use a natural transition from "
        "the previous question instead (\"Thanks. Moving on, ...\"). A conversation with a hiring manager stays "
        "professional and warm.\n"
        "- Never address the candidate by a name (you are not given one): say \"thanks for sharing\", not \"thanks, Imran\".\n"
        "- Keep probes to the 3-5 that dig deepest and follow_ups to 2-4.\n"
        "- Hints and lines stay language-neutral: the candidate codes in a language of their choice, so never assume "
        "Python (or any language's operators) unless they named it.\n"
        "- clarifications[].answer is what the interviewer says to the candidate (\"You can assume ...\"), never in the "
        "candidate's voice (never \"I'd like to know...for someone with my background\"; the candidate asks, you answer).\n"
        "- For a behavioural question, probes dig three to five levels into the candidate's own example: the decision they "
        "made and its alternatives, the numbers, what went wrong, what they would change. Depth beats more questions.\n"
        "- `say` is what the persona says aloud, in the first person, with no name prefix. For asks_clarification, "
        "`say` starts the answer and `notes` says to answer from the clarifications; for asks_for_answer, decline "
        "and offer the next hint; for off_topic, acknowledge briefly and redirect; for seen_before, thank them and "
        "move to a different question."
    )
