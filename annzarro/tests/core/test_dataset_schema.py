"""The versioned schema of uns["annzarro"]: marker, tolerant reading, simple and rich forms, one reader per major."""
import os
import re

import pytest

from annzarro.core import dataset_schema as schema

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


def read(tree):
    return schema.normalise(tree)


# --- the marker ---------------------------------------------------------------------------------

def test_no_marker_is_version_1_and_the_marker_keys_are_not_unknown():
    bare = read({"title": "T"})
    assert bare["schema"] == {"name": schema.SCHEMA_NAME, "version": "1.0", "declared": False, "newer": None, "reader": 1, "note": None}
    marked = read({"schema": schema.SCHEMA_NAME, "schema_version": "1.0", "title": "T"})
    assert marked["schema"]["declared"] is True and marked["unknown"] == [] and marked["fields"] == {"title": "T"}


@pytest.mark.parametrize("written,parsed", [("1", (1, 0)), ("1.0", (1, 0)), ("1.12", (1, 12)), (" 2.1 ", (2, 1)), (1, (1, 0)), (1.5, (1, 5))])
def test_versions_are_read_as_text_or_number(written, parsed):
    assert schema.parse_version(written) == parsed


@pytest.mark.parametrize("bad", ["", "x", "1.2.3", "0.9", "-1", True, None, [1], {"a": 1}, "1.a"])
def test_a_version_that_is_not_one_is_ignored_and_read_as_1(bad):
    got = read({"schema_version": bad, "title": "T"})
    assert got["schema"]["version"] == "1.0" and got["schema"]["declared"] is False
    assert got["ignored"] == ["schema_version"] and got["fields"]["title"] == "T"


def test_a_different_schema_name_is_noted_not_refused():
    got = read({"schema": "someone.else", "schema_version": "1.0", "title": "T"})
    assert "someone.else" in got["schema"]["note"] and got["fields"]["title"] == "T"


# --- tolerance ----------------------------------------------------------------------------------

def test_unknown_keys_are_listed_and_never_an_error():
    got = read({"title": "T", "telemetry": "x", "nested": {"a": {"b": 1}}, "views": [1, 2]})
    assert got["fields"] == {"title": "T"} and got["unknown"] == ["nested", "telemetry", "views"] and got["ignored"] == []


def test_a_newer_minor_reads_everything_it_knows_without_a_note():
    got = read({"schema_version": "1.7", "title": "T", "license": "MIT", "future_block": {"x": "y"}})
    assert got["schema"]["newer"] == "minor" and got["schema"]["note"] is None and got["schema"]["reader"] == 1
    assert got["fields"]["title"] == "T" and got["unknown"] == ["future_block"]


def test_a_newer_major_is_read_by_the_newest_reader_and_says_so():
    got = read({"schema_version": "2.0", "title": "T", "licence_text": "renamed", "authors": ["A"]})
    assert got["schema"]["newer"] == "major" and got["schema"]["reader"] == 1
    assert "newer AnnZarro" in got["schema"]["note"] and "2.0" in got["schema"]["note"]
    assert got["fields"] == {"title": "T", "authors": ["A"]} and got["unknown"] == ["licence_text"]


def test_there_is_one_reader_per_major_version(monkeypatch):
    def v2(tree):
        return {"title": f"v2:{tree.get('name')}"}, {"name"}, []
    monkeypatch.setitem(schema.READERS, 2, v2)
    got = read({"schema_version": "2.3", "name": "N", "other": 1})
    assert got["fields"] == {"title": "v2:N"} and got["schema"]["reader"] == 2 and got["schema"]["newer"] is None
    assert got["unknown"] == ["other"]
    assert read({"title": "T"})["schema"]["reader"] == 1, "version 1 is still read by the version 1 reader"
    monkeypatch.setitem(schema.READERS, 3, v2)
    assert read({"schema_version": "9.0", "name": "N"})["schema"]["reader"] == 3


def test_a_tree_that_is_not_a_dict_reads_as_nothing():
    for tree in (None, "text", 3, [1]):
        got = read(tree)
        assert got["fields"] == {} and got["unknown"] == [] and got["schema"]["version"] == "1.0"


# --- simple and rich forms ----------------------------------------------------------------------

def test_license_in_both_forms():
    assert read({"license": "CC-BY-4.0"})["fields"] == {"license": "CC-BY-4.0"}
    got = read({"license": {"id": "CC-BY-4.0", "url": "https://example.org/terms", "text": "Attribution 4.0"}})["fields"]
    assert got == {"license": "Attribution 4.0", "license_id": "CC-BY-4.0", "license_url": "https://example.org/terms"}
    only_id = read({"license": {"id": "MIT"}})["fields"]
    assert only_id == {"license": "MIT", "license_id": "MIT"}
    bad = read({"license": {"id": "MIT", "url": "javascript:alert(1)"}})
    assert "license_url" not in bad["fields"] and bad["ignored"] == ["license.url"]
    assert read({"license": {"nothing": 1}})["ignored"] == ["license"]


def test_authors_in_every_form_give_names_and_details():
    names = ["Jane Doe", "John Roe"]
    assert read({"authors": names})["fields"] == {"authors": names}
    assert read({"authors": "Solo"})["fields"] == {"authors": ["Solo"]}
    assert read({"author": "Solo"})["fields"] == {"authors": ["Solo"]}
    rich = read({"authors": [{"name": "Jane Doe", "orcid": "0000-0002-1825-0097", "affiliation": "Lab"}, "John Roe"]})["fields"]
    assert rich["authors"] == names
    assert rich["author_details"][0] == {"name": "Jane Doe", "affiliation": "Lab", "orcid": "0000-0002-1825-0097",
                                         "orcid_url": "https://orcid.org/0000-0002-1825-0097"}
    keyed = read({"authors": {"1": {"name": "B"}, "0": {"name": "A"}, "10": "C"}})["fields"]["authors"]
    assert keyed == ["A", "B", "C"], "an object keyed 0, 1, ... is a list, in numeric order"
    assert "author_details" not in read({"authors": [{"name": "X", "orcid": "not an orcid"}]})["fields"]


def test_contact_and_contacts_normalise_to_one_list():
    simple = read({"contact": "jane@example.org"})["fields"]
    assert simple["contacts"] == [{"email": "jane@example.org", "url": "mailto:jane@example.org"}]
    assert simple["contact"] == "jane@example.org" and simple["contact_url"] == "mailto:jane@example.org"
    assert read({"contact": "https://example.org/team"})["fields"]["contacts"] == [{"url": "https://example.org/team"}]
    assert read({"contact": "the front desk"})["fields"]["contacts"] == [{"name": "the front desk"}]
    rich = read({"contact": {"name": "J", "email": "j@x.org", "role": "curator"}, "contacts": [{"name": "K"}, "k@x.org"]})["fields"]
    assert [c.get("name") or c.get("email") for c in rich["contacts"]] == ["J", "K", "k@x.org"]
    assert rich["contact"] == "j@x.org" and rich["contacts"][0]["role"] == "curator"
    assert read({"contact": {"email": "not an email", "url": "javascript:x"}})["ignored"] == ["contact"]


def test_funding_citation_doi_and_provenance_forms():
    assert read({"funding": "NIH R35"})["fields"]["funding"] == [{"funder": "NIH R35"}]
    assert read({"funding": ["NIH", "ERC"]})["fields"]["funding"] == [{"funder": "NIH"}, {"funder": "ERC"}]
    grants = read({"funding": [{"funder": "NIH", "award": "R35GM147125", "url": "https://reporter.nih.gov/x"}]})["fields"]["funding"]
    assert grants == [{"funder": "NIH", "award": "R35GM147125", "url": "https://reporter.nih.gov/x"}]
    assert read({"funding": [{"funder": "NIH", "url": "javascript:x"}]})["fields"]["funding"] == [{"funder": "NIH"}]
    assert read({"citation": {"text": "Doe 2026", "bibtex": "@x{}"}})["fields"]["citation"] == "Doe 2026"
    got = read({"doi": {"id": "doi:10.1234/abcd"}})["fields"]
    assert got["doi"] == "10.1234/abcd" and got["doi_url"] == "https://doi.org/10.1234/abcd"
    prov = read({"provenance": {"source": "GEO", "n": 3, "ok": True, "deep": {"a": "b"}}})["fields"]["provenance"]
    assert prov == {"source": "GEO", "n": "3", "ok": "true"}


def test_old_simple_forms_and_new_rich_forms_normalise_to_the_same_fields():
    simple = read({"license": "MIT", "authors": ["A"], "contact": "a@x.org", "citation": "C", "doi": "10.1/x"})["fields"]
    rich = read({"license": {"id": "MIT", "text": "MIT"}, "authors": [{"name": "A"}], "contact": {"email": "a@x.org"},
                 "citation": {"text": "C"}, "doi": {"id": "10.1/x"}})["fields"]
    rich.pop("license_id")
    assert simple == rich


def test_text_is_cleaned_and_bounded():
    got = read({"title": "A\x00B", "description": "d" * 40_000, "authors": ["x" * 1000]})["fields"]
    assert got["title"] == "AB" and len(got["description"].encode()) <= schema.MAX_FIELD_BYTES and len(got["authors"][0]) == 300
    many = read({"authors": [f"a{i}" for i in range(2000)]})["fields"]["authors"]
    assert len(many) == schema.MAX_LIST


def test_wrong_types_are_ignored_by_name():
    got = read({"title": 42, "citation": ["a", "b"], "source_url": "ftp://x", "funding": 3, "provenance": "text"})
    assert got["fields"] == {} and set(got["ignored"]) == {"title", "citation", "source_url", "funding", "provenance"}


# --- the registry and the spec agree -----------------------------------------------------------

def test_the_field_table_in_the_docs_lists_every_field_with_its_version():
    with open(os.path.join(REPO, "docs", "deployment", "dataset-attribution.md"), encoding="utf-8") as fh:
        text = fh.read()
    for name, since, _form, _spellings, _meaning in schema.FIELD_SPECS:
        row = re.search(rf"^\| `{name}` \|[^\n]*\| {re.escape(since)} \|", text, re.MULTILINE)
        assert row, f"{name} (since {since}) is not in the field table of dataset-attribution.md"
    assert f'"{schema.SCHEMA_NAME}"' in text and "schema_version" in text


def test_the_current_version_is_what_the_writer_and_the_reader_know():
    assert schema.CURRENT_VERSION[0] in schema.READERS and max(schema.READERS) == schema.CURRENT_VERSION[0]
    assert all(since == "1.0" or schema.parse_version(since) <= schema.CURRENT_VERSION for _n, since, *_ in schema.FIELD_SPECS)
