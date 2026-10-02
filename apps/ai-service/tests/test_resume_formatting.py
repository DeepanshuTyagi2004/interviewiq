"""Formatting-preserving extraction: bold runs become **…** and indentation becomes leading spaces,
so the parser can return each role's lines in the resume's own Markdown structure."""
from pathlib import Path

from app.models.resume import Experience, Project
from app.resume.extract import extract_text, render_segments

FIXTURE = Path(__file__).parent / "fixtures" / "formatted_resume.pdf"


def test_bold_runs_are_wrapped_in_markdown():
    text = extract_text(FIXTURE.read_bytes())
    assert "Built a **voice ordering agent** handling **10k+ calls/day** with LiveKit and Deepgram." in text
    assert "latency by **42%** by streaming" in text
    assert "**AI Sales Agent**" in text
    assert "** **" not in text and "****" not in text


def test_indentation_levels_become_leading_spaces():
    lines = extract_text(FIXTURE.read_bytes()).splitlines()
    by_start = {line.strip()[:12]: line for line in lines}
    assert by_start["**AI Sales A"].startswith("**")            # sub-heading at the left margin
    assert by_start["Built a **vo"].startswith("  Built")        # bullet: one level in
    assert by_start["Added a **ba"].startswith("    Added")      # nested bullet: two levels in
    assert by_start["**Experience"].startswith("**")             # section heading not indented


def test_render_segments_merges_runs_and_keeps_spaces_outside_markers():
    segs = [("Cut by ", False), ("4", True), ("2%", True), (" overall ", False)]
    assert render_segments(segs) == "Cut by **42%** overall"
    assert render_segments([("  ", True), ("Bold heading", True)]) == "**Bold heading**"
    assert render_segments([("plain", False)]) == "plain"


def test_bullet_lines_keep_their_indentation_but_drop_blanks():
    exp = Experience(bullets=["**AI Sales Agent**", "- Built it  ", "  - nested", "   ", None])
    assert exp.bullets == ["**AI Sales Agent**", "- Built it", "  - nested"]
    proj = Project(bullets="- only one")
    assert proj.bullets == ["- only one"]


# --- restoring nesting the LLM flattened -------------------------------------------------------

from app.models.resume import ParsedResume  # noqa: E402
from app.resume.formatting import restore_nesting  # noqa: E402


def _flat_llm_output() -> ParsedResume:
    """What the model actually returns: bold and bullets right, nesting flattened."""
    return ParsedResume(
        experience=[{
            "company": "Salescode.ai",
            "bullets": [
                "**AI Sales Agent**",
                "- Built a **voice ordering agent** handling **10k+ calls/day** with LiveKit and Deepgram.",
                "- Cut median response latency by **42%** by streaming LLM tokens to TTS.",
                "- Added a **barge-in** detector so callers can interrupt.",
                "**SFA Flutter Apps**",
                "- Shipped offline-first sync for **3 field-sales apps** used by 2,000 reps.",
            ],
        }],
        projects=[{"name": "Relay", "bullets": ["- Designed a WebSocket protocol that reduced token usage by **72%**."]}],
    )


def test_restore_nesting_reapplies_source_indentation():
    source = extract_text(FIXTURE.read_bytes())
    fixed = restore_nesting(_flat_llm_output(), source)
    bullets = fixed.experience[0].bullets
    assert bullets[3] == "  - Added a **barge-in** detector so callers can interrupt."
    assert bullets[1].startswith("- Built")           # top-level bullets stay top-level
    assert bullets[0] == "**AI Sales Agent**"          # sub-headings untouched
    assert fixed.projects[0].bullets == ["- Designed a WebSocket protocol that reduced token usage by **72%**."]


def test_restore_nesting_leaves_unmatched_lines_as_the_model_wrote_them():
    parsed = ParsedResume(experience=[{"bullets": ["- Something the source never says", "  - kept nested"]}])
    assert restore_nesting(parsed, "unrelated text").experience[0].bullets == [
        "- Something the source never says",
        "  - kept nested",
    ]
