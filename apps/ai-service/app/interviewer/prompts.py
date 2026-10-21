"""Prompts for the live interviewer (spec §5). PRODUCT IP DRAFTS for human review before production
(spec §12): the talker's voice and rules, the per-turn state, the director's job. Plain functions of
the blueprint and the run's state, so prompt assembly is unit-tested."""
from __future__ import annotations

import base64
import json
from typing import Any

from app.interviewer.brief import BRIEF_SCHEMA
from app.interviewer.closing import strip_durations
from app.interviewer.conductor import SET_ASIDE_ORDERS
from app.interviewer.guard import name_words
from app.interviewer.lines import habits_of, realism_of
from app.interviewer.predicates import board_shapes, board_typed_text
from app.blueprint.vocabulary import is_culture_slot
from app.rounds.compose import compose_director, compose_talker, pack_for, rules_of
from app.interviewer.plan import (bridge_for, deep_dive_extras, deep_dive_probes, deep_dive_questions, icebreaker, intro_probes, opening_hint,
                                  outline_parts, outline_requirement, outline_sentence, phase_style, problem_intro, problem_put_up, promise_questions,
                                  promise_words, promises_of, realism_outline, slot_by_id)

DSA_PACK = pack_for("dsa")

# Live overrides of the blueprint's pol1 request policies (spec §5.7, "live-pol1"): they live in the DSA round pack now.
LIVE_POLICY_OVERRIDES: dict[str, str] = DSA_PACK.live_policy_overrides

# The conduct check (user decision, 2026-10-18): a screened candidate turn is judged by a small JSON call before the reply is made.
CONDUCT_CHECK_PROMPT = """You judge one candidate remark in a live mock job interview. Reply with JSON {"verdict": "abuse" | "rude" | "none", "reason": short text}.
- "abuse": an insult, swearing or contempt aimed at the interviewer or at the interview itself, including telling the interviewer to shut up, go away or leave them alone.
- "rude": rude or frustrated words not aimed at the interviewer: about the problem, the round, or themselves.
- "none": no conduct issue (swearing at their own mistake, a normal sentence).
Judge the words in the light of the interviewer's previous line. Examples:
"Can you shut up for a second, I'm thinking?" -> abuse
"you clearly don't know what you're doing" -> abuse
"your questions are trash" -> abuse
"this question is stupid" -> rude
"this is such a pointless problem" -> rude
"fuck, I made a mistake" -> none
"I'm such an idiot, I forgot the base case" -> none
"what the fuck is a monotonic stack?" -> rude
"kya bakwas question hai yaar" -> rude (about the question, not the interviewer)
"stop talking and let me think" -> abuse
"damn, this is harder than I thought" -> none
"haha, that's a joke, right? the input can't be empty?" -> none (a clarifying question)
"my code is garbage right now, let me clean it up" -> none"""

# The outline ends with one check, asked once per round (user decision, 2026-10-18; it reverses "no question at the end of the framing").
CHECK_ONCE = ('End with one short check, "Does that sound okay?" (or "Shall we get started?"), and ask nothing else in this turn: no introduction question, '
              "and do not call next_item. Never ask that check again in the round.")

PROACTIVE_NOTE = "(No new speech from the candidate. Act on the conductor's orders; if there are none, continue naturally.)"

# The sentences of the style examples in TALKER_RULES (the rule's own pattern line and each Bad/Good pair): the run treats a spoken sentence
# close to one of them as a repeat, so the model never says a prompt example back (b1 strong_fresher did, twice).
STYLE_EXAMPLES = (
    "The renewal rule, what did it check?",
    "That's a solid, well-thought-out way to organise the loans.", "What was one rule that went wrong?",
    "And did that hold up when members renewed books late?",
    "Good, an overdue table with a fines table for the late returns, and the catalogue kept aside.",
    "Mm, that happens a lot with renewals.", "How did you spot it?",
    "That's correct, and the barcode point is a nice touch.",
    "And how does that behave when the shelf is full?",
)

# The interviewer rules are composed from the shared base and the round pack (app/rounds); these are the DSA round at the middle band, which
# the older callers and tests read.
TALKER_RULES = compose_talker(DSA_PACK, "mid")

DIRECTOR_RULES = compose_director(DSA_PACK, "mid")


_GO_AHEAD_EXAMPLE = 'answer the offer ("Sure, go ahead.")'
_ACK_RULE = '("Okay.", "Mm, okay.", "Got it.", "Alright.", "Sure.")'
_LINK_EXAMPLES = DSA_PACK.link_examples            # the links between parts moved to the DSA pack
_LINK_INTENT = DSA_PACK.link_intent


def _neutral_acks(habits: dict[str, Any]) -> list[str]:
    from app.interviewer.talker import opens_with_verdict      # imported late: the talker module imports the conductor, as this one does
    return [str(a) for a in habits["acks"] if not opens_with_verdict(str(a))]


def talker_rules(blueprint: dict[str, Any]) -> str:
    """The talker's rules. With a realism block the rules that prescribe one example sentence (the acknowledgements, the Good examples' "Okay.",
    the links between parts) name the persona's own habits or only the intent, so every interviewer does not copy the same words (decided 2026-10-18).
    A blueprint without one gets today's text."""
    block = rules_of(blueprint)
    base = block["talker"]                                # the round pack's rules, composed at prep (a legacy blueprint: composed on the fly)
    habits = habits_of(blueprint)
    if habits is None:
        return base
    acks = _neutral_acks(habits) or ["Okay."]            # a verdict ("Right.", "Nice.") is never offered as a neutral acknowledgement or a Good example
    rules = base.replace(_ACK_RULE, "(yours: " + ", ".join(f'"{a}"' for a in acks[:6]) + ")")
    for n, old in enumerate(('Good: "Okay. And did that hold up', 'Good: "Okay. And how does that behave')):
        rules = rules.replace(old, f'Good: "{acks[n % len(acks)]} ' + old.split('Okay. ', 1)[1])
    if block.get("link_examples"):
        rules = rules.replace(block["link_examples"], block.get("link_intent") or _LINK_INTENT)      # a target a pack does not carry is a no-op
    return rules.replace(_GO_AHEAD_EXAMPLE, "answer the offer in a few words of your own")


def how_you_talk(blueprint: dict[str, Any]) -> str:
    """The persona's own speech habits (acknowledgements and nods) and traits, from the blueprint's realism block; "" when it has none."""
    habits, realism = habits_of(blueprint), realism_of(blueprint)
    if habits is None or realism is None:
        return ""
    traits = ", ".join(f"{axis} {level}" for axis, level in (realism.get("traits") or {}).items() if axis != "register")      # the register shows in the phrases, never as a label
    lines = ["How you talk (this is your own manner; never name it aloud)"]
    if traits:
        lines.append(f"- Your traits: {traits}. Let them show in how much you say, how warm you are and how formal your words are.")
    neutral = _neutral_acks(habits)
    verdicts = [str(a) for a in habits["acks"] if str(a) not in neutral]
    lines.append("- Your usual acknowledgements: " + ", ".join(f'"{a}"' for a in neutral or ["Okay."])
                 + ". Draw a different one each time; never open a reply with the words the last reply opened with, and never the same opening more "
                   "than twice in five replies.")
    if verdicts:
        lines.append("- " + ", ".join(f'"{a}"' for a in verdicts) + " also sound like you, but they judge what they said: only when it matters, once, "
                     "and never in two replies in a row.")
    lead_ins = [str(x) for x in habits.get("lead_ins") or []]
    if lead_ins:
        lines.append("- Ways you sometimes begin a turn before your question: " + ", ".join(f'"{x}"' for x in lead_ins)
                     + ". Now and then, not every reply; never the same one twice in a row, and never one that would be the third use of an opening in five replies.")
    backchannels = [str(b) for b in habits.get("backchannels") or []]
    if backchannels:
        lines.append("- Your short nods while they think: " + ", ".join(f'"{b}"' for b in backchannels) + ".")
    return "\n".join(lines)


def talker_prefix(blueprint: dict[str, Any], context: dict[str, Any]) -> str:
    persona = blueprint.get("persona") or {}
    rnd = context.get("round") or {}
    requests = (blueprint.get("policies") or {}).get("requests") or []
    rules = rules_of(blueprint)
    live_policies = rules.get("live_policies") or {}
    policies = [f"- {p['kind']}: {live_policies.get(p['kind'], p['how'])}" for p in requests]
    words, flags = rules.get("words") or {}, rules.get("flags") or {}
    noun = ("coding " if flags.get("requires_code") else "") + str(words.get("problem") or "problem")
    second = ("second " + noun) + (" (only if the first goes well)" if flags.get("gate_second") else "")
    outline: list[str] = []
    for phase in blueprint.get("arc", []):
        if phase["phase"] == "core":
            core = sorted((s for s in blueprint.get("slots", []) if s.get("kind") == "core"), key=lambda s: s.get("order", 0))
            seen_main = False
            for s in core:
                if is_culture_slot(s["slot_id"]):
                    label = "a behavioural question"
                elif not seen_main:
                    label, seen_main = noun, True
                else:
                    label = second
                outline.append(f"- {s['slot_id']}: {label} ({s['timebox_mins']} min)")
            if int((blueprint.get("round") or {}).get("deep_dive_mins") or 0) > 0:
                outline.append(f"- deep_dive: questions about their projects and the round's fundamentals ({blueprint['round']['deep_dive_mins']} min)")
        else:
            outline.append(f"- {phase['phase']} ({phase['timebox_mins']} min)")
    reserves = [s["slot_id"] for s in blueprint.get("slots", []) if s.get("kind") == "reserve"]
    candidate = context.get("first_name") or "the candidate"
    company = rnd.get("company_name") or rnd.get("company") or "the company"
    return "\n\n".join(part for part in [
        f"You are {persona.get('name', 'the interviewer')}, {persona.get('seniority', 'an engineer')}, interviewing "
        f"{candidate} for a {rnd.get('role', 'software')} role ({rnd.get('level', '')}) at {company}. This is a live "
        "voice mock interview: everything you write is spoken aloud.",
        f"Your manner: {persona.get('style', '')}. {persona.get('disposition', '')}",
        talker_rules(blueprint),
        how_you_talk(blueprint),
        "Request policies\n" + "\n".join(policies),
        "The plan (follow it, but adapt to the candidate)\n" + "\n".join(outline)
        + (f"\nReserve problems: {', '.join(reserves)}" if reserves else ""),
        f"What this level should show: {(blueprint.get('personalization') or {}).get('level_expectations', '')}",
        _resume_section(context.get("profile") or {}),
    ] if part)


def _resume_section(profile: dict[str, Any]) -> str:
    """What the interviewer read on the candidate's resume. Without it, asked "what's the first project on my resume?", a live
    interviewer said "I don't have your resume in front of me": only the director had the profile."""
    headline = (profile.get("headline") or "").strip()
    projects = [str(p).strip() for p in (profile.get("projects") or []) if str(p).strip()][:6]
    skills = [str(s).strip() for s in (profile.get("skills") or []) if str(s).strip()][:12]
    if not (headline or projects or skills):
        return ""
    lines = ["Your read of their resume (you have read it before the round):"]
    if headline:
        lines.append(f"- Headline: {headline}")
    if projects:
        lines.append(f"- Projects, in the order listed: {', '.join(projects)}")
    if skills:
        lines.append(f"- Skills: {', '.join(skills)}")
    lines.append("If they ask what is on their resume, answer from this. Never say you do not have their resume or cannot see it.")
    return "\n".join(lines)


def _arc_next(blueprint: dict[str, Any], phase: str) -> str | None:
    """What follows a phase in the arc's own order ("problem" for the core): the fallback when the run does not say what is next."""
    names = [p["phase"] for p in blueprint.get("arc", [])]
    if phase not in names or names.index(phase) + 1 >= len(names):
        return None
    after = names[names.index(phase) + 1]
    return "problem" if after == "core" else after


def _two_problems(blueprint: dict[str, Any]) -> str:
    """The outline's "one or two coding problems", with the dependence on the first only in a round that gates its second problem."""
    return "one or two coding problems" + (", depending on how the first goes" if (rules_of(blueprint).get("flags") or {}).get("gate_second", True) else "")


def _phase_details(blueprint: dict[str, Any], phase: str, style: str | None = None, nxt: str | None = None,
                   outline_said: bool = False, focus: str | None = "", after: str | None = None) -> list[str]:
    """`style` and `nxt` (the part that really comes next: "problem", a phase name, "resume" or None) come from the live run; without
    them they are the arc's own. Every link to the coding or request for an introduction is said only when that is what comes next."""
    style = phase_style(blueprint, phase) if style is None else style
    if nxt is None:
        nxt = _arc_next(blueprint, phase)
        if style == "after_coding" and nxt == "problem":
            nxt = None                                   # an after-the-coding part is never followed by the coding
    persona = blueprint.get("persona") or {}
    personal = blueprint.get("personalization") or {}
    # The blueprint's greeting and small-talk guidance all says "how's your day going?" (some add the weather): the live
    # interviewer runs that chat itself (see plan.ICEBREAKERS), so it is left out.
    guidance = "" if phase in ("greeting", "small_talk") else \
        strip_durations(next((p.get("guidance", "") for p in blueprint.get("arc", []) if p["phase"] == phase), ""))      # never a length of time (decided 2026-10-18)
    if phase == "framing" and outline_said:
        # The outline went out in an earlier turn, ending with the check (the plan stayed on this part): their reply is the answer to it.
        if nxt == "candidate_intro":
            go_on = (f"Start with a short transition (for example \"Great \u2014 let's start with you.\"), then {opening_hint(blueprint, 'candidate_intro', phase_style(blueprint, 'candidate_intro'))} "
                     "If they asked a question about the format, answer it first, then the transition and the question. If their reply already starts the "
                     "introduction (they are telling you about themselves), take it as the answer: do not ask the introduction question again, react to it "
                     "and follow up on what they said, and call next_item in the same reply.")
        else:
            go_on = "If they asked a question about the format, answer it first. React briefly to what they just said and call next_item to go on."
        return ["Phase: framing.", "You already told them how the round will run and asked whether that sounds okay: do not repeat it, and never ask whether "
                f"the format sounds okay again (whatever they replied is the answer). Go straight on to the next part: {go_on}"]
    lines = [f"Phase: {phase}. {guidance}".strip()]
    done = "call next_item and move on in the same reply (only when the live state says you may)."
    # The reply to "can you hear me?" is speech-to-text of a line that may be bad: "Oh," is not a yes (a live round answered it
    # with "we're hearing each other fine").
    audio = ("If their answer to whether they can hear you was cut off, unclear or not a clear yes (\"Oh,\", \"Hel-\", a stray word), "
             "never say you are hearing each other fine: ask once more, briefly, whether they can hear you.")
    if phase == "greeting":
        first, _ = icebreaker(blueprint)
        lines.append(f"Say hello using their first name, give your own first name, then one short question: {first}. Say it in your own words, "
                     "in one or two spoken sentences: never a stock line like \"How are you doing today?\" every time. Say nothing about "
                     f"your own day, where you are or the weather (you have no day to report). {audio} Then {done}")
    elif phase == "small_talk":
        _, second = icebreaker(blueprint)
        lines.append(audio)
        lines.append("This is the chat before the round, kept short and real. First react to what they actually said, with something specific to "
                     "their words (never a stock \"Glad to hear it\" or \"Lovely\"), in a few words. Then one short question: "
                     f"{second}. Keep the chat about the call itself (hearing each other, getting settled, being ready): nothing personal, "
                     "not their day, week, weekend, hobbies, family, food or where they live. Never ask how they are again, and never ask two "
                     "chat questions in a row on the same thing. "
                     "If they gave a flat one-word answer, don't dig: react in a few words and go straight on. If they sound keen to start, "
                     "skip the question. You have no day, commute or weather of your own to talk about: never invent any. "
                     + ("" if style == "rapport" else
                        "Do not mention their projects, resume or background yet, and do not describe the round: how it will run comes next, "
                        "and their work comes after that. ")
                     + f"When it is done, {done}")
        if style == "rapport" and (hook := next((h.get("line") for h in personal.get("rapport_hooks") or [] if h.get("line")), None)):
            lines.append(f'After the chat about the call, ask one light question about their work, starting from this: "{hook}".')
    elif phase == "framing" and style == "one_line":
        lines.append(f"Start with a short link from the chat (for example \"{bridge_for('framing', 'one_line', blueprint)}\"). "
                     f"{opening_hint(blueprint, 'framing', 'one_line')} Name the parts and their areas only, never a specific question or problem. Nothing else about the format.")
        if nxt == "candidate_intro":
            intro_style = phase_style(blueprint, "candidate_intro")
            lines.append(f"{CHECK_ONCE} Their reply comes next: the introduction is asked for then, with a connecting phrase "
                         f"(for example \"{bridge_for('candidate_intro', intro_style, blueprint)}\").")
        else:
            lines.append(f"{CHECK_ONCE} Do not ask about them yet.")
    elif phase == "framing" and realism_outline(blueprint) is not None:
        # The outline as content (decided 2026-10-18): the interviewer says it in its own voice; the guard checks the areas it names.
        parts = "; ".join(outline_parts(blueprint)).replace("one or two coding problems", _two_problems(blueprint))
        lines.append(f"Start with a short link from the chat (for example \"{bridge_for('framing', phase_style(blueprint, 'framing'), blueprint)}\"). Say how the round will run "
                     f"in your own words, covering each of these parts in this order (they are the content, not a sentence to read out): {parts}. "
                     f"{outline_requirement(blueprint)} Name every part, and no part the round does not have. Name the parts and their areas only, never a specific question or problem. Say that they should "
                     "think aloud and ask anything. Say nothing about their projects, resume or background before this.")
        lines.append(f"{CHECK_ONCE} The next part starts after their reply"
                     + (" (their introduction: their background and one project they would like to talk about)." if nxt == "candidate_intro" else "."))
    elif phase == "framing":
        lines.append(f"Start with a short link from the chat (for example \"{bridge_for('framing', phase_style(blueprint, 'framing'), blueprint)}\"). Say how the round will run, in the order the "
                     "outline above gives it: " + outline_sentence(blueprint).replace("one or two coding problems", _two_problems(blueprint)) +
                     ". Name every part, and no part the round does not have. Name the parts and their areas only, never a specific question or problem. Say that they should think aloud and ask anything. "
                     "Say nothing about their projects, resume or background before this.")
        lines.append(f"{CHECK_ONCE} The next part starts after their reply"
                     + (" (their introduction: their background and one project they would like to talk about)." if nxt == "candidate_intro" else "."))
    elif phase == "candidate_intro":
        styled = opening_hint(blueprint, "candidate_intro", style) if style else None
        lines.append(f"{styled} Then follow up on what they say. " if styled else "Ask about their background, then follow up on what they say. ")
        lines[-1] += ("Use the resume probes below one at a time, each with a natural follow-up. This is a conversation, not a form: "
                      "react to their answers.")
        lines += [f"Resume probe: {p['prompt']}" for p in intro_probes(personal)]
        lines += [f"Remark you may make once, only if it is about what they have just talked about (never as your first words, and never "
                  f"in a turn that asks about something else): {h['line']}"
                  for h in personal.get("rapport_hooks", [])]
        if nxt != "problem":
            lines.append(f"When the live state says you may move on, {done}")       # the coding is not next: nothing to link to
        else:
            lines.append(f"When the live state says you may move on, {done} Link to {(rules_of(blueprint).get('words') or {}).get('the_part') or 'the coding'} with a short connecting phrase first "
                         f"(for example \"{bridge_for('problem', phase_style(blueprint, 'problem'), blueprint)}\").")
    elif phase == "deep_dive" and promises_of(blueprint):
        lines += _deep_dive_pool(blueprint, personal, focus, after)
        lines.append(f"When the live state says you may move on, {done}")
    elif phase == "deep_dive":
        lines.append("Ask about their projects and the round's other topics (fundamentals), one question at a time, each with a follow-up "
                     "that digs into a decision they made. Ask the listed questions in the order given: the projects first, then the fundamentals, "
                     "each area's questions together.")
        probes = {p["prompt"] for p in deep_dive_probes(personal)}
        for topic, q in deep_dive_questions(personal):
            if q["prompt"] in probes:
                lines.append(f"Resume probe: {q['prompt']}")
            elif topic is None:        # about them, not a fundamentals question: asked last, with its own lead-in
                lines.append(f'Round question (about them, ask it last and lead in with "One last one about you:"): {q["prompt"]}')
            else:
                lines.append(f"Round question{f' ({topic})' if topic else ''}: {q['prompt']}")
        lines.append("Anything about the candidate's work that came up earlier in the conversation is covered: go deeper into it or go to the next "
                     "listed question, never ask it again.")
        lines.append('When you go from one area to the next, bridge every change of area with a few words, and let the question itself name the area ("On databases now: how would '
                     'you index this table in SQL?"); never say "stay on" or "back to" an area you have not discussed.')
        lines.append("When every question listed here has been asked and answered, call next_item for their questions and open it in that same turn: "
                     "never invent more questions to fill the time.")
        lines.append(f"When the live state says you may move on, {done}")
    elif phase == "candidate_questions":
        known = [str(f) for f in persona.get("grounded_in") or [] if f]
        lines.append("Invite their questions. About the company, the team or what working there is like, say only what the notes below give, "
                     "in general terms and as what people who have interviewed or worked there report (\"people describe it as...\"), never as your "
                     "own inside knowledge. Anything the notes do not cover (processes, tools, team size, figures, reviews, politics, pay): say in "
                     "a few words that you can't speak to that, and suggest they ask the team directly in the real process. Never invent a "
                     "detail, and never confirm or deny what they read online. Questions about the interview itself or general engineering "
                     "practice you may answer normally.")
        lines.append("Notes on working there (from public interview reports): " + ("; ".join(known) if known else "none: say you can't speak to specifics."))
        lines.append(f"When they have no more questions, {done}")
    elif phase == "wrap_up":
        lines.append(f"Close with something like: {persona.get('closing', '')} That is the end of the interview: nothing after it.")
    return lines


def _deep_dive_pool(blueprint: dict[str, Any], personal: dict[str, Any], focus: str | None = "", after: str | None = None) -> list[str]:
    """The deep dive for a blueprint whose outline made promises (decided 2026-10-18): each promise has a pool of questions, not a script. The
    interviewer picks which to ask and in what order, follows up on the answer, may skip a question, and must ask about every promised area once."""
    promises = promises_of(blueprint)
    if focus is None:        # every promised area has had its questions
        return ["You told them you would cover: " + ", ".join(promise_words(p) for p in promises) + ". Every promised area has been asked about: ask nothing "
                "more here, and when the live state says you may move on, go on to the next part."]
    if focus and focus in promises:
        # One area at a time, in outline order (decided 2026-10-18; live round 781a1f0a, turns 41-54: the questions went Relay, React, Relay, React).
        kind = focus.partition(":")[0]
        pool = promise_questions(personal, focus)
        lines = ["Ask about their projects and the round's fundamentals, one question at a time, each with a follow-up that digs into a decision they "
                 "made. You told them you would cover: " + ", ".join(promise_words(p) for p in promises) + ". You take them one at a time, in that order. "
                 f"Now on: {promise_words(focus)}. Ask only about it until it is done; "
                 + (f"{promise_words(after)} comes after." if after else "it is the last area.")
                 + " Follow up on what they say, and you may skip a question when their answer already covers it. You may not leave this part while a "
                 "promised area is unasked: only the round running out of time frees you, and then you say so in one short sentence.",
                 f"Promised: {promise_words(focus)}" + ("" if pool else " (no prepared question: ask about the project from their resume)")]
        lines += [f"  - {'Resume probe' if kind == 'projects' else 'Round question'}: {q['prompt']}" for q in pool]
        lines.append("Anything about the candidate's work that came up earlier in the conversation is covered: go deeper into it or go to the next "
                     "question, never ask it again. If they say they don't know an answer, that area is done: respond kindly and go on, "
                     "never ask it again.")
        lines.append('When the area changes, bridge it with a few words, and let the question itself name the area ("On databases now: how would you '
                     'index this table in SQL?"); never say "stay on" or "back to" an area you have not discussed.')
        lines.append("When every promised area has been asked about and answered and the live state says you may move on, call next_item for their questions "
                     "and open it in that same turn. Never ask a question that is not listed above, and never ask more to fill the time.")
        return lines
    lines = ["Ask about their projects and the round's fundamentals, one question at a time, each with a follow-up that digs into a decision they "
             "made. You told them you would cover: " + ", ".join(promise_words(p) for p in promises) + ". Below is a pool of questions for each, "
             "not a script: you choose which to ask next and in what order, follow up on what they say, and may skip a question when their answer "
             "already covers it. You MUST ask about every promised area at least once (the live state lists what is still unasked) and you may not "
             "leave this part while one is: only the round running out of time frees you, and then you say so in one short sentence."]
    for promise in promises:
        kind, _, name = promise.partition(":")
        pool = promise_questions(personal, promise)
        lines.append(f"Promised: {promise_words(promise)}" + ("" if pool else " (no prepared question: ask about the project from their resume)"))
        for q in pool:
            lines.append(f"  - {'Resume probe' if kind == 'projects' else 'Round question'}: {q['prompt']}")
    extras = deep_dive_extras(personal, blueprint)
    if extras:
        lines.append("Optional extras (use one only while the live state still says you may NOT move on yet, to reach the part's exchanges, and only after "
                     "every promised area has been asked about):")
        for topic, q in extras:
            if topic is None:
                lines.append(f'  - (about them, ask it last and lead in with "One last one about you:") {q["prompt"]}')
            else:
                lines.append(f"  - {q['prompt']}")
    lines.append("Anything about the candidate's work that came up earlier in the conversation is covered: go deeper into it or go to the next "
                 "question, never ask it again. If they say they don't know an answer, that area is still covered: respond kindly and go on, "
                 "never ask it again.")
    lines.append('When you go from one area to the next, bridge every change of area with a few words, and let the question itself name the area ("On databases now: how would '
                 'you index this table in SQL?"); never say "stay on" or "back to" an area you have not discussed.')
    lines.append("When every promised area has been asked about and answered and the live state says you may move on, call next_item for their questions "
                 "and open it in that same turn. Never ask a question that is not listed above, and never ask more to fill the time.")
    return lines


def item_details(blueprint: dict[str, Any], item: dict[str, Any]) -> str:
    if item["kind"] == "phase":
        return "\n".join(_phase_details(blueprint, item["phase"], item.get("style"), item.get("next_phase"), bool(item.get("outline_said")),
                                            item.get("focus", ""), item.get("focus_next")))
    if item["kind"] == "thread":
        return (f"A thread you opened: {item.get('title', '')}. Why: {item.get('why', '')}. "
                "Keep it short, then close_thread (never say how long it will take).")
    if item["kind"] == "filler":
        f = item.get("filler") or {}
        return "\n".join(["A short question from the candidate's profile, between problems (keep it short).",
                          f"Ask, framed naturally: {f.get('question', '')}",
                          f"A sound answer covers: {f.get('sound_answer', '') or 'use your judgement'}"])
    slot = slot_by_id(blueprint, item.get("slot_id")) or {}
    key = (slot.get("answer_key") or {}).get("key") or {}
    step = int(item.get("hint_step") or 0)
    if item.get("aloud"):
        # A question asked aloud (a behavioural round's, or a culture slot's): nothing is ever put on the screen for it.
        opening = str((slot.get("ask") or {}).get("opening") or "").strip()
        if item.get("shown"):
            lines = [f"Question {item['item_id']}. You have already asked it: follow up on what they say. Nothing goes on their screen for it, so never "
                     "mention the screen."]
        else:
            link = bridge_for("problem", phase_style(blueprint, "problem"), blueprint, "behavioural" if item.get("culture") else None)
            lines = [f"Question {item['item_id']}. Start with a short connecting phrase that links to what came before (for example \"{link}\"), then ask "
                     f"it aloud in your own words{f' (starting from: {opening})' if opening else ''}. Ask only that one question, then stop. Nothing goes on "
                     "their screen for it: never call show_problem and never mention the screen."]
    elif item.get("shown"):
        # On their screen already (a live round said "Let me put the second problem on your screen" minutes after it was up, because this
        # block still told it how to put the problem up).
        lines = [f"Problem {item['item_id']}. It is ALREADY on their screen: never call show_problem for it, never say its put-up line, its intro line "
                 "or \"give it a read\", and never say it is up. Never read, summarise or restate the problem: they have it in front of them, and "
                 "never tell them to read it again or to ask if anything is unclear.",
                 "Constraints and the input/output format exist; reveal them only when asked."]
    else:
        lines = [f"Problem {item['item_id']}. Start with a short connecting phrase that links to what came before (for example "
                 f"\"{bridge_for('problem', phase_style(blueprint, 'problem'), blueprint)}\"), call show_problem, then say only this and stop: \"{item.get('put_up') or problem_put_up(int(item.get('problem_number') or 1), pack_id=rules_of(blueprint).get('pack') or 'dsa')}\" "
                 "The line that invites them to read it is said for you after the screen changes: never say it yourself. Never read, summarise or "
                 "restate the problem: they have it in front of them. Once it is on their screen, never tell "
                 "them to read it again or to ask if anything is unclear.",
                 "Constraints and the input/output format exist; reveal them only when asked."]
    avoid = sorted(name_words(slot))
    if avoid:
        lines.append(f"Never use these words while this problem is up: {', '.join(avoid)} (they would name the original problem; "
                     "describe the idea in other words, e.g. \"a way\" or \"a set of values\").")
    lines += [f"Clarification: {c['question']} → {c['answer']}" for c in (slot.get("ask") or {}).get("clarifications", [])]
    if item.get("codes", True):
        lines.append("Never say their idea back to them more completely than they said it: add no missing word, formula or step. Say \"okay\" or ask "
                     "them to try it on an example. Say that something is correct once.")
    else:
        lines.append("Never say their idea back to them more completely than they said it: add no missing word, formula or step. Never say a choice "
                     "is right or wrong.")
    if not item.get("hide_ladder"):
        lines.append("Hint ladder (give the next step only):")
        lines += [f"  {h['step']}. {'(given) ' if h['step'] <= step else ''}{h['hint']}" for h in slot.get("hint_ladder", [])]
    lines.append("Playbook (condition → action: what to say):")
    lines += [f"  {b['condition']} → {b['action']}: {b['say']}" for b in slot.get("branches", [])]
    lines += [f"Probe: {p}" for p in slot.get("probes", [])]
    lines += [f"Follow-up: {f}" for f in slot.get("follow_ups", [])]
    lines.append("A good answer must show: " + "; ".join((slot.get("expectations") or {}).get("must_show", [])))
    lines.append("Answer key (for judging only; never reveal):")
    lines += [f"  Approach {a['name']}: {a['idea']} ({a['time_complexity']} time, {a['space_complexity']} space)" for a in key.get("approaches", [])]
    if item.get("codes", True):
        lines.append("  When you ask them to test or trace: choose the input from the edge cases and wrong paths above, the one their code is most likely to fail.")
    if key.get("complexity_target"):
        lines.append(f"  Target: {key['complexity_target']}")
    lines += [f"  Insight: {i}" for i in key.get("key_insights", [])]
    lines += [f"  Wrong path: {w['path']} → nudge: {w['nudge']}" for w in key.get("common_wrong_paths", [])]
    lines += [f"  Edge case: {e}" for e in key.get("edge_cases", [])]
    return "\n".join(lines)


# Said when the previous spoken turn opened with a verdict: rehearsals opened 37-48% of turns that way (2026-10-17).
NO_VERDICT_NOTE = "No verdict or praise in this reply: at most a short neutral acknowledgement."


def state_block(view: dict[str, Any]) -> str:
    item = view["item"]
    words = view.get("words") or {}
    problem, noun, part = str(words.get("problem") or "problem"), str(view.get("noun") or "coding problem"), str(view.get("part") or "the coding part")
    lines = ["## Live state",
             f"Round time: {view['round_elapsed_min']} min used of ~{view['round_min']}, {max(0, int(view['round_min']) - int(view['round_elapsed_min']))} min left. Current item: {item['item_id']} "
             f"({item['kind']}), {item['elapsed_min']} of ~{item['max_min']} min, hint step {item['hint_step']}."]
    if isinstance(view.get("item_rules"), str) and view["item_rules"].strip():
        lines += ["## This question", view["item_rules"]]
    if view.get("goals") is not None:
        lines.append("## Goals")
        lines += [f"- {g['id']} ({g['kind']}{', must' if g['must'] else ''}{', paused' if g['paused'] else ''}): {g['about']}"
                  for g in view["goals"]]
        lines.append(f"Free minutes: {view.get('free_min', 0)}.")
    if view.get("thread"):
        lines.append(f"You are on a thread you opened: {view['thread']['title']} ({view['thread']['why']}). "
                     "Close it with close_thread when it has done its job.")
    screen = view.get("on_screen")
    if screen is not None:
        if screen.get("problem_shown"):
            extra = f" Sections on it: {', '.join(screen['sections'])}." if screen.get("sections") else ""
            if "constraints" in (screen.get("sections") or []):
                extra += " Their constraints are on it: never say the numbers aloud, and never offer to give or read them out."
            lines.append("The problem is already on the candidate's screen: don't show it again, and don't repeat sections already there." + extra)
        elif item.get("kind") == "slot" and not item.get("aloud"):
            lines.append("This problem has not been shown yet: call show_problem before you say it is on their screen.")
    if item.get("kind") == "phase" and screen is None:
        lines.append("Nothing is on their screen in this part: ask everything aloud (including a SQL or design question) and never refer to the screen.")
    promises = view.get("promises")
    if promises and item.get("phase") == "deep_dive":
        if promises.get("focus"):
            # One area at a time (live round 781a1f0a, turns 41-54): only the area the deep dive is on is named, and the one after it.
            lines.append(f"Now on: {promises['focus']}. Ask only about it until it is done"
                         + (f"; {promises['next']} comes after." if promises.get("next") else "; it is the last area.")
                         + (f" Already asked about, never ask again: {', '.join(promises['covered'])}." if promises["covered"] else ""))
        else:
            lines.append("Promised to the candidate and not yet counted as asked (ask one question whose own words name the area, different from any already asked): " + (", ".join(promises["open"]) if promises["open"] else "nothing (every promise is kept)")
                         + (f". Already asked about, never ask again: {', '.join(promises['covered'])}." if promises["covered"] else "."))
    advance = view.get("advance")
    if advance is not None:
        lines.append("You may move on now (call go_to (or next_item) when this part is finished)." if advance["ok"]
                     else f"You may NOT move on yet: {advance['why']}.")
    nxt = view.get("next_part")
    if nxt is not None:
        if nxt.get("resume"):
            lines.append(f"When this thread is done, {nxt['hint']}")
        elif nxt["phase"] == "problem":
            lines.append(f"The part after this one is the {noun}." + (f" When you move on: {nxt['hint']}" if nxt.get("hint") else ""))
        else:
            # While a problem is current the part is named and nothing more: its opening wording ("That wraps up the coding part...")
            # was said on a problem nobody had discussed (b2 quiet_thinker). The order that moves into the part carries the words.
            wording = nxt.get("hint") if item.get("kind") != "slot" else None
            lines.append(f"The part after this one is {nxt['phase']}, not the {noun}: do not mention or show a {problem} yet."
                         + (f" When you move on, open it in that same turn: {wording}" if wording else ""))
    if view.get("next_after_give_up"):
        lines.append(f"They have given up on this {problem} and the round has time for another: the next {problem} follows now, as the conductor's "
                     f"order says. Do not say {part} is done.")
    elif view.get("skip_next_problem"):
        lines.append(f"The candidate struggled on this {problem} (or there is not enough time for another): you will NOT give another {problem}. Wrap "
                     f"{part.removesuffix(' part')} up kindly, then move to the next part. Only if they did well, add one plain sentence saying so.")
    elif (view.get("next_part") or {}).get("phase") == "problem" and item.get("kind") == "slot":
        lines.append(f"Another {problem} follows this one{' if it goes well' if view.get('gated', True) else ''}: when you finish with this one say so and give it.")
    if view.get("extra_problem"):
        lines.append("Another problem follows this one (there is time): when this one is finished, say you have another for them, call "
                     "next_item and then show_problem in the same turn.")
    if view.get("problem_left") is False:
        lines.append(f"No {noun} is left in this interview: do not promise or look for another one.")
    warnings = view.get("warnings") or {}
    if warnings.get("summary"):
        lines.append(f"Warnings given so far: {warnings['summary']}. They were said in fixed words, alone: never repeat one, add another of your own or "
                     "contradict one."
                     + (f" Your previous turn was a warning: pick up from it in a few words (\"Okay. So, back to the {problem}.\"), never ignore it."
                        if warnings.get("after_warning") else ""))
    if warnings.get("just_said"):
        lines.append("A warning was just said in this very turn, before your words: never say it again or mention the screen, the tab or leaving it.")
    if view.get("orders"):
        lines.append("Conductor orders (follow these now):")
        lines += [f"- [{o['kind']}] {o['text']}" + (" (may be set aside)" if o["kind"] in SET_ASIDE_ORDERS else "")
                  for o in view["orders"]]
    if view.get("no_verdict"):
        lines.append(NO_VERDICT_NOTE)
    if view.get("refused"):
        lines.append("Actions that did not happen last turn (the plan or the candidate's screen refused them; retry, or say so plainly):")
        lines += [f"- {r['tool']}: {r['reason'] or 'refused'}" for r in view["refused"]]
    brief = view.get("brief")
    if brief:
        move = brief.get("next_move") or {}
        # A brief can lag behind the conversation: a live round followed one after the candidate had said "It's fine, I got it".
        dated = (" (written before their last turn: what they have just said comes first; if it settles or changes this, drop the brief)"
                 if (view.get("brief_age") or 0) >= 1 else "")
        lines.append(f"Director brief{dated}: goal: {brief.get('goal', '')}; next move: {move.get('action', '')} {move.get('detail', '')}".rstrip()
                     + (f"; tone: {brief['tone']}" if brief.get("tone") else ""))
    if view.get("follow_ups"):
        lines += [f"Follow-up to use: {f}" for f in view["follow_ups"]]
    if view.get("ask"):
        lines.append(f'The candidate is asking about this ({view["ask"]["surface"]}): "{view["ask"]["quote"]}"')
    if view.get("highlights"):
        lines.append("They highlighted on the problem: " + "; ".join(f'"{q}"' for q in view["highlights"])
                     + ' (you can see these: "the part I highlighted" means the last one)')
    code = view.get("code")
    if code and code.get("lines"):
        lines.append(f"## Candidate's code ({code['language']}, version {code['version']})")
        lines += [f"{n}| {line}" for n, line in enumerate(code["lines"], start=1)]
        lines.append("They have already written this: never ask them to implement or write it again. Read it and react to what is there.")
    if view.get("board"):
        # Typed text is rendered as plain quoted words, never as an element line: a live round read `text "test can you\nsee"` in its state and
        # still said three times that it could not read the board.
        typed, shapes = board_typed_text(view["board"]), board_shapes(view["board"])
        lines.append("## Whiteboard")
        lines += [f"Typed on the whiteboard: \u201c{t}\u201d" for t in typed]
        if shapes:
            lines.append("Drawn on the whiteboard: " + ", ".join(shapes))
    if view.get("activity"):
        lines.append(view["activity"])
    if view.get("summary"):
        lines += ["## Earlier in the interview", view["summary"]]
    return "\n".join(lines)


# Asked for after the candidate's words, where the model attends: the same request inside the long rules was ignored (0 moves in
# 121 rehearsal turns, log_turn on 1 in 12); here a replayed model logged its decision every time (2026-10-17).
# "Decide silently": asked to decide before replying, a rehearsal model said its reasoning aloud ("let me take it ... go with the
# plan"); the decision goes into the tool calls only.
PATH_NOTE = ("Always end with log_turn, even when you stay. A turn with no tool call at all still needs log_turn. "
             "Before you reply, decide the path from what the candidate just said. Decide silently: the decision goes only into "
             "your tool calls; never say it, the plan or your reasoning aloud. If they started on something worth hearing out that "
             "your current part does not cover, follow it and call open_thread (title, why). If they answered ahead or already "
             "covered a planned part, take what they gave you, do not ask it again, and call skip_goal or go_to. Otherwise stay on "
             "the current part.")


def talker_messages(prefix: str, state: str, history: list[dict[str, Any]], proactive: bool) -> list[dict[str, Any]]:
    """[prefix, *history, state, note] (decided 2026-10-18). A provider's prompt cache covers the longest identical start of the request. The prefix
    is the same all round and the history only grows (each turn appends the candidate's words and the interviewer's reply), while the state is
    new every turn: with the state before the history only the ~5k-token prefix was cached and the whole history was re-read every turn. The
    state stays a system message right after the candidate's words, ahead of the note, so it sits where the model attends. Nothing per-turn
    may go into `prefix` or `history`: a changed byte there ends the cached part."""
    messages: list[dict[str, Any]] = [{"role": "system", "content": prefix}, *history, {"role": "system", "content": state}]
    messages.append({"role": "user", "content": PROACTIVE_NOTE} if proactive else {"role": "system", "content": PATH_NOTE})
    return messages


def director_messages(blueprint: dict[str, Any], context: dict[str, Any], snapshot: dict[str, Any],
                      image: bytes | None) -> list[dict[str, Any]]:
    profile = context.get("profile") or {}
    slots = [{"slot_id": s["slot_id"], "kind": s["kind"], "timebox_mins": s.get("timebox_mins"),
              "hint_ladder": s.get("hint_ladder"), "expectations": s.get("expectations"),
              "evaluation_signals": s.get("evaluation_signals"), "answer_key": (s.get("answer_key") or {}).get("key")}
             for s in blueprint.get("slots", [])]
    payload = {
        "position": snapshot["position"], "round": context.get("round"),
        "candidate": {"first_name": context.get("first_name"), "skills": profile.get("skills", []), "projects": profile.get("projects", [])},
        "clock": snapshot.get("clock"), "plan": snapshot["items"], "current_item": snapshot["current"], "slots": slots,
        "global_signals": (blueprint.get("evaluation") or {}).get("global_signals", []),
        "transcript": snapshot["transcript"], "summary_so_far": snapshot["summary"], "code": snapshot["code"],
        "whiteboard": snapshot["board"], "proctor": snapshot["proctor"], "conduct": snapshot["conduct"], "warnings": snapshot.get("warnings"),
        "plan_changes_so_far": snapshot["plan_changes"], "last_brief": snapshot["last_brief"], "set_aside": snapshot.get("set_aside", []),
        "flow": snapshot.get("flow"), "focus": snapshot.get("focus"), "activity": snapshot.get("activity", []), "on_screen": snapshot.get("on_screen", {}),
    }
    rules = rules_of(blueprint)
    if rules.get("focus"):
        payload["focus_area"] = rules["focus"]
    user: list[dict[str, Any]] = [{"type": "text", "text": json.dumps(payload, ensure_ascii=False, default=str)}]
    if image:
        user.append({"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(image).decode()}})
    system = rules["director"] + "\n\nReply with JSON matching this schema (for_position is required):\n" + json.dumps(BRIEF_SCHEMA)
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]
