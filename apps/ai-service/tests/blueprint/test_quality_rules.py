"""Quality rules found by reading real blueprints: one company per interview, policy-pinned branch actions,
spoken lines without speaker prefixes, playbooks that see the candidate, a harder reserve that is harder,
and company-neutral answer keys."""
import asyncio

from app.blueprint import prompts as P
from app.blueprint import selection as S
from app.blueprint import stages as ST
from app.blueprint.context import build_context
from app.blueprint.models import PersonalizationOut, PersonaStageOut, PlaybookOut
from app.blueprint.selection import SlotPlan
from app.blueprint.vocabulary import CONDITION_MEANINGS, PINNED_ACTIONS, required_conditions
from app.rounds.compose import pack_for
from app.rounds.system_design import PACK as SYSTEM_DESIGN
from tests.blueprint.fixtures import FakeLLM, MemoryTrace, behavioural_doc, dsa_doc, playbook_reply, request

W = S.DEFAULT_WEIGHTS


class _Settings:
    blueprint_concurrency = 2
    blueprint_parallel = 2
    blueprint_quota_retries = 0
    blueprint_transient_retries = 0


PERSONA = PersonaStageOut.model_validate({
    "persona": {"name": "Rahul Banerjee", "seniority": "Senior Engineer", "style": "calm, asks why",
                "disposition": "patient and encouraging", "opening": "Hi, I'm Rahul. How's your day?",
                "closing": "Thanks for your time today!"},
    "phase_guidance": []})


def _bytedance_doc():
    doc = behavioural_doc("tih/good-fit", "self-introduction", companies=("bytedance",))
    doc["content"]["question"] = "Tell me why you are the best fit for the Software Engineer I role at ByteDance."
    return doc


def _ctx(company: str, round_type: str = "behavioural"):
    return build_context(request(round_type, session={"company": company},
                                 round={"type": round_type, "topics": [], "difficulty": None}))


def test_a_question_written_for_another_company_stays_with_that_company():
    doc = _bytedance_doc()
    assert S.written_for_another_company(doc, _ctx("Accenture"))
    assert not S.written_for_another_company(doc, _ctx("ByteDance"))
    lp = behavioural_doc("alp/disagree", "amazon-lp", companies=("amazon",))
    assert S.written_for_another_company(lp, _ctx("Accenture"))
    assert not S.written_for_another_company(lp, _ctx("Amazon"))
    assert not S.written_for_another_company(behavioural_doc("generic", "conflict-teamwork"), _ctx("Accenture"))
    # Culture words count as naming the company.
    google = behavioural_doc("tih/frustrates", "general-behavioural", companies=("google",))
    google["content"]["strong_answer_summary"] = "Shows Googleyness under pressure."
    assert S.written_for_another_company(google, _ctx("Accenture"))


def test_atlassian_and_microsoft_values_stay_with_their_company():
    atl = behavioural_doc("atl/bad-news", "atlassian-values", companies=("atlassian",))
    ms = behavioural_doc("msc/failed", "microsoft-culture", companies=("microsoft",))
    assert not S.written_for_another_company(atl, _ctx("Atlassian"))
    assert not S.written_for_another_company(ms, _ctx("Microsoft"))
    assert S.written_for_another_company(atl, _ctx("Microsoft")) and S.written_for_another_company(ms, _ctx("Atlassian"))


def test_atlassian_mixed_round_asks_atlassian_values():
    ctx = build_context(request(session={"company": "Atlassian"},
                                round={"type": "dsa", "name": "Coding + values", "duration_mins": 60,
                                       "topics": ["Arrays and strings", "Behavioural"], "problems": [],
                                       "difficulty": "medium", "format": "A coding problem plus behavioural questions."}))
    pool = [dsa_doc("arr-a", tags=("Array",), companies=("atlassian",)), dsa_doc("graph-a", tags=("Graph",), companies=("atlassian",)),
            dsa_doc("hard-dp", tags=("Dynamic Programming",), difficulty="hard", companies=("atlassian",))]
    for slug, principle in (("atl-a", "Play, as a team"), ("atl-b", "Be the change you seek"), ("atl-c", "Open company, no bullshit")):
        doc = behavioural_doc(slug, "atlassian-values", companies=("atlassian",))
        doc["content"]["principle"] = principle
        pool.append(doc)
    pool += [_lp("lp-a", "Ownership"), behavioural_doc("generic", "conflict-teamwork")]
    assert ctx.culture
    plans, _ = S.select(ctx, pool, W, "seed")
    culture = [p.pick for p in plans if p.slot_id.startswith("culture") and p.pick]
    assert culture and all(c.category == "atlassian-values" for c in culture)


def test_selection_drops_other_companies_questions_and_counts_them():
    ctx = _ctx("Accenture")
    pool = [behavioural_doc(f"{cat}-{i}", cat) for cat in ("self-introduction", "conflict-teamwork", "failure-learning",
                                                            "leadership-ownership", "general-behavioural") for i in range(2)]
    pool += [_bytedance_doc(), behavioural_doc("lp-1", "amazon-lp", companies=("amazon",))]
    plans, summary = S.select(ctx, pool, W, "seed")
    picked = {p.pick.slug for p in plans}
    assert "tih/good-fit" not in picked and "lp-1" not in picked
    assert summary["other_company"] == 2


def test_harder_reserve_steps_up_only_within_the_levels_range():
    pool = [dsa_doc("arr-a", tags=("Array",)), dsa_doc("graph-a", tags=("Graph",)), dsa_doc("dp-a", tags=("Dynamic Programming",)),
            dsa_doc("str-a", tags=("String",)), dsa_doc("hard-tree", tags=("Tree",), difficulty="hard")]
    # SDE-1 on an easy round: hard is inside the level's range, so the harder reserve steps up to it.
    ctx = build_context(request(session={"level": "sde1"}, round={"type": "dsa", "difficulty": "easy", "topics": []}))
    harder = next(p for p in S.select(ctx, pool, W, "seed")[0] if p.slot_id == "reserve-harder")
    assert harder.pick.slug == "hard-tree" and harder.relaxations == ["difficulty+1"]
    # A fresher never gets a hard problem as the extension: the "harder" rule gives way first.
    ctx = build_context(request(session={"level": "fresher"}, round={"type": "dsa", "difficulty": "medium", "topics": []}))
    harder = next(p for p in S.select(ctx, pool, W, "seed")[0] if p.slot_id == "reserve-harder")
    assert harder.pick.difficulty != "hard" and harder.relaxations == ["diversity"]


def test_intro_job_assuming_and_duplicate_questions_stay_out():
    ctx = build_context(request("hiring-manager", session={"company": "Accenture", "level": "fresher"},
                                round={"type": "hiring-manager", "topics": [], "difficulty": None}))
    def q(slug, title, cat="hr", rt="hiring-manager"):
        d = behavioural_doc(slug, cat)
        d["round_type"], d["title"] = rt, title
        return d
    assert S.unsuitable(q("a", "Tell me about yourself."), ctx)
    assert S.unsuitable(q("b", "Tell me about your yourself (the general icebreaker)."), ctx)
    assert S.unsuitable(q("c", "Why do you want to leave your current/last company?"), ctx)
    assert not S.unsuitable(q("d", "Where do you see yourself in 5 years?"), ctx)
    sde2 = build_context(request("hiring-manager", session={"level": "sde2"}, round={"type": "hiring-manager", "topics": [], "difficulty": None}))
    assert not S.unsuitable(q("c", "Why do you want to leave your current/last company?"), sde2)
    pool = [q("hm/fit", "Tell me why you will be a good fit for the position."),
            q("tih/fit", "What makes you a good fit for this position?", "self-introduction", "behavioural"),
            q("hm/five", "Where do you see yourself in 5 years?"), q("hm/next", "What are you looking for in your next role?"),
            q("hm/six", "What would you hope to achieve in the first six months after being hired?"),
            q("own", "Tell me about a time you took ownership.", "leadership-ownership", "behavioural"),
            q("str", "What is your biggest strength and area of growth?", "strengths-weaknesses", "behavioural"),
            q("intro", "Tell me about yourself."), q("leave", "Why do you want to leave your current/last company?")]
    plans, summary = S.select(ctx, pool, W, "seed")
    picked = [p.pick.slug for p in plans]
    assert "intro" not in picked and "leave" not in picked and summary["unsuitable"] == 2
    assert not {"hm/fit", "tih/fit"} <= set(picked)            # the same question from two sources: once at most


def test_pinned_actions_replace_contradicting_branches_and_speaker_prefixes_go():
    conditions = list(required_conditions("dsa"))
    reply = playbook_reply(conditions)
    for b in reply["branches"]:
        if b["condition"] == "seen_before":
            b["action"], b["say"] = "probe_deeper", "I've seen a similar problem before. Let's tweak the constraints."
    reply["ask"]["opening"] = "Rahul: Hey, let's look at this problem."
    out = ST.tidy_speech(PlaybookOut.model_validate(reply), "Rahul Banerjee")
    out, pinned = ST.pin_actions(out)
    seen = next(b for b in out.branches if b.condition == "seen_before")
    assert pinned == ["seen_before"] and seen.action == PINNED_ACTIONS["seen_before"]
    assert seen.notes == "policy rule (pinned action)"
    assert out.ask.opening == "Hey, let's look at this problem."


def test_playbook_sees_the_candidate_and_is_repaired_when_it_names_another_company():
    ctx = build_context(request("hiring-manager", session={"company": "Accenture", "level": "fresher"},
                                round={"type": "hiring-manager", "topics": [], "difficulty": None}))
    conditions = list(required_conditions("hiring-manager"))
    doc = behavioural_doc("hm/fit", "hr", companies=("bytedance",))
    doc["round_type"] = "hiring-manager"
    doc["content"]["principle"] = "Customer Obsession"
    plan = SlotPlan("core-1", "core", 1, "motivation and career")
    keyed = {"core-1": {"problem": doc, "answer_key": {"key": {"must_cover": ["x"]}, "cache_hit": False}}}
    pers = PersonalizationOut(level_expectations="Fundamentals and clear communication.")
    view = ST.playbook_view(ctx, plan, doc, keyed["core-1"]["answer_key"], PERSONA, pers, 5)
    assert view["candidate"]["projects"] == ["Split app"] and view["candidate"]["level"] == "sde1"
    assert "principle" not in view["problem"]                   # not tied to Accenture: dropped
    leaky = playbook_reply(conditions)
    leaky["ask"]["opening"] = "Why are you the best fit for the role at ByteDance?"
    llm = FakeLLM({"playbook": [leaky, playbook_reply(conditions)]})
    out = asyncio.run(ST.playbook_stage(ctx, [plan], keyed, PERSONA, pers, 5, llm, MemoryTrace(), _Settings()))
    assert "ByteDance" not in out["core-1"].ask.opening
    assert "names bytedance, but this interview is for Accenture" in llm.calls[1][1]


def test_prompts_carry_meanings_rules_and_neutral_keys():
    conditions = list(required_conditions("behavioural"))
    prompt = P.playbook_prompt({"round": {"company": "Accenture"}}, conditions, ["give_hint"])
    assert CONDITION_MEANINGS["seen_before"] in prompt and "(action: switch_to_reserve)" in prompt
    assert "mock interview for Accenture" in prompt and "Never assume an employer" in prompt
    generic = behavioural_doc("generic", "conflict-teamwork")
    generic["content"]["principle"] = "Learn and Be Curious"
    text = P.extras_prompt(generic, {"principle": "Learn and Be Curious", "star_guide": {}})
    assert "Learn and Be Curious" not in text and "never name a company" in text
    lp = behavioural_doc("alp/x", "amazon-lp", companies=("amazon",))
    lp["content"]["principle"] = "Have Backbone"
    assert "Have Backbone" in P.extras_prompt(lp, {"principle": "Have Backbone"})
    assert P.key_version("dsa", "early") == P.KEY_VERSION
    assert P.key_version("behavioural", "senior") == f"{P.EXTRAS_KEY_VERSION}-senior" != P.key_version("behavioural", "early")


def test_hiring_manager_personalization_sees_the_round_and_returns_round_questions():
    ctx = build_context(request("hiring-manager", session={"company": "Accenture", "level": "fresher"},
                                round={"type": "hiring-manager", "topics": ["OOP", "DBMS", "Relocation and shift flexibility"],
                                       "difficulty": None, "format": "Projects, OOP and DBMS basics, relocation and shifts."}))
    reply = {"rapport_hooks": [{"line": "Nice project!", "source": "projects"}],
             "resume_probes": [{"prompt": "Walk me through Split app's data model.", "grounded_in": "Split app", "what_it_tests": "design"}],
             "level_expectations": "Clear fundamentals and honest answers about projects.",
             "round_questions": [{"prompt": "How would you normalise Split app's tables?", "covers": "DBMS",
                                  "what_it_tests": "normalisation", "expected": "3NF with reasons"},
                                 {"prompt": "Are you open to relocating and to rotating shifts?", "covers": "Relocation and shift flexibility",
                                  "what_it_tests": "logistics"}]}
    llm = FakeLLM({"personalization": reply})
    out = asyncio.run(ST.personalization_stage(ctx, llm, MemoryTrace(), _Settings(), planned=["Where do you see yourself in 5 years?"]))
    assert [q.covers for q in out.round_questions] == ["DBMS", "Relocation and shift flexibility"]
    prompt = llm.calls[0][1]
    assert '"round_topics"' in prompt and "Relocation and shift flexibility" in prompt
    assert "Where do you see yourself in 5 years?" in prompt and "round_questions (0-4)" in prompt
    arc, per_slot, deep = ST.plan_arc(ctx, 3)
    assert deep >= 2 * per_slot                                  # the deep-dive gets two shares


# ---------------------------------------------------------------- mixed rounds ("Coding + Leadership Principles")

def _loop_request(**round_overrides):
    rnd = {"type": "dsa", "name": "Loop 1: Coding + Leadership Principles", "duration_mins": 60,
           "topics": ["Arrays and strings", "Leadership Principles"], "problems": [], "difficulty": "medium",
           "format": "A coding problem plus Leadership Principle questions."}
    return request(round={**rnd, **round_overrides})


def _lp(slug, principle):
    doc = behavioural_doc(slug, "amazon-lp", companies=("amazon",))
    doc["content"]["principle"] = principle
    return doc


def _mixed_pool():
    return [dsa_doc("arr-a", tags=("Array",)), dsa_doc("graph-a", tags=("Graph",)),
            dsa_doc("hard-dp", tags=("Dynamic Programming",), difficulty="hard"),
            _lp("lp-a1", "Ownership"), _lp("lp-a2", "Ownership"), _lp("lp-b", "Customer Obsession"), _lp("lp-c", "Dive Deep"),
            behavioural_doc("generic", "conflict-teamwork")]


def test_a_technical_round_with_a_behavioural_part_is_detected():
    ctx = build_context(_loop_request())
    assert ctx.culture and ctx.format_label == "coding interview with a shared editor, plus behavioural questions"
    assert not build_context(request()).culture
    assert not build_context(_loop_request(type="online-assessment")).culture


def test_mixed_round_asks_principles_first_then_one_coding_problem():
    ctx = build_context(_loop_request())
    plans, _ = S.select(ctx, _mixed_pool(), W, "seed")
    assert [p.slot_id for p in plans] == ["culture-1", "culture-2", "core-1", "reserve-harder", "reserve-alternate", "culture-reserve"]
    assert [p.order for p in plans] == [1, 2, 3, 4, 5, 6]
    by_id = {p.slot_id: p.pick for p in plans}
    culture = [by_id[s] for s in ("culture-1", "culture-2", "culture-reserve")]
    assert all(c.category == "amazon-lp" for c in culture)
    principles = [c.doc["content"]["principle"] for c in culture]
    assert len(set(principles)) == 3                      # three different principles
    assert all(by_id[s].round_type == "dsa" for s in ("core-1", "reserve-harder", "reserve-alternate"))


def test_mixed_round_minutes_and_invariants():
    from app.blueprint import assemble as A
    from app.blueprint.models import Blueprint
    from app.blueprint.policies import policies as policy_template
    from tests.blueprint.fixtures import dsa_key_reply

    ctx = build_context(_loop_request())
    plans, _ = S.select(ctx, _mixed_pool(), W, "seed")
    arc, per_slot, _ = ST.plan_arc(ctx, 1, 2)
    core = next(a.timebox_mins for a in arc if a.phase == "core")
    assert sum(a.timebox_mins for a in arc) == 60
    assert ST.culture_minutes(core) == 8 and per_slot == core - 16
    timeboxes = {p.slot_id: 8 if p.slot_id.startswith("culture-") else per_slot for p in plans}
    keyed, playbooks = {}, {}
    for p in plans:
        culture = p.slot_id.startswith("culture-")
        key = {"must_cover": ["a story"], "key_insights": ["x", "y"]} if culture else dsa_key_reply()
        if not culture:
            key["reference_solution"]["verified_against_examples"] = True
        keyed[p.slot_id] = {"problem": p.pick.doc, "answer_key": {"key": key, "cache_hit": False}}
        playbooks[p.slot_id] = PlaybookOut.model_validate(
            playbook_reply(list(required_conditions("behavioural" if culture else "dsa"))))
    slots = A.build_slots(plans, keyed, playbooks, timeboxes)
    assert {s.slot_id: s.timebox_mins for s in slots}["culture-1"] == 8
    bp = Blueprint(blueprint_id="b", session_id="s1", candidate_id="c1", version=1, status="current", input_hash="h",
                   run_id="r", created_at="t", round=A.round_view(ctx, 0), persona=PERSONA.persona, arc=arc,
                   personalization=PersonalizationOut(level_expectations="Solid fundamentals expected."),
                   slots=slots, policies=policy_template(), evaluation=A.evaluation(ctx),
                   briefing=A.briefing(ctx, PERSONA, slots), provenance={})
    assert [c for c in A.invariants(ctx, bp) if not c["passed"]] == []


def test_design_problems_must_design_what_their_title_names_and_never_repeat():
    def lld(slug, title, prompt):
        return {"slug": slug, "round_type": "lld", "title": title, "difficulty": "medium", "topic_tags": ["OOP"],
                "company_tags": [], "company_evidence": {}, "level_tags": [], "content_status": "generated",
                "content_hash": f"h-{slug}", "content": {"prompt": prompt}}
    swapped = lld("brief/parking", "Design a parking lot", "Design a bike-sharing docking system for a city with stations.")
    faithful = lld("ood/parking", "Design A Parking Lot", "Design a multi-level parking lot that assigns spots to vehicles.")
    other = lld("ood/library", "Design A Library Management System", "Design a library management system for members and books.")
    assert S.content_off_title(swapped) and not S.content_off_title(faithful)
    ctx = build_context(request("lld", round={"type": "lld", "topics": [], "difficulty": "medium", "problems": ["Design a parking lot"]}))
    plans, summary = S.select(ctx, [swapped, faithful, other], W, "seed")
    picks = {p.slot_id: p.pick.slug for p in plans}
    assert picks == {"core-1": "ood/parking", "reserve-alternate": "ood/library"} and summary["unsuitable"] == 1


def test_the_live_pool_carries_the_content_selection_reads():
    """Selection's company, principle and named-design checks read content: the pool must load it for every
    non-DSA round type (a content-less pool silently disabled all three)."""
    from app.blueprint import store
    assert "content" not in store.pool_projection(["behavioural"])
    assert "content" not in store.pool_projection(["hiring-manager"]) and "content" not in store.pool_projection(["lld"])
    assert store.pool_projection(["dsa", "online-assessment"])["content"] == 0


def test_a_company_whose_principles_come_up_in_every_interview_makes_technical_rounds_mixed():
    amazon = {"company_specific_patterns": "Ownership-heavy, metrics-driven culture organised around 16 Leadership "
                                           "Principles that surface in every interview and in performance reviews."}
    google = {"company_specific_patterns": "Software engineers are hired at levels L3 to L7 against a common global bar, "
                                           "with Googleyness and system design weighted by level."}
    sd = {"type": "system-design", "name": "System design 1", "topics": ["Scalability"], "problems": [], "difficulty": "hard"}
    assert build_context(request("system-design", round=sd, company_brief=amazon)).culture
    assert not build_context(request("system-design", round=sd, company_brief=google)).culture
    assert not build_context(request("system-design", round=sd)).culture


def test_placeholders_in_spoken_lines_are_scrubbed_without_a_repair_round():
    ctx = build_context(request("behavioural", round={"type": "behavioural", "topics": [], "difficulty": None}))
    conditions = list(required_conditions("behavioural"))
    plan = SlotPlan("core-1", "core", 1, "motivation")
    doc = behavioural_doc("generic", "conflict-teamwork")
    keyed = {"core-1": {"problem": doc, "answer_key": {"key": {"must_cover": ["x"]}, "cache_hit": False}}}
    pers = PersonalizationOut(level_expectations="Fundamentals and clear communication.")
    leaky = playbook_reply(conditions)
    leaky["branches"][0]["say"] = "Earlier you mentioned X, but now you say Y. Which is it?"
    llm = FakeLLM({"playbook": [leaky]})
    out = asyncio.run(ST.playbook_stage(ctx, [plan], keyed, PERSONA, pers, 5, llm, MemoryTrace(), _Settings()))
    assert len(llm.calls) == 1                                  # no repair call for a placeholder
    assert not ST._placeholders(out["core-1"])
    prompt = P.playbook_prompt({"round": {"company": "Amazon"}}, conditions, ["clarify"])
    assert "candidate's OWN past example" not in prompt                        # a pack line now, not a shared rule
    with_pack = P.playbook_prompt({"round": {"company": "Amazon"}}, conditions, ["clarify"], pack_rules=pack_for("behavioural").playbook_rules)
    assert "candidate's OWN past example" in with_pack and "no placeholders" in with_pack


def test_every_dsa_round_asks_two_problems_whatever_its_length_or_difficulty():
    pool = [dsa_doc(f"p{i}", tags=(t,), difficulty=d) for i, (t, d) in enumerate(
        [("Array", "medium"), ("Graph", "medium"), ("Tree", "hard"), ("String", "hard"), ("Dynamic Programming", "hard"), ("Heap", "medium")])]
    def ids(**rnd):
        ctx = build_context(request(round={"type": "dsa", "topics": [], "problems": [], **rnd}))
        return [p.slot_id for p in S.select(ctx, pool, W, "seed")[0]], ctx
    for rnd in ({"duration_mins": 30, "difficulty": "medium"}, {"duration_mins": 60, "difficulty": "hard"}, {"duration_mins": 45, "difficulty": "medium"}):
        picked, ctx = ids(**rnd)
        assert picked[:2] == ["core-1", "core-2"] and S.coding_cores(ctx) == 2, rnd
    oa = build_context(request("online-assessment", round={"type": "online-assessment", "duration_mins": 30, "topics": []}))
    assert S.coding_cores(oa) == 0


def test_rounds_with_non_problem_parts_get_round_questions_and_time_for_them():
    cred = {"type": "dsa", "name": "DSA and puzzles", "topics": ["Data structures", "Puzzles"], "problems": [],
            "difficulty": "medium", "duration_mins": 60}
    ctx = build_context(request(round=cred))
    assert ctx.extra_part and S.coding_cores(ctx) == 2           # the projects and fundamentals come on top of two problems
    arc, per_slot, deep = ST.plan_arc(ctx, 2)
    assert deep >= per_slot - 1 and deep > 0                 # the puzzles get their own share of the core
    assert not build_context(request(round={"type": "dsa", "name": "Coding round", "topics": ["Graphs"], "problems": []})).extra_part
    assert not build_context(request("online-assessment", round={"type": "online-assessment", "topics": ["SQL"], "problems": []})).extra_part
    reply = {"rapport_hooks": [], "resume_probes": [], "level_expectations": "Clear fundamentals expected here.",
             "round_questions": [{"prompt": "Two eggs, a hundred floors: how many drops at most?", "covers": "Puzzles",
                                  "what_it_tests": "reasoning"}]}
    out = asyncio.run(ST.personalization_stage(ctx, FakeLLM({"personalization": reply}), MemoryTrace(), _Settings()))
    assert len(out.round_questions) == 1
    plain = build_context(request())
    dropped = asyncio.run(ST.personalization_stage(plain, FakeLLM({"personalization": reply}), MemoryTrace(), _Settings()))
    assert dropped.round_questions == []                       # no time for them in a plain coding round


def test_core_problems_stay_at_or_below_the_target_difficulty():
    ctx = build_context(request(session={"level": "sde2"}, round={"type": "dsa", "difficulty": "medium", "topics": [], "duration_mins": 60}))
    pool = [dsa_doc("h1", tags=("Graph",), difficulty="hard"), dsa_doc("h2", tags=("Tree",), difficulty="hard"),
            dsa_doc("h3", tags=("Heap",), difficulty="hard"), dsa_doc("m1", tags=("Array",)), dsa_doc("m2", tags=("String",)),
            dsa_doc("m3", tags=("Dynamic Programming",))]
    plans, _ = S.select(ctx, pool, W, "seed")
    cores = [p.pick.difficulty for p in plans if p.kind == "core"]
    assert cores == ["medium", "medium"]
    assert next(p for p in plans if p.slot_id == "reserve-harder").pick.difficulty == "hard"


def test_seen_before_lines_never_name_a_reserve_and_lines_end_as_sentences():
    conditions = list(required_conditions("dsa"))
    reply = playbook_reply(conditions)
    for b in reply["branches"]:
        if b["condition"] == "seen_before":
            b["say"] = "Let's design a collaborative document editor instead."
        if b["condition"] == "asks_clarification":
            b["say"] = "Good question. Let's look at the constraints:"
    out = ST.tidy_speech(PlaybookOut.model_validate(reply), "Rahul Banerjee")
    says = {b.condition: b.say for b in out.branches}
    assert "document editor" not in says["seen_before"]
    assert says["asks_clarification"] == "Good question. Let's look at the constraints."


def test_fundamentals_follow_the_rounds_own_words():
    from app.blueprint import fundamentals as F
    salescode = "Technical round: data structures and problem solving Data structures Algorithms Java SQL Basic problem solving Resume-based questions"
    assert F.topics_named(salescode) == ["sql", "java"]
    assert F.topics_named("Technical interview: core subjects, projects") == ["oop", "dbms", "os", "networks"]
    assert F.topics_named("Programming basics and projects", ["TypeScript", "React"]) == ["javascript"]
    first = F.pool(["sql", "java"], "sde1", "seed-a")
    assert first == F.pool(["sql", "java"], "sde1", "seed-a") and len(first) == 4
    assert all(q["expected"] for q in first) and {q["topic"] for q in first} == {"sql", "java"}
    assert not any(q["id"] == "java-concurrency" for q in F.pool(["java"], "fresher", "s", per_topic=10))   # mid band
    assert len({q["id"] for q in F.FUNDAMENTALS}) == len(F.FUNDAMENTALS)


def test_round_questions_come_from_the_pool_and_never_repeat_the_coding():
    rnd = {"type": "dsa", "name": "Technical round", "topics": ["Data structures", "Java", "SQL"], "problems": [],
           "difficulty": "medium", "duration_mins": 60}
    ctx = build_context(request(round=rnd))
    assert ctx.format_label.endswith("plus questions on your projects and fundamentals")
    coding = {"rapport_hooks": [], "resume_probes": [], "level_expectations": "Solid fundamentals expected here.",
              "round_questions": [{"prompt": "Implement a function in Java that checks whether a binary tree is balanced.",
                                   "covers": "Algorithms", "what_it_tests": "trees"}]}
    good = {**coding, "round_questions": [{"prompt": "Why must equals() and hashCode() be overridden together?",
                                           "covers": "Java", "what_it_tests": "hashing contract"}]}
    llm = FakeLLM({"personalization": [coding, good]})
    out = asyncio.run(ST.personalization_stage(ctx, llm, MemoryTrace(), _Settings(), seed="s"))
    assert out.round_questions[0].covers == "Java"
    assert "must not be coding or algorithm problems" in llm.calls[1][1]
    assert '"fundamentals_pool"' in llm.calls[0][1] and '"topic": "sql"' in llm.calls[0][1]


def test_design_problems_above_the_candidates_level_wait_for_relaxation_unless_named():
    def lld(slug, title, tags, prompt):
        return {"slug": slug, "round_type": "lld", "title": title, "difficulty": "medium", "topic_tags": ["OOP"],
                "company_tags": [], "company_evidence": {}, "level_tags": list(tags), "content_status": "generated",
                "content_hash": f"h-{slug}", "content": {"prompt": prompt}}
    snowflake = lld("lldp/snowflake", "Design Distributed Id Generation like Twitter Snowflake id", ("sde1", "sde2"),
                    "Design a distributed unique id generator like Twitter Snowflake.")
    library = lld("ood/library", "Design A Library Management System", ("fresher", "intern", "sde1"), "Design a library management system.")
    tictac = lld("ood/tictactoe", "Design Tic Tac Toe", ("fresher", "intern", "sde1"), "Design tic tac toe for two players.")
    fresher = build_context(request("lld", session={"level": "fresher"}, round={"type": "lld", "topics": [], "difficulty": "medium", "problems": []}))
    assert S.score_candidate(snowflake, fresher, W).distance == 1 and S.score_candidate(library, fresher, W).distance == 0
    plans, _ = S.select(fresher, [snowflake, library, tictac], W, "seed")
    assert "lldp/snowflake" not in {p.pick.slug for p in plans}
    named = build_context(request("lld", session={"level": "fresher"},
                                  round={"type": "lld", "topics": [], "difficulty": "medium",
                                         "problems": ["Design Distributed Id Generation like Twitter Snowflake id"]}))
    assert S.score_candidate(snowflake, named, W).distance == 0


def test_a_fundamentals_led_design_round_spends_most_of_its_core_on_fundamentals():
    rnd = {"type": "lld", "name": "Technical interview", "topics": ["Core subjects", "Projects", "DBMS", "OOP"],
           "problems": [], "difficulty": "medium", "duration_mins": 45}
    ctx = build_context(request("lld", session={"level": "fresher"}, round=rnd))
    arc, per_slot, deep = ST.plan_arc(ctx, 1)
    assert ctx.extra_part and deep >= 2 * per_slot - 1


def test_placeholders_that_survive_a_repair_or_backfill_are_replaced_by_the_default_rule():
    conditions = list(required_conditions("behavioural"))
    reply = playbook_reply(conditions)
    for b in reply["branches"]:
        if b["condition"] == "inconsistent":
            b["say"] = "You mentioned X earlier; can you clarify?"
    reply["probes"] = [f"probe {i}" for i in range(9)]
    reply["follow_ups"] = [f"follow up {i}" for i in range(9)]
    out = ST.scrub_placeholders(PlaybookOut.model_validate(reply))
    line = next(b for b in out.branches if b.condition == "inconsistent")
    assert "X" not in line.say and line.notes.startswith("default rule") and len(out.probes) == 5 and len(out.follow_ups) == 4


def test_an_invented_candidate_name_is_stripped_from_spoken_lines():
    assert ST.drop_invented_names("Thanks for sharing your background, Imran. Could you tell me more?") == \
        "Thanks for sharing your background. Could you tell me more?"
    assert ST.drop_invented_names("Hi, Priya! Welcome.") == "Hi! Welcome."
    assert ST.drop_invented_names("Great, let's look at Java, Python and SQL.") == "Great, let's look at Java, Python and SQL."
    reply = playbook_reply(list(required_conditions("behavioural")))
    reply["ask"]["opening"] = "Thanks for sharing about Relay, Imran. Tell me about a time you owned a decision."
    out = ST.scrub_placeholders(PlaybookOut.model_validate(reply))
    assert "Imran" not in out.ask.opening and out.ask.opening.startswith("Thanks for sharing about Relay.")


def test_a_playbook_that_omits_expectations_and_signals_is_repaired_then_filled_from_the_key():
    ctx = build_context(request())
    conditions = list(required_conditions("dsa"))
    plan = SlotPlan("core-1", "core", 1, "first problem")
    keyed = {"core-1": {"problem": dsa_doc("p"), "answer_key": {"key": {"key_insights": ["use a map", "one pass"]}, "cache_hit": False}}}
    pers = PersonalizationOut(level_expectations="Solid fundamentals expected.")
    short = playbook_reply(conditions)
    del short["expectations"], short["evaluation_signals"]
    llm = FakeLLM({"playbook": [short, short]})
    out = asyncio.run(ST.playbook_stage(ctx, [plan], keyed, PERSONA, pers, 15, llm, MemoryTrace(), _Settings()))["core-1"]
    assert len(llm.calls) == 2 and "missing sections: expectations, evaluation_signals" in llm.calls[1][1]
    assert out.expectations.must_show == ["use a map", "one pass"] and out.evaluation_signals


def test_the_playbook_prompt_takes_its_family_lines_from_the_pack():
    conditions = list(required_conditions("dsa"))
    view = {"round": {"company": "Amazon"}}
    design = P.playbook_prompt(view, conditions, ["give_hint"], pack_rules=SYSTEM_DESIGN.playbook_rules)
    assert "Hints name a dimension they skipped" in design and "language-neutral" not in design
    dsa = P.playbook_prompt(view, conditions, ["give_hint"], pack_rules=pack_for("dsa").playbook_rules)
    assert "Hints and lines stay language-neutral" in dsa and "Probes dig three to five levels" not in dsa


def test_a_dsa_playbook_prompt_still_holds_every_line_it_held_before_packs():
    from pathlib import Path
    from app.blueprint.vocabulary import ACTIONS
    frozen = (Path(__file__).parents[1] / "rounds" / "fixtures" / "playbook_prompt_frozen.txt").read_text()
    now = P.playbook_prompt({"round": {"company": "Amazon"}}, list(required_conditions("dsa")), list(ACTIONS),
                            pack_rules=pack_for("dsa").playbook_rules)
    lines = {ln.strip(" -") for ln in now.splitlines()}
    # The two behavioural lines left the shared Rules for the behavioural pack; every other frozen line must survive.
    behavioural_only = ("A behavioural question asks for", "For a behavioural question, probes dig")
    missing = [ln for ln in frozen.splitlines() if ln.strip(" -") not in lines and not any(b in ln for b in behavioural_only)]
    assert not missing, missing


def test_a_culture_slot_gets_the_behavioural_packs_playbook_rules():
    assert ST.pack_rules_for("dsa", "culture-1") == pack_for("behavioural").playbook_rules
    assert ST.pack_rules_for("dsa", "core-1") == pack_for("dsa").playbook_rules
    assert ST.pack_rules_for("system-design", "core-1") == SYSTEM_DESIGN.playbook_rules


def test_the_online_assessment_pack_keeps_the_shared_coding_line():
    line = ("In a coding or design question every branch, probe and signal is about the problem itself; culture and behavioural "
            "questions belong to behavioural questions only.")
    assert line in pack_for("online-assessment").playbook_rules and line in pack_for("dsa").playbook_rules
