"""A Gene Table as a source of a gene score, in a real browser.

A gene table is a gene-score source like a signature: it differs only in how the genes are chosen. A signature's are
handpicked; a table's are the rows that pass its filter, read through the selection every reader of a table uses
(an open table's rows, a closed table's frozen or background-built selection). Everything else is the signature's code:
the source menus, the score store and its cost tiers, the notices, "Scores offered" and Inspect.

The store is the one of test_gene_score_plots.py: 60 cells and 3,000 genes (ACTB, CD3D, CD3E, CD3G, Cd3d, GAPDH, KLF1
and GENE0000 to GENE2992), whose `var.mean` is the gene's position, so "mean < 5" passes the first five genes.

1.  A plot coloured by an open table's score asks for exactly the genes that pass its filter.
2.  A filter change moves the plot as a signature edit does: at once when the score is cheap, behind Update score when
    it is slow; an unchanged filter asks for nothing.
3.  A closed table restored from a link builds in the background, then scores; the table stays closed.
4.  A cycle (a table filtered by a table that reads its score) shows the cycle state and asks for nothing.
5.  Scores offered on the table: collapsed with its summary, stored as configuration only, and carried by a link and
    a panel set.
6.  Menus: tables are told apart from signatures; labels name the table.
7.  A signature of 5,000 genes opens from a link, and the route takes more than 2,000 genes.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing
Playwright is an error.
"""
import json
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_gene_score_plots import (  # noqa: E402,F401
    C, INIT, SCORE, UMAP_X, UMAP_Y, _box, _calls, _cell, _colours, _drawn, _fake, _new_page, _notice, _numbers, _open,
    _placeholder, _served, _tag, _url, _wait_coloured, GENES,
)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

G = '.tile[data-tile-id="gene-table-G"]'
TAB = "gene-table-G"
TABLE_SCORE = {"type": "gene-score", "key": TAB, "label": "Gene Table 1", "column": ""}
MEAN = {"type": "var", "key": "mean", "column": ""}


def mean_below(n):
    """A table filter: the genes whose `mean` (their position in the dataset) is below n."""
    return {"logic": "AND", "criteria": [
        {"condition": "<", "data": "mean", "origData": "var_mean_main", "type": "num", "value": [str(n)]}]}


def _table(below=5, **extra):
    return {"id": TAB, "title": "Gene Table 1", "columns": [MEAN], "searchBuilderConfig": mean_below(below), **extra}


@pytest.fixture(scope="module")
def served(tmp_path_factory):
    proc, root, store = _served(tmp_path_factory)
    yield root, store
    proc.terminate()
    proc.wait(10)


@pytest.fixture
def page(served):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = _new_page(browser)
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            yield page
            assert not errors, errors
        finally:
            browser.close()


def _open_table_link(page, served, table=None, table_open=True, plots=None, **view):
    """A link: a Cell Plot coloured by the table's score, and the table open or closed."""
    plot = _cell(color=TABLE_SCORE)
    open_ids = ["cell-plot-C"] + ([TAB] if table_open else [])
    page.goto(_url(served, open_ids, {"cell-plot-C": plot, TAB: table or _table(), **(plots or {})}, **view))
    page.wait_for_selector(f"{C} .js-plotly-plot, {C} .coverage-placeholder", timeout=30000)


def _asked(page):
    """The genes of each compute request so far, sorted."""
    return [sorted(c["genes"]) for c in _calls(page, "compute")]


FIRST_FIVE = ["ACTB", "CD3D", "CD3E", "CD3G", "Cd3d"]


# ------------------------------------------------------------------ 1. a plot coloured by an open table's score

def test_a_plot_coloured_by_an_open_tables_score_asks_for_its_passing_genes(page, served):
    _open_table_link(page, served)
    _wait_coloured(page)
    assert _asked(page) == [FIRST_FIVE]
    assert len(_numbers(page)) == 60
