"""Release guard: no unfilled Zenodo DOI placeholder may ship.

The citation entries (README.md, CITATION.cff, docs/reference/license.md) were
written before the Zenodo record existed, with a placeholder token in place of
the record number of the concept DOI. Filling it in is one search and replace;
forgetting it would publish a DOI that resolves nowhere, on PyPI and in every
citation made from the repository. This test fails while any token remains.
The docs build (docs/conf.py) refuses the same tokens.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
# Built from parts so that this file does not contain a token itself.
TOKEN = re.compile("ZENODO" + r"_[A-Z]+_RECID")
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


def test_no_unfilled_zenodo_placeholder():
    paths = [ROOT / f for f in FILES if (ROOT / f).exists()]
    paths += sorted((ROOT / "docs").rglob("*.md"))
    found = _placeholders(paths)
    assert not found, ("Zenodo DOI placeholder left in; replace it with the record number of the "
                       "concept DOI:\n" + "\n".join(found))
