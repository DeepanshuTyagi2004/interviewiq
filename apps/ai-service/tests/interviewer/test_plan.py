from app.interviewer.plan import MIN_TURNS, bridge_for, build_items, min_exchanges_before_coding, opening_hint, format_args, layout_for, problem_payload, reserve_slots, reveal_text, round_seconds, slot_by_id, wire_ids
from tests.interviewer.fixtures import blueprint, context, deep_dive_blueprint


def test_items_follow_the_arc_with_core_problems_in_order():
    items = build_items(blueprint())
    assert [(i.item_id, i.kind) for i in items] == [
        ("greeting", "phase"), ("candidate_intro", "phase"), ("core-1", "slot"), ("core-2", "slot"),
        ("candidate_questions", "phase"), ("wrap_up", "phase")]
    assert items[2].max_seconds == 1200 and items[0].max_seconds == 60
    assert [s["slot_id"] for s in reserve_slots(blueprint())] == ["reserve-alternate"]


def test_the_problem_payload_is_candidate_safe():
    payload = problem_payload(slot_by_id(blueprint(), "core-1"), "Problem 1")
    assert payload["type"] == "panel.show_problem" and payload["label"] == "Problem 1"
    assert payload["examples"][0] == {"input": "nums = [2, 7, 11, 15]\ntarget = 9", "output": "[0, 1]", "explanation": "2 + 7 = 9"}
    flat = str(payload)
    for secret in ("Pair Sum", "medium", "hash map", "seen[x]", "constraints", "hint"):
        assert secret not in flat


def test_reveal_texts_and_round_length():
    slot = slot_by_id(blueprint(), "core-1")
    assert reveal_text(slot, "constraints") == "2 <= len(nums) <= 10^4\nexactly one answer"
    assert reveal_text(slot, "format") == "Input: nums: list[int], target: int\nOutput: list[int] of two indices"
    assert reveal_text(slot, "hint") is None
    assert round_seconds(blueprint(), context()) == 3600
    assert format_args({"s": "eceba"}) == 's = "eceba"'


def _wire_slot(slot_id, kind, order):
    return {"slot_id": slot_id, "kind": kind, "order": order}


def test_wire_ids_are_the_kind_and_its_position_so_they_never_carry_a_word_from_the_blueprint():
    bp = {"slots": [_wire_slot("culture-2", "core", 2), _wire_slot("core-1", "core", 1), _wire_slot("reserve-harder", "reserve", 4),
                    _wire_slot("reserve-alternate", "reserve", 3), _wire_slot("culture-reserve", "reserve", 5)]}
    assert wire_ids(bp) == {"core-1": "core-1", "culture-2": "core-2", "reserve-alternate": "reserve-1",
                            "reserve-harder": "reserve-2", "culture-reserve": "reserve-3"}


def test_wire_ids_are_stable_for_a_blueprint_so_a_restarted_worker_agrees_with_the_browser():
    bp = {"slots": [_wire_slot("core-1", "core", 1), _wire_slot("reserve-harder", "reserve", 2)]}
    assert wire_ids(bp) == wire_ids({"slots": list(reversed(bp["slots"]))})


def test_the_room_is_conversation_only_until_a_problem_needs_the_editor_and_again_for_the_closing():
    bp = blueprint()
    items = {i.item_id: i for i in build_items(bp)}
    assert [layout_for(bp, items[k]) for k in ("greeting", "candidate_intro", "core-1", "core-2", "candidate_questions", "wrap_up")] == [
        "talk", "talk", "work", "work", "talk", "talk"]


def test_a_behavioural_question_or_a_culture_slot_is_a_conversation_not_an_editor():
    bp = blueprint()
    bp["slots"][1]["slot_id"] = "culture-2"
    bp["slots"][0]["problem"]["round_type"] = "behavioural"
    items = build_items(bp)
    by_id = {i.item_id: i for i in items}
    assert layout_for(bp, by_id["culture-2"]) == "talk" and layout_for(bp, by_id["core-1"]) == "talk"


def test_design_and_low_level_design_problems_use_the_work_area_for_the_board_and_editor():
    bp = blueprint()
    for round_type in ("system-design", "lld", "dsa", "online-assessment"):
        bp["slots"][0]["problem"]["round_type"] = round_type
        item = next(i for i in build_items(bp) if i.item_id == "core-1")
        assert layout_for(bp, item) == "work"


def test_the_resume_and_projects_deep_dive_is_a_plan_item_after_the_problems_and_before_the_questions():
    bp = blueprint()
    bp["round"]["deep_dive_mins"] = 7
    items = build_items(bp)
    assert [i.item_id for i in items] == ["greeting", "candidate_intro", "core-1", "core-2", "deep_dive", "candidate_questions", "wrap_up"]
    deep = next(i for i in items if i.item_id == "deep_dive")
    assert deep.kind == "phase" and deep.max_seconds == 7 * 60
    assert layout_for(bp, deep) == "talk"
    assert [i.item_id for i in build_items(blueprint())] == ["greeting", "candidate_intro", "core-1", "core-2", "candidate_questions", "wrap_up"]


def test_background_phases_need_real_exchanges_before_the_interviewer_may_move_on():
    assert MIN_TURNS["deep_dive"] >= 3 and MIN_TURNS["small_talk"] >= 1 and MIN_TURNS["candidate_questions"] >= 1
    assert min_exchanges_before_coding(blueprint()) >= 5            # greeting to intro, counted together before the coding


def test_the_resume_probes_are_shared_out_so_the_introduction_and_the_deep_dive_never_ask_the_same_one():
    from app.interviewer.plan import deep_dive_probes, intro_probes

    a, b, c = ({"prompt": f"probe {n}"} for n in "abc")
    assert intro_probes({"resume_probes": [a, b, c]}) == [a] and deep_dive_probes({"resume_probes": [a, b, c]}) == [b, c]
    assert intro_probes({"resume_probes": [a]}) == [] and deep_dive_probes({"resume_probes": [a]}) == [a]      # one probe: kept for the deep dive
    assert intro_probes({}) == [] and deep_dive_probes({}) == []


def test_every_part_knows_whether_it_must_be_covered():
    items = build_items(blueprint())
    assert [(i.item_id, i.must) for i in items] == [("greeting", False), ("candidate_intro", True), ("core-1", True),
                                                    ("core-2", True), ("candidate_questions", True), ("wrap_up", True)]


def test_an_arc_without_scored_flags_uses_the_unscored_phases_and_the_questions_and_closing_are_always_must():
    bp = blueprint()
    bp["arc"] = [{"phase": p, "timebox_mins": 1} for p in ("greeting", "small_talk", "candidate_intro", "candidate_questions", "wrap_up")]
    assert [i.must for i in build_items(bp)] == [False, False, True, True, True]


def test_a_part_carries_its_style_and_the_core_style_goes_to_the_first_problem_only():
    bp = blueprint()
    bp["arc"][1]["style"] = "pointed_resume"
    bp["arc"][2]["style"] = "with_outline"
    items = {i.item_id: i for i in build_items(bp)}
    assert items["candidate_intro"].style == "pointed_resume"
    assert (items["core-1"].style, items["core-2"].style) == ("with_outline", "")


def test_a_shape_sets_how_many_exchanges_come_before_the_coding():
    assert min_exchanges_before_coding(blueprint()) == 5
    assert min_exchanges_before_coding({**blueprint(), "shape_id": "straight_in"}) == 1


def test_the_introduction_opens_in_the_parts_style():
    bp = blueprint()
    assert "pointed question" in opening_hint(bp, "candidate_intro", "pointed_resume")
    assert "split-bill app's settlement logic" in opening_hint(bp, "candidate_intro", "pointed_resume")
    assert opening_hint(bp, "candidate_intro", "") == opening_hint(bp, "candidate_intro")
    assert bridge_for("candidate_intro", "after_coding") == "Now let's talk a bit about you."


def test_a_round_questions_area_comes_from_what_it_covers_or_its_text_and_motivation_has_none():
    from app.interviewer.plan import question_area

    covers = {q["covers"]: q for q in deep_dive_blueprint()["personalization"]["round_questions"]}
    assert [question_area(q) for q in covers.values()] == ["Java", "databases", "databases", None]
    assert question_area({"prompt": "How does the useEffect dependency array work?", "covers": "React"}) == "React"
    assert question_area({"prompt": "Explain virtual memory and paging in an OS.", "covers": "fundamentals"}) == "operating systems"
    assert question_area({"prompt": "Describe how a pod gets scheduled.", "covers": "kubernetes-scheduling"}) == "kubernetes scheduling"


def test_the_outline_lists_every_part_of_the_round_as_it_really_is_in_order():
    from app.interviewer.plan import outline_sentence

    text = outline_sentence(deep_dive_blueprint())
    order = ["introduction", "one or two coding problems", "some questions about your projects", "a few quick fundamentals questions",
             "time for your questions"]
    assert [text.index(part) for part in order] == sorted(text.index(part) for part in order)
    assert "Java and databases" in text
    plain = outline_sentence(blueprint())
    assert "fundamentals" not in plain and "projects" not in plain and "one or two coding problems" in plain


def test_the_deep_dive_asks_the_resume_probes_first_then_the_round_questions_grouped_by_area():
    from app.interviewer.plan import deep_dive_questions

    bp = deep_dive_blueprint()
    bp["personalization"]["round_questions"].insert(1, {"prompt": "What does the final keyword mean in Java?", "covers": "Java", "what_it_tests": "x"})
    asked = [(area, q["prompt"][:12]) for area, q in deep_dive_questions(bp["personalization"])]
    assert asked == [(None, "In the Relay"), ("Java", "Can you expl"), ("Java", "What does th"), ("databases", "What is the "),
                     ("databases", "In your Vibe"), (None, "Why are you ")]


def test_the_deep_dive_opens_with_what_comes_next_and_the_first_question():
    hint = opening_hint(deep_dive_blueprint(), "deep_dive")
    assert "That wraps up the coding part." in hint
    assert hint.index("projects") < hint.index("fundamentals")
    assert "Relay project" in hint
    only_questions = deep_dive_blueprint()
    only_questions["personalization"]["resume_probes"] = []
    assert "fundamentals" in opening_hint(only_questions, "deep_dive") and "projects" not in opening_hint(only_questions, "deep_dive").split("Java HashMap")[0]


def _round_questions_bp(*covers, probes=True, round_type="dsa"):
    bp = deep_dive_blueprint()
    bp["round"]["type"] = round_type
    bp["personalization"]["round_questions"] = [{"prompt": f"A question number {n} about the topic?", "covers": c, "what_it_tests": "x"}
                                                for n, c in enumerate(covers)]
    if not probes:
        bp["personalization"]["resume_probes"] = []
    return bp


def test_area_labels_are_clean_speech_for_the_real_unusual_covers_from_a_rehearsal():
    """struggler_gives_up carried 'Data structures / DBMS fundamentals', 'OOP fundamentals', 'Puzzles' and 'Fundamentals – API design',
    which the outline read out raw."""
    from app.interviewer.plan import outline_sentence, round_question_areas

    bp = _round_questions_bp("Data structures / DBMS fundamentals", "OOP fundamentals", "Puzzles", "Fundamentals – API design")
    assert round_question_areas(bp["personalization"]) == ["databases", "object-oriented design", "puzzles", "API design"]
    assert "fundamentals questions on databases, object-oriented design, puzzles and API design" in outline_sentence(bp)


def test_a_label_that_would_read_badly_is_left_out_of_the_named_areas_but_the_question_stays_a_fundamentals_one():
    from app.interviewer.plan import outline_sentence, question_area

    assert question_area({"prompt": "x", "covers": "Fundamentals: caching"}) == "caching"
    assert question_area({"prompt": "x", "covers": "Fundamentals - API design"}) == "API design"
    assert question_area({"prompt": "x", "covers": "Distributed systems design and scalability"}) == ""
    assert question_area({"prompt": "x", "covers": "Time / space trade-offs"}) == ""
    bp = _round_questions_bp("Distributed systems design and scalability")
    assert outline_sentence(bp).endswith("a few quick fundamentals questions, then time for your questions")
    mixed = _round_questions_bp("Java", "Distributed systems design and scalability")
    assert "fundamentals questions on Java," in outline_sentence(mixed)


def test_a_question_with_no_area_is_not_a_fundamentals_question_and_is_asked_last_with_its_own_lead_in():
    from app.interviewer.plan import deep_dive_questions, outline_sentence

    only_motivation = _round_questions_bp("resume-based question")
    assert "fundamentals" not in outline_sentence(only_motivation)
    assert "some quick fundamentals" not in opening_hint(only_motivation, "deep_dive")
    order = _round_questions_bp("resume-based question", "Java", "Puzzles and trade-offs in many different areas")
    assert [a for a, _ in deep_dive_questions(order["personalization"])][1:] == ["Java", "", None]


def test_a_design_or_behavioural_round_names_its_own_part_and_never_says_the_coding_is_done():
    from app.interviewer.plan import outline_sentence

    design = _round_questions_bp("Java", round_type="system-design")
    assert "That wraps up the design part." in opening_hint(design, "deep_dive") and "coding" not in opening_hint(design, "deep_dive")
    assert "a design problem" in outline_sentence(design) and "coding" not in outline_sentence(design)
    behavioural = _round_questions_bp("Java", round_type="behavioural")
    assert "That wraps up the questions." in opening_hint(behavioural, "deep_dive") and "coding" not in opening_hint(behavioural, "deep_dive")
    text = outline_sentence(behavioural)
    assert "some questions about your experience" in text and "your projects" not in text
    assert "a couple of questions about your projects" not in opening_hint(behavioural, "deep_dive")
    assert "That wraps up the coding part." in opening_hint(deep_dive_blueprint(), "deep_dive")


# ---------------------------------------------------------------- the outline's promises (realism block, decided 2026-10-18)

def test_the_framing_order_names_exactly_the_promised_areas_as_content():
    from tests.interviewer.fixtures import realism_blueprint

    hint = opening_hint(realism_blueprint(("fundamentals:Java", "fundamentals:databases")), "framing")
    assert "Java and databases" in hint and "React" not in hint
    assert "in your own words" in hint and "name exactly these fundamentals areas" in hint and "your projects" not in hint.split("Your outline")[0]
    only_java = opening_hint(realism_blueprint(("fundamentals:Java",)), "framing")
    assert "questions on Java" in only_java and "databases" not in only_java
    with_project = opening_hint(realism_blueprint(("projects:Relay", "fundamentals:Java")), "framing")
    assert "your Relay project" in with_project and "databases" not in with_project
    assert not any(ch.isdigit() for ch in hint) and "minute" not in hint


def test_the_spoken_outline_follows_the_live_plans_order_which_is_the_arcs_order():
    from app.interviewer.plan import outline_sentence
    from tests.interviewer.fixtures import realism_blueprint

    text = outline_sentence(realism_blueprint())
    order = ["introduction", "one or two coding problems", "Relay project", "fundamentals questions on Java and databases", "time for your questions"]
    assert [text.index(p) for p in order] == sorted(text.index(p) for p in order)


def test_a_blueprint_without_realism_produces_todays_outline_text_exactly():
    from app.interviewer.plan import outline_sentence

    bp = deep_dive_blueprint()
    assert outline_sentence(bp) == ("a short introduction from you, then one or two coding problems, then some questions about your projects, then a few "
                                    "quick fundamentals questions on Java and databases, then time for your questions")
    assert opening_hint(bp, "framing").startswith("say how the round will run (from the outline), naming each part in this order: a short introduction")
    assert "in your own words" not in opening_hint(bp, "framing")
    assert 'ask the first one: In the Relay project you used SQLite' in opening_hint(bp, "deep_dive")


def test_each_promise_has_a_pool_and_the_deep_dive_opens_on_the_first_promises_question():
    from app.interviewer.plan import deep_dive_extras, promise_questions, promises_of
    from tests.interviewer.fixtures import realism_blueprint

    bp = realism_blueprint(("fundamentals:Java", "projects:Relay", "fundamentals:databases"))
    personal = bp["personalization"]
    assert promises_of(bp) == ["fundamentals:Java", "projects:Relay", "fundamentals:databases"]
    assert [q["prompt"][:12] for q in promise_questions(personal, "fundamentals:databases")] == ["What is the ", "In your Vibe"]
    assert [q["prompt"][:12] for q in promise_questions(personal, "projects:Relay")] == ["In the Relay"]
    assert [q["prompt"][:8] for _, q in deep_dive_extras(personal, bp)] == ["Why are "]
    assert "Java HashMap" in opening_hint(bp, "deep_dive")                # the first promise is Java: its question opens the part
    assert opening_hint(realism_blueprint(), "deep_dive").endswith("persistence for the command history?")


def test_a_realism_outline_with_no_deep_dive_in_the_live_plan_promises_nothing():
    from app.interviewer.plan import promises_of
    from tests.interviewer.fixtures import realism_blueprint

    bp = realism_blueprint()
    bp["round"]["deep_dive_mins"] = 0
    assert promises_of(bp) == [] and promises_of(deep_dive_blueprint()) == []


def test_the_with_outline_hint_and_the_one_line_framing_carry_the_promises_for_a_realism_round_and_todays_text_for_an_old_one():
    from app.interviewer.plan import with_outline_text
    from tests.interviewer.fixtures import realism_blueprint

    assert with_outline_text(deep_dive_blueprint()) == ("say in one sentence how the coding will run, then time for their questions "
                                                         "(never a number of minutes or any length of time).")
    bp = realism_blueprint(("fundamentals:Java", "projects:Relay"))
    text = with_outline_text(bp)
    assert "questions on Java" in text and "your Relay project" in text and "name exactly these fundamentals areas" in text
    assert "introduction" not in text and "minute" not in text and not any(ch.isdigit() for ch in text)
    one_line = opening_hint(bp, "framing", "one_line")
    assert "in your own words" in one_line and "questions on Java" in one_line and "there will be" not in one_line and "minute" not in one_line
    assert "there will be" in opening_hint(deep_dive_blueprint(), "framing", "one_line")


def test_the_outline_turn_is_eligible_up_to_the_first_problem_in_the_plans_order_whatever_the_part():
    from app.interviewer.plan import outline_turn_eligible

    items = [("greeting", "phase"), ("candidate_intro", "phase"), ("core-1", "slot"), ("deep_dive", "phase")]
    assert [outline_turn_eligible(items, i) for i in ("greeting", "candidate_intro", "core-1", "deep_dive", "nowhere")] == [True, True, True, False, True]
    before = [("deep_dive", "phase"), ("core-1", "slot"), ("wrap_up", "phase")]                  # a plan with the deep dive ahead of the coding
    assert outline_turn_eligible(before, "deep_dive") and not outline_turn_eligible(before, "wrap_up")


# ------------------------------------------------------------------ final review wave (decided 2026-10-18)

def test_a_swapped_classic_arc_never_names_the_introduction_in_the_outline_because_it_was_had_before_the_framing():
    """I4: with the swap (candidate_intro before framing) the outline said "a short introduction from you" after the introduction had happened."""
    from app.interviewer.plan import outline_parts, outline_sentence
    from app.interviewer.prompts import item_details
    from tests.interviewer.fixtures import realism_blueprint

    plain = realism_blueprint()
    assert [p["phase"] for p in plain["arc"]][:3] == ["greeting", "framing", "candidate_intro"]
    assert "a short introduction from you" in outline_parts(plain)                       # framing first: the introduction is still to come
    swapped = realism_blueprint()
    arc = swapped["arc"]
    f, i = next(n for n, a in enumerate(arc) if a["phase"] == "framing"), next(n for n, a in enumerate(arc) if a["phase"] == "candidate_intro")
    arc[f], arc[i] = arc[i], arc[f]
    assert [a["phase"] for a in arc][:3] == ["greeting", "candidate_intro", "framing"]
    assert "a short introduction from you" not in outline_parts(swapped) and "introduction" not in outline_sentence(swapped)
    assert outline_parts(swapped) == [p for p in outline_parts(plain) if p != "a short introduction from you"]
    framing = {"item_id": "framing", "kind": "phase", "phase": "framing", "style": ""}
    assert "a short introduction from you" in item_details(plain, framing) and "a short introduction from you" not in item_details(swapped, framing)
