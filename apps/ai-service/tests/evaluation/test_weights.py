import pytest
from pydantic import ValidationError

from app.evaluation.models import QuestionGrade
from app.evaluation.weights import FAMILIES, areas_for


def test_weights_sum_to_100():
    for fam, areas in FAMILIES.items():
        assert sum(a.weight for a in areas) == 100, fam


@pytest.mark.parametrize(
    "fam,share",
    [("dsa", 70), ("system-design", 50), ("lld", 55), ("hiring-manager", 50), ("online-assessment", 75)],
)
def test_practical_share(fam, share):
    assert sum(a.weight for a in FAMILIES[fam] if a.practical) == share


def test_total_areas():
    pairs = {(f, a.key) for f, areas in FAMILIES.items() if f != "knowledge" for a in areas}
    assert len(pairs) == 34


def test_amazon_label():
    areas = {a.key: a for a in areas_for("behavioural", "Amazon")}
    assert areas["company_values"].label == "Leadership Principles"
    assert {a.key: a for a in areas_for("behavioural", "Google")}["company_values"].label != "Leadership Principles"


def test_communication_anchor_and_bounds():
    comm = next(a for a in FAMILIES["dsa"] if a.key == "communication")
    assert "never judge accent, grammar or English fluency" in comm.anchors
    with pytest.raises(ValidationError):
        QuestionGrade(id="q", asked="x", verdict="correct", score=11, strong_answer="", gap="")
