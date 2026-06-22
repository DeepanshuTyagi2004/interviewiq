from app.questions.collectors.design import load_seed_questions
from app.models.brief import RoundType


def test_sd_seed_record():
    data = [{"slug": "design-url-shortener", "title": "Design a URL Shortener",
             "url": "https://github.com/donnemartin/system-design-primer/.../pastebin/README.md",
             "source": "system-design-primer", "category": "web-service"}]
    recs = load_seed_questions(data, RoundType.SYSTEM_DESIGN)
    assert recs[0].slug == "sdp/design-url-shortener"  # source-prefixed (Spec §2)
    assert recs[0].round_type == RoundType.SYSTEM_DESIGN
    assert recs[0].sources == ["system-design-primer"]
    assert recs[0].enrichment_status == "raw"


def test_lld_seed_machine_coding_flag():
    data = [{"slug": "design-bookmyshow", "title": "Design BookMyShow",
             "url": "https://github.com/prasadgujar/.../BookMyShow.md",
             "source": "lld-primer", "is_machine_coding": True}]
    recs = load_seed_questions(data, RoundType.LLD)
    assert recs[0].slug == "lldp/design-bookmyshow"
    assert recs[0].is_machine_coding is True
