"""The fractions have one vocabulary (aggregation-unify-080.md 13.1): "Fraction of cells", "Fraction of genes", "% of total" and one
threshold name, "Expressed above". The old words (% expressing, fraction detected, Detected above, the symbols %⁺ and n/N) must not
come back into the docs or the page's code."""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[3]
OLD = re.compile(r"% expressing|raction detected|Detected above|pct_expressing|%⁺|\bn/N\b")
# the old ids are read, by name, in the places that read old links
READS_OLD_IDS = {"static/js/utils/cell-grouping.js", "static/js/utils/signature-options.js", "annzarro/core/gene_score.py"}


def _files():
    for base, pattern in (("docs", "*.md"), ("static/js", "*.js")):
        for path in (ROOT / base).rglob(pattern):
            rel = path.relative_to(ROOT).as_posix()
            if "/vendor/" in rel or "_build" in rel:
                continue
            yield rel, path


def test_the_old_words_are_gone_from_the_docs_and_the_page():
    found = []
    for rel, path in _files():
        if rel in READS_OLD_IDS:
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if OLD.search(line):
                found.append(f"{rel}:{number}: {line.strip()[:100]}")
    assert not found, "\n".join(found)


def test_the_old_ids_are_read_in_one_place_each():
    for rel, wanted in (("static/js/utils/cell-grouping.js", "pct_expressing"), ("static/js/utils/signature-options.js", "detected"),
                        ("annzarro/core/gene_score.py", "detected")):
        text = (ROOT / rel).read_text(encoding="utf-8")
        assert wanted in text and "ALIASES" in text, rel
