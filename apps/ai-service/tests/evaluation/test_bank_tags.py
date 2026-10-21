"""The grader chooses bank tags; practice matches them exactly (R26)."""
import asyncio

from app.blueprint import selection
from app.evaluation import graders, practice, prompts
from app.evaluation.topics_util import Source
from app.evaluation.inputs import DeliveryStats
from app.evaluation.report import abandoned_gaps
from tests.evaluation.test_graders import FakeChat, meta, part, reply
from tests.evaluation.test_practice import POOL, run as suggest_run, slugs

VOCAB = ["Dynamic Programming", "Sliding Window", "Binary Search", "Array"]


def gap(topic, tags, subject="DSA", why="w"):
    t = {"topic": topic, "why": why}
    if tags is not None:
        t["bank_tags"] = tags
    return {"subject": subject, "topics": [t]}


def go(gaps, monkeypatch, **kw):
    async def pool(round_type, culture=False):
        return POOL
    monkeypatch.setattr(selection, "load_pool", pool)
    args = dict(round_type="dsa", company="salescode", exclusions=[], max_difficulty="medium")
    args.update(kw)
    return asyncio.run(practice.suggest(gaps, **args))


def test_bank_tags_are_matched_exactly_not_the_phrase(monkeypatch):
    out = go([gap("Handling being stuck while thinking about dynamic programming", ["Sliding Window"])], monkeypatch)
    (got,) = out.values()
    assert {p["slug"] for p in got} == {"win", "win2"}                      # the phrase says DP; the chosen tag wins


def test_most_specific_tag_first(monkeypatch):
    out = go([gap("x", ["Longest Increasing Subsequence", "Dynamic Programming"])], monkeypatch)
    assert slugs(out, "x")[0] == "lis"


def test_empty_bank_tags_and_non_coding_subjects_get_no_practice(monkeypatch):
    out = go([gap("Staying calm when stuck", []), gap("Thinking aloud", None, subject="Interview habits"),
              gap("Explaining trade-offs", None, subject="Communication"), gap("Dynamic programming", None)], monkeypatch)
    assert out["Staying calm when stuck"] == [] and out["Thinking aloud"] == [] and out["Explaining trade-offs"] == []
    assert out["Dynamic programming"]                                       # missing tags: the phrase logic still works


def test_tags_missing_from_the_bank_fall_through_to_the_phrase(monkeypatch):
    out = go([gap("Sliding window technique", ["Totally Unknown Tag"])], monkeypatch)
    assert {p["slug"] for p in out["Sliding window technique"]} & {"win", "win2"}


def test_abandoned_gaps_carry_the_problems_own_tags():
    class P:
        slug, family, title, topics, swapped, part_id = "s", "dsa", "T", ["Graph theory descriptive topic"], True, "p"
        reference = {"bank_tags": ["Graph", "Not In Vocab"]}
    import app.evaluation.report as report
    report_parts = [P()]
    orig = report._abandoned
    report._abandoned = lambda parts: parts
    try:
        assert abandoned_gaps(report_parts, ["Graph", "Array"])[0]["topics"] == [
            {"topic": "Graph theory descriptive topic", "bank_tags": ["Graph"]}]          # the problem's real tags, validated, not its topic names
    finally:
        report._abandoned = orig


def test_vocabulary_is_frequency_ordered_deduped_and_capped(monkeypatch):
    async def pool(round_type, culture=False):
        return [{"slug": str(i), "topic_tags": ["Dynamic Programming" if i % 3 else "dynamic programming", "Array"], "patterns_tested": ["Memoization"]}
                for i in range(6)] + [{"slug": "x", "topic_tags": ["Graph"]}]
    monkeypatch.setattr(selection, "load_pool", pool)
    v = practice.tag_vocabulary(asyncio.run(practice.load_bank("dsa")))
    assert set(v[:3]) == {"Dynamic Programming", "Array", "Memoization"}
    assert v[-1] == "Graph" and len(v) == 4
    assert len(practice.tag_vocabulary(asyncio.run(practice.load_bank("dsa")), cap=2)) == 2


def test_clean_bank_tags_drops_unknown_case_insensitively():
    assert graders.clean_bank_tags(["sliding window", "Nope", "ARRAY", "sliding window"], VOCAB) == ["Sliding Window", "Array"]
    assert graders.clean_bank_tags([], VOCAB) == []
    assert graders.clean_bank_tags(None, VOCAB) is None and graders.clean_bank_tags(["Array"], []) is None


def test_question_topic_bank_tags_flow_from_grader_output_into_practice(monkeypatch):
    r = reply()
    r["questions"][0]["topics"] = [{"subject": "DSA", "topic": "Window problems", "bank_tags": ["sliding window", "Nope"]},
                                   {"subject": "Behavioural", "topic": "Staying calm", "bank_tags": []}]
    chat = FakeChat([r])
    g = asyncio.run(graders.grade_part(chat, part(), meta(), "A", vocab=VOCAB))
    tags = {t.topic: t.bank_tags for t in g.questions[0].topics}
    assert tags == {"Window problems": ["Sliding Window"], "Staying calm": []}
    assert "Tags: Dynamic Programming | Sliding Window" in chat.calls[0][-1]["content"]
    gaps = [{"subject": "DSA", "topics": [{"topic": "Window problems", "why": "w", "bank_tags": tags["Window problems"]}]}]
    assert {p["slug"] for p in go(gaps, monkeypatch)["Window problems"]} == {"win", "win2"}


def test_synthesis_gap_tags_are_validated_and_the_prompt_lists_the_vocabulary():
    base = {"summary": "s", "interviewer_note": "n", "focus": [{"title": "t", "why": "w", "turn_ids": [2]}],
            "end_questions": {"quality": "none", "bonus": 0, "note": "n"},
            "topic_gaps": [{"subject": "DSA", "topics": [{"topic": "t", "why": "w", "bank_tags": ["array", "Fake"]}]}]}
    chat = FakeChat([base])
    s = asyncio.run(graders.synthesize(chat, [part()], {}, DeliveryStats([], [], {}, [], 0), meta(), VOCAB))
    assert s.topic_gaps[0].topics[0].bank_tags == ["Array"]
    assert "Bank tags for practice" in chat.calls[0][-1]["content"]
    assert prompts.vocab_block(None) == ""


def test_schema_sent_to_the_model_requires_bank_tags_but_stored_docs_may_omit_it():
    captured = {}

    class Chat(FakeChat):
        async def json(self, messages, schema_name, schema, max_tokens=3000):
            captured[schema_name] = schema
            return await super().json(messages, schema_name, schema, max_tokens)

    asyncio.run(graders.grade_part(Chat([reply()]), part(), meta(), "A", vocab=VOCAB))
    assert "bank_tags" in captured["part_grade"]["$defs"]["TopicRef"]["required"]
    assert captured["part_grade"]["$defs"]["TopicRef"]["properties"]["bank_tags"]["type"] == "array"
    from app.evaluation.models import GapTopic, Synthesis
    assert GapTopic.model_validate({"topic": "t", "why": "w"}).bank_tags is None            # old docs still load
    base = {"summary": "s", "interviewer_note": "n", "focus": [{"title": "t", "why": "w", "turn_ids": [2]}],
            "end_questions": {"quality": "none", "bonus": 0, "note": "n"}, "topic_gaps": []}
    asyncio.run(graders.synthesize(Chat([base]), [part()], {}, DeliveryStats([], [], {}, [], 0), meta(), VOCAB))
    assert "bank_tags" in captured["round_synthesis"]["$defs"]["GapTopic"]["required"]
    assert "bank_tags is required" in prompts.vocab_block(VOCAB)


def _graded(tags_by_topic):
    from app.evaluation.models import PartGrade
    r = reply()
    r["questions"][0]["topics"] = [{"subject": "DSA", "topic": t, "bank_tags": tags} for t, tags in tags_by_topic.items()]
    return {"p1": PartGrade.model_validate(r)}


def test_gaps_without_tags_inherit_from_the_best_matching_question_topic():
    from app.evaluation.models import GapTopic, TopicGap
    from app.evaluation.report import inherit_bank_tags
    merged = _graded({"Sliding window on subarrays": ["Sliding Window"], "LIS recurrence": ["Longest Increasing Subsequence", "Dynamic Programming"]})
    gaps = [TopicGap(subject="DSA", topics=[GapTopic(topic="When sliding window applies to subarrays", why="w"),
                                            GapTopic(topic="Unrelated words entirely", why="x"),
                                            GapTopic(topic="Keep me", why="w", bank_tags=["Array"]),
                                            GapTopic(topic="No practice", why="w", bank_tags=[])]),
            TopicGap(subject="Behavioural", topics=[GapTopic(topic="Staying calm", why="w")])]
    inherit_bank_tags(gaps, [part()], merged, ["Array", "Dynamic Programming", "Sliding Window", "Longest Increasing Subsequence"])
    t = gaps[0].topics
    assert t[0].bank_tags == ["Sliding Window"]                     # word overlap picks the sliding-window question
    assert set(t[1].bank_tags) == {"Sliding Window", "Longest Increasing Subsequence", "Dynamic Programming"}   # no overlap: the main question's tags, max 3
    assert t[2].bank_tags == ["Array"] and t[3].bank_tags == []     # explicit values stay
    assert gaps[1].topics[0].bank_tags is None                      # behavioural: nothing to inherit


R27_POOL = [
    {"slug": "lis", "title": "LIS", "difficulty": "medium", "topic_tags": ["Longest Increasing Subsequence", "Dynamic Programming", "Binary Search"]},
    {"slug": "is-subsequence", "title": "Is Subsequence", "difficulty": "easy", "topic_tags": ["Dynamic Programming", "Binary Search", "Two Pointers"]},
    {"slug": "intersection", "title": "Intersection", "difficulty": "medium", "topic_tags": ["Binary Search", "Hash Table", "Two Pointers", "Sort"]},
    {"slug": "hard-dpbs", "title": "Hard DP BS", "difficulty": "hard", "topic_tags": ["Dynamic Programming", "Binary Search"]},
    {"slug": "win", "title": "Window", "difficulty": "medium", "topic_tags": ["Sliding Window"]},
    {"slug": "other", "title": "Other", "difficulty": "easy", "topic_tags": ["Graph"]},
]


def go27(gaps, monkeypatch, **kw):
    async def pool(round_type, culture=False):
        return R27_POOL
    monkeypatch.setattr(selection, "load_pool", pool)
    args = dict(round_type="dsa", company="x", exclusions=["lis"], max_difficulty="medium",
                sources={"t": Source(topics={"dynamic-programming", "binary-search"}, mapped=True)})
    args.update(kw)
    return asyncio.run(practice.suggest(gaps, **args))


def test_lis_tails_case_suggests_only_problems_sharing_two_tags_with_the_topic_and_source(monkeypatch):
    out = go27([gap("t", ["Longest Increasing Subsequence", "Binary Search"])], monkeypatch,
               sources={"t": Source(topics={"dynamic-programming", "binary-search"}, mapped=True,
                                    tags={"Longest Increasing Subsequence", "Dynamic Programming", "Binary Search"})})
    assert [p["slug"] for p in out["t"]] == ["is-subsequence"]                       # no Intersection (one shared tag); the hard one only
    # when nothing at or below the level qualifies
    only_hard = go27([gap("t", ["Longest Increasing Subsequence", "Binary Search"])], monkeypatch, exclusions=["lis", "is-subsequence"],
                     sources={"t": Source(topics={"dynamic-programming", "binary-search"}, mapped=True,
                                    tags={"Longest Increasing Subsequence", "Dynamic Programming", "Binary Search"})})
    assert [(p["slug"], p["difficulty"]) for p in only_hard["t"]] == [("hard-dpbs", "hard")]


def test_single_tag_topic_sharing_that_tag_is_enough(monkeypatch):
    out = go27([gap("t", ["Sliding Window"])], monkeypatch)
    assert [p["slug"] for p in out["t"]] == ["win"]


def test_a_topic_with_no_qualifying_problem_gets_fewer_never_filler(monkeypatch):
    # LIS is the only holder of the specific tag (and excluded); a lone Binary Search overlap is not enough without a source
    out = go27([gap("t", ["Longest Increasing Subsequence", "Hash Table"])], monkeypatch, sources=None)
    assert out["t"] == []
    out = go27([gap("t", ["Longest Increasing Subsequence", "Binary Search"])], monkeypatch, sources=None)
    assert [p["slug"] for p in out["t"]] == []                                       # one shared tag, specific tag held by one problem


def test_report_topic_gaps_include_bank_tags():
    from app.evaluation.models import GapTopic, Synthesis, TopicGap
    from app.evaluation.report import _gaps
    syn = Synthesis.model_validate({"summary": "s", "interviewer_note": "n", "focus": [], "end_questions": {"quality": "none", "bonus": 0, "note": ""},
                                    "topic_gaps": [{"subject": "DSA", "topics": [{"topic": "t", "why": "w", "bank_tags": ["Array"]}]}]})
    assert _gaps(syn, [], {})[0]["topics"][0]["bank_tags"] == ["Array"]


def _lis_part():
    return part(slug="lis", title="Longest Increasing Subsequence", topics=["Dynamic programming over indices"],
                reference={"title": "LIS", "difficulty": "medium", "bank_tags": ["Longest Increasing Subsequence", "Dynamic Programming", "Binary Search"]})


def test_a_reworded_gap_phrase_still_gets_the_source_problems_raw_tags():
    from app.evaluation.models import PartGrade
    from app.evaluation.report import source_maps
    r = reply(verdict="partly")
    r["questions"][0]["asked"] = "longest increasing subsequence"
    r["questions"][0]["topics"] = [{"subject": "DSA", "topic": "Dynamic programming state for the subsequence", "bank_tags": ["Dynamic Programming"]}]
    parts, merged = [_lis_part()], {"p1": PartGrade.model_validate(r)}
    phrase = "Longest increasing subsequence tails with binary search"                                      # not the question topic's text
    info = source_maps([("DSA", phrase, "w")], parts, merged)[phrase]
    assert info.slug == "lis" and info.mapped and "Binary Search" in info.tags and info.difficulty == "medium"      # via the asked text overlap
    assert source_maps([("DSA", "Cache invalidation", "x")], parts, merged)["Cache invalidation"].slug == "lis"   # the round's only problem
    two = [*parts, part(part_id="p2", slug="g", topics=["Graph"], reference={"difficulty": "hard", "bank_tags": ["Graph"]})]
    other = source_maps([("DSA", "Cache invalidation", "x")], two, merged)["Cache invalidation"]
    assert other.slug is None and not other.mapped and {"Longest Increasing Subsequence", "Graph"} <= other.tags   # no mapping: the round-wide union


def test_reworded_gap_uses_source_tags_in_practice(monkeypatch):
    out = go27([gap("LIS tails", ["Longest Increasing Subsequence", "Binary Search"])], monkeypatch,
               sources={"LIS tails": Source(slug="lis", mapped=True)})
    assert [p["slug"] for p in out["LIS tails"]] == ["is-subsequence"]                      # raw tags read from the (excluded) source in the bank


def test_failed_main_problem_is_retried_first_once_on_its_best_gap():
    from app.evaluation.models import PartGrade, Synthesis
    from app.evaluation.report import _gaps
    r = reply(verdict="wrong")
    r["questions"][0]["asked"] = "longest increasing subsequence"
    r["questions"][0]["topics"] = [{"subject": "DSA", "topic": "Longest increasing subsequence recurrence"},
                                   {"subject": "DSA", "topic": "Longest increasing subsequence tails"}]
    syn = Synthesis.model_validate({"summary": "s", "interviewer_note": "n", "focus": [], "end_questions": {"quality": "none", "bonus": 0, "note": ""},
                                    "topic_gaps": [{"subject": "DSA", "topics": [
                                        {"topic": "Longest increasing subsequence recurrence", "why": "w", "bank_tags": ["Dynamic Programming"]},
                                        {"topic": "Longest increasing subsequence tails", "why": "w", "bank_tags": ["Binary Search"]}]}]})
    practice_map = {"Longest increasing subsequence recurrence": [{"slug": "a", "title": "A", "difficulty": "easy"}],
                    "Longest increasing subsequence tails": [{"slug": "lis", "title": "x", "difficulty": "easy"}]}
    gaps = _gaps(syn, [_lis_part()], practice_map, {"p1": PartGrade.model_validate(r)})
    tops = gaps[0]["topics"]
    retries = [(t["topic"], t["practice"][0]) for t in tops if t["practice"] and t["practice"][0].get("retry")]
    assert len(retries) == 1 and retries[0][1]["slug"] == "lis"                             # one entry, and not duplicated in a second list
    assert sum(1 for t in tops for x in t["practice"] if x["slug"] == "lis") == 1
    ok = _gaps(syn, [_lis_part()], practice_map, {"p1": PartGrade.model_validate(reply(verdict="correct"))})
    assert not any(x.get("retry") for t in ok[0]["topics"] for x in t["practice"])


def test_malformed_bank_tags_never_fail_grading():
    r = reply()
    r["questions"][0]["topics"] = [{"subject": "DSA", "topic": "a", "bank_tags": "Dynamic Programming"},
                                   {"subject": "DSA", "topic": "b", "bank_tags": [1, "DP", " DP ", None]},
                                   {"subject": "DSA", "topic": "c", "bank_tags": {"x": 1}}]
    g = asyncio.run(graders.grade_part(FakeChat([r]), part(), meta(), "A", vocab=["Dynamic Programming", "DP"]))
    tags = {t.topic: t.bank_tags for t in g.questions[0].topics}
    assert tags == {"a": ["Dynamic Programming"], "b": ["DP"], "c": None}
    from app.evaluation.models import GapTopic
    assert GapTopic.model_validate({"topic": "t", "why": "w", "bank_tags": "Array"}).bank_tags == ["Array"]


def test_unmapped_gap_never_earns_the_harder_problem(monkeypatch):
    tags = {"Longest Increasing Subsequence", "Dynamic Programming", "Binary Search"}
    topics = {"dynamic-programming", "binary-search"}
    ask = gap("t", ["Longest Increasing Subsequence", "Binary Search"])
    kw = dict(exclusions=["lis", "is-subsequence"])
    mapped = go27([ask], monkeypatch, sources={"t": Source(topics=topics, tags=tags, mapped=True)}, **kw)
    assert [p["slug"] for p in mapped["t"]] == ["hard-dpbs"]
    unmapped = go27([ask], monkeypatch, sources={"t": Source(topics=topics, tags=tags, mapped=False)}, **kw)
    assert unmapped["t"] == []                                           # the round-wide source still sets the bar, but gives no exception


def test_vocabulary_goes_only_to_problem_family_parts(monkeypatch):
    seen = []
    orig = prompts.part_messages

    def spy(part_, meta_, variant, prior=None, pastes=None, profile=None, vocab=None):
        seen.append((part_.family, vocab))
        return orig(part_, meta_, variant, prior, pastes, profile, vocab)

    monkeypatch.setattr(prompts, "part_messages", spy)
    for family in ("dsa", "knowledge"):
        try:
            asyncio.run(graders.grade_part(FakeChat([reply()] * 3), part(family=family), meta(), "A", vocab=VOCAB))
        except Exception:  # noqa: BLE001 - the grade itself is not under test, only the prompt input
            pass
    assert dict(seen) == {"dsa": VOCAB, "knowledge": None}
