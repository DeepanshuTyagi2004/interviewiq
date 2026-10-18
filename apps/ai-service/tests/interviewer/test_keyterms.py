"""The Deepgram keyterms built from a session's context: names only, de-duplicated, capped, and never an error."""
from app.interviewer.keyterms import MAX_TERMS, MAX_TERM_CHARS, stt_keyterms

CONTEXT = {"first_name": "Deepanshu Tyagi", "email": "someone@example.com", "candidate_id": "c-123",
           "round": {"company_name": "Salescode", "company": "salescode", "role": "Software Engineer"},
           "profile": {"projects": ["Relay - a CLI for command history", "Vibe (UI generator)", "Split app", {"name": "Hisaab"}],
                       "skills": ["Java", "C++", "Node.js", "react", "React"], "headline": "Backend engineer who writes a lot of long words"}}


def test_the_keyterms_are_the_names_in_the_round_most_useful_first_with_no_duplicates():
    terms = stt_keyterms(CONTEXT, {"persona": {"name": "Ashwin Kumar"}})
    assert terms[:6] == ["Deepanshu", "Ashwin", "Salescode", "Relay", "Vibe", "Split app"]
    assert "Hisaab" in terms and "C++" in terms and "Node.js" in terms
    assert sum(1 for t in terms if t.lower() == "react") == 1 and sum(1 for t in terms if t.lower() == "salescode") == 1


def test_nothing_secret_or_long_is_a_keyterm():
    terms = stt_keyterms({**CONTEXT, "profile": {"projects": ["x" * 80, "A project with far too many words in its name"], "skills": ["", None]}})
    assert not any("@" in t or "c-123" in t or "Software Engineer" in t for t in terms)
    assert all(len(t) <= MAX_TERM_CHARS for t in terms) and terms == ["Deepanshu", "Salescode"]


def test_the_list_is_capped_and_a_strange_context_gives_an_empty_list_not_an_error():
    many = {"profile": {"skills": [f"Skill{n}" for n in range(100)]}}
    assert len(stt_keyterms(many)) == MAX_TERMS
    assert stt_keyterms({}) == [] and stt_keyterms({"profile": "x", "round": None}) == []
