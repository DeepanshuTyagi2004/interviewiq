from app.research.drafts import flatten_snapshot, snapshot_diff
from app.research.models import field, unavailable

V1 = {"identity": {
    "name": field("Meesho", confidence="high", provenance="evidence"),
    "website": unavailable(),
    "aliases": field(["Fashnear"], confidence="medium", provenance="evidence"),
}}


def test_flatten_reads_field_values_by_dotted_path():
    assert flatten_snapshot(V1) == {
        "identity.aliases": ["Fashnear"], "identity.name": "Meesho", "identity.website": None,
    }


def test_flatten_keys_role_lists_by_role_key():
    snap = {"roles": [{"role_key": "sde1-backend", "title": field("SDE I", confidence="high", provenance="evidence")}]}
    assert flatten_snapshot(snap) == {"roles[sde1-backend].title": "SDE I"}


def test_first_draft_is_all_additions():
    assert snapshot_diff(None, V1) == [
        {"path": "identity.aliases", "change": "added", "before": None, "after": ["Fashnear"]},
        {"path": "identity.name", "change": "added", "before": None, "after": "Meesho"},
        {"path": "identity.website", "change": "added", "before": None, "after": None},
    ]


def test_changes_and_removals_compare_values_not_metadata():
    v2 = {"identity": {
        "name": field("Meesho", confidence="low", provenance="derived"),     # same value: no change
        "website": field("https://meesho.com", confidence="high", provenance="evidence"),
    }}
    assert snapshot_diff(V1, v2) == [
        {"path": "identity.aliases", "change": "removed", "before": ["Fashnear"], "after": None},
        {"path": "identity.website", "change": "changed", "before": None, "after": "https://meesho.com"},
    ]


def test_identical_snapshots_have_no_diff():
    assert snapshot_diff(V1, V1) == []


def test_unverified_claims_are_review_material_not_changes():
    before = {"profile": {"sector": field("fintech", confidence="low", provenance="evidence"), "unverified": []},
              "roles": [{"role_key": "sde", "title": field("SDE", confidence="low", provenance="evidence"), "unverified": []}]}
    after = {"profile": {"sector": field("fintech", confidence="low", provenance="evidence"),
                         "unverified": [{"field": "hq", "value": "Pune", "reason": "geo_unconfirmed"}]},
             "roles": [{"role_key": "sde", "title": field("SDE", confidence="low", provenance="evidence"),
                        "unverified": [{"field": "jd", "value": "x", "reason": "role_not_in_context"}]}]}
    assert snapshot_diff(before, after) == []
