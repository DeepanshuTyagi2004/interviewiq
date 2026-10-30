"""Parsers for the design sources added 2026-10-30 (shapes copied from the live files)."""
from app.questions.collectors import lld, system_design as sd


def test_awesome_lld_titles_keep_the_source_article():
    files = {"problems/parking-lot.md": b"# Designing a Parking Lot System\n\n## Requirements\n",
             "problems/splitwise.md": b"# Designing Splitwise\n",
             "problems/pub-sub-system.md": b"# Designing a Pub-Sub System in Java\n",
             "solutions/java/x.md": b"# not a problem\n", "README.md": b"# Awesome LLD\n"}
    items = lld.enumerate_awesome_lld(files)
    assert [i["title"] for i in items] == ["Design a Parking Lot System", "Design a Pub-Sub System", "Design Splitwise"]
    assert items[0]["url"].endswith("/problems/parking-lot.md")


def test_checkcheckzz_reads_only_the_hot_questions():
    text = ("### [[⬆]](#toc) <a name='tips'>System Design Interview Tips:</a>\n**Clarify the constraints**\n"
            "### [[⬆]](#toc) <a name='qs'>Hot Questions and Reference:</a>\n\n"
            "**Design a CDN network**  \nReference:  \n* [x](http://x)\n\n**Design a tinyurl system**    \n"
            "### [[⬆]](#toc) <a name='bk'>Good Books:</a>\n**Design nothing here**\n")
    assert [i["title"] for i in sd._parse_checkcheckzz_readme(text)] == ["Design a CDN network", "Design a tinyurl system"]


def test_grokking_summary_reads_the_designs_list():
    text = ("* [Contents](README.md)\n\n* Basics\n  - [Caching](basics/caching.md)\n\n"
            "* Designs\n  - [Short URL Service](designs/short-url.md)\n  - [Ticketmaster](designs/ticketmaster.md)\n")
    items = sd._parse_grokking_summary(text)
    assert [i["title"] for i in items] == ["Design Short URL Service", "Design Ticketmaster"]
    assert items[1]["url"].endswith("/designs/ticketmaster.md")
