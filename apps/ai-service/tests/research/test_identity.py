import pytest

from app.research.normalize.identity import domain_of, find_possible_duplicates, name_key, slugify

# Mirrored verbatim in apps/api/test/domain/slug.test.ts. A slug is the join key between Postgres
# rows, briefs and fixture folders, so both languages must agree exactly.
SLUG_CASES = [
    ("Meesho", "meesho"),
    ("  Big   Co ", "big-co"),
    ("Tata Consultancy Services (TCS)", "tata-consultancy-services-tcs"),
    ("AT&T", "at-and-t"),
    ("Café Coffee Day", "cafe-coffee-day"),
    ("Straße Labs", "strae-labs"),
]


@pytest.mark.parametrize("name,expected", SLUG_CASES)
def test_slugify_matches_the_api(name, expected):
    assert slugify(name) == expected


@pytest.mark.parametrize("a,b", [
    ("Amazon India", "Amazon"),
    ("Infosys Limited", "Infosys"),
    ("Zoho Corporation Pvt. Ltd.", "Zoho"),
    ("Meesho", "MEESHO"),
])
def test_name_key_ignores_case_punctuation_and_corporate_suffixes(a, b):
    assert name_key(a) == name_key(b)


def test_name_key_keeps_at_least_one_word():
    assert name_key("Services") == "services"


@pytest.mark.parametrize("url,expected", [
    ("https://www.meesho.com/about", "meesho.com"),
    ("meesho.com", "meesho.com"),
    ("HTTP://Careers.Razorpay.com", "careers.razorpay.com"),
    ("", None),
    (None, None),
])
def test_domain_of(url, expected):
    assert domain_of(url) == expected


def test_duplicates_by_name_alias_or_website():
    others = [
        {"id": "a", "name": "Amazon", "website": None, "aliases": []},
        {"id": "b", "name": "Fashnear", "website": "https://www.meesho.com", "aliases": []},
        {"id": "c", "name": "Unrelated", "website": "https://other.com", "aliases": ["Other Co"]},
    ]
    found = find_possible_duplicates({"name": "Amazon India", "website": "https://meesho.com", "aliases": []}, others)
    assert found == [
        {"type": "possible_duplicate", "company_id": "a", "company_name": "Amazon", "reasons": ["name"]},
        {"type": "possible_duplicate", "company_id": "b", "company_name": "Fashnear", "reasons": ["website"]},
    ]


def test_no_duplicates_when_nothing_matches():
    assert find_possible_duplicates({"name": "Meesho", "website": None, "aliases": []},
                                    [{"id": "x", "name": "Razorpay", "website": None, "aliases": []}]) == []


@pytest.mark.parametrize("bad", ["http://[bad", "https://[::1"])
def test_domain_of_returns_none_for_malformed_urls(bad):
    assert domain_of(bad) is None
