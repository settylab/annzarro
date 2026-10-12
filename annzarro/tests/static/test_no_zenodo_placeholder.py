"""Release guard: no unfilled DOI placeholder may ship, and the preprint stays cited.

The citation entries (README.md, CITATION.cff, docs/reference/license.md) were
written before the Zenodo record existed, with a placeholder token in place of
the record number of the concept DOI. Filling it in is one search and replace;
forgetting it would publish a DOI that resolves nowhere, on PyPI and in every
citation made from the repository. This test fails while any token remains.
The docs build (docs/conf.py) refuses the same tokens.

The same holds for the preprint: its DOI placeholder (PREPRINT_DOI_TBD and the like) and the
wording that stood in before the preprint existed ("in preparation", "forthcoming") must not
survive, and every citation file must name the preprint DOI.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
# Built from parts so that this file does not contain a token itself.
TOKEN = re.compile("ZENODO" + r"_[A-Z]+_RECID|PREPRINT" + r"_[A-Z_]*(?:DOI|TBD)[A-Z_]*|DOI" + r"_TBD")
PENDING = re.compile(r"in preparation|forthcoming|to be submitted", re.IGNORECASE)
PREPRINT_DOI = "10.64898/2026.10.10.758158"
FILES = ["README.md", "CITATION.cff", ".zenodo.json"]


def _placeholders(paths):
    found = []
    for path in paths:
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if TOKEN.search(line):
                found.append(f"{path.relative_to(ROOT)}:{n}: {line.strip()}")
    return found


def test_token_pattern_matches_the_placeholder():
    # positive control: the predicate catches the token as it is written
    assert TOKEN.search("doi = {10.5281/zenodo." + "ZENODO" + "_CONCEPT_RECID}")
    assert not TOKEN.search("doi = {10.5281/zenodo.17000000}")
    assert TOKEN.search("doi = {" + "PREPRINT" + "_DOI_TBD}")
    assert TOKEN.search("doi = {" + "PREPRINT" + "_TBD}")
    assert not TOKEN.search("doi = {" + PREPRINT_DOI + "}")


def test_no_unfilled_zenodo_placeholder():
    paths = [ROOT / f for f in FILES if (ROOT / f).exists()]
    paths += sorted((ROOT / "docs").rglob("*.md"))
    found = _placeholders(paths)
    assert not found, ("Zenodo DOI placeholder left in; replace it with the record number of the "
                       "concept DOI:\n" + "\n".join(found))


def test_no_pre_preprint_wording():
    # the paper pages and the README said "in preparation" until the preprint was posted
    paths = [ROOT / "README.md"] + sorted((ROOT / "docs").rglob("*.md"))
    found = [f"{p.relative_to(ROOT)}:{n}: {line.strip()}"
             for p in paths if p.exists()
             for n, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1)
             if PENDING.search(line)]
    assert not found, "the paper is out; cite it instead of saying it is pending:\n" + "\n".join(found)


def test_preprint_doi_in_every_citation_file():
    missing = [f for f in FILES + ["docs/references.bib"]
               if PREPRINT_DOI not in (ROOT / f).read_text(encoding="utf-8")]
    assert not missing, f"preprint DOI {PREPRINT_DOI} missing from: {', '.join(missing)}"
