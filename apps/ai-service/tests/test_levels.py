"""Run: python -m tests.test_levels"""
from app.levels import classify, match_tier, is_on_level


def test_classify_keywords():
    assert classify("Software Intern") == ("entry", "intern")
    assert classify("fresher / campus") == ("entry", "fresher")
    assert classify("Associate Software Engineer") == ("entry", "sde1")
    assert classify("SDE-2") == ("mid", "sde2")
    assert classify("Senior Software Engineer") == ("senior", "sde3")
    assert classify("Staff Engineer") == ("senior", "staff")
    assert classify(None) == ("unknown", None)
    assert classify("") == ("unknown", None)
    assert classify("software engineer") == ("unknown", None)   # no rung stated -> never guessed


def test_classify_years():
    assert classify("1 year of experience") == ("entry", "sde1")
    assert classify("3 years at Juspay") == ("mid", "sde2")     # the report's cross-level offender
    assert classify("4 years experience") == ("senior", "sde3")
    assert classify("~6 years") == ("senior", "staff")


def test_match_tier_fresher():
    assert match_tier("fresher", "fresher") == "exact"
    assert match_tier("fresher", "sde1") == "exact"             # full-time entry interchangeable
    assert match_tier("fresher", "intern") == "adjacent"        # intern != fresher (report finding)
    assert match_tier("fresher", None) == "unknown"             # null is NOT a match (was the bug)
    assert match_tier("fresher", "SDE-2") == "off"
    assert match_tier("fresher", "3 years at Juspay") == "off"  # mid under fresher -> excluded


def test_match_tier_sde2_sde3():
    assert match_tier("sde2", "SDE-2") == "exact"
    assert match_tier("sde2", "senior") == "off"                # senior under sde2 -> excluded
    assert match_tier("sde2", "3 years at Juspay") == "exact"   # 3yr == mid == sde2
    assert match_tier("sde3", "senior") == "exact"              # senior == sde3-equiv
    assert match_tier("sde3", "Staff Engineer") == "adjacent"   # staff above sde3, same bucket
    assert match_tier("sde3", "3 years at Juspay") == "off"     # mid under sde3 -> excluded


def test_is_on_level():
    assert is_on_level("exact") and is_on_level("adjacent")
    assert not is_on_level("unknown") and not is_on_level("off")


if __name__ == "__main__":
    test_classify_keywords()
    test_classify_years()
    test_match_tier_fresher()
    test_match_tier_sde2_sde3()
    test_is_on_level()
    print("ok")
