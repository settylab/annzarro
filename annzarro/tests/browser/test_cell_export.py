"""The per-cell CSV of the Cell Grouping panel in a real browser, against the real cell_groups route (G9e, GRP-18).

The store is the grouping fixture (tests/core/grouping_store.py): 1,200 cells, cell_type with 6 levels, condition.

1.  The entry beside "Export CSV" downloads cell name and group name, one row a cell in the dataset's order; each
    group is the grid's name for it (the oracle is the fixture's obs table, not the page).
2.  The export asks the route once, for the codes, and the names of the cells are not asked of the server again.
3.  A cell in no group reads "Not in any group", and the rows of the others still match the oracle.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import csv
import io
import os
import pathlib

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import test_group_grid as grid  # noqa: E402
from annzarro.tests.browser import waits  # noqa: E402

served = grid.served          # the fixture: the server on the grouping store
page = grid.page              # the fixture: a page that records its cell_groups requests
A, DATA = grid.A, grid.DATA
CELL_TYPE, CONDITION = grid.CELL_TYPE, grid.CONDITION
ENTRY = f"{A} .cgg__export-cells"


def _download(page):
    """Click the entry; the rows of the file it hands over, header first."""
    with page.expect_download() as info:
        page.click(ENTRY)
    assert info.value.suggested_filename.endswith(".csv")
    text = pathlib.Path(info.value.path()).read_text()
    return list(csv.reader(io.StringIO(text)))


def _codes_requests(page):
    return [c for c in page.calls if not c.get("estimate_only") and (c.get("want") or {}).get("codes")]


# ------------------------------------------------------------------ 1. the file

def test_the_entry_downloads_a_row_a_cell_with_the_groups_name(page, served):
    grid._open(page, served, [CELL_TYPE, CONDITION])
    rows = _download(page)
    assert rows[0] == ["Cell name", "Group name"]
    expected = [[str(name), f"{ct} | {cond}"] for name, ct, cond in zip(DATA.obs.index, DATA.obs["cell_type"], DATA.obs["condition"])]
    assert rows[1:] == expected
    groups = {r["cells"][0].replace(" small", "") for r in grid._grid(page)["rows"]}
    assert {r[1] for r in rows[1:]} == groups, "each group is named as the grid names it"


# ------------------------------------------------------------------ 2. the requests

def test_the_export_asks_the_route_once_for_the_codes(page, served):
    grid._open(page, served, [CELL_TYPE])
    asked = len(page.calls)
    names_asked = []
    page.on("request", lambda r: names_asked.append(r.url) if "/data/names" in r.url else None)
    rows = _download(page)
    assert len(rows) == 1 + len(DATA.obs)
    sent = page.calls[asked:]
    assert len(_codes_requests(page)) == 1, sent
    assert len(sent) == 1, "no estimate and no second request"
    waits.expect_stays(lambda: len(page.calls) == asked + 1, "the finished export asks for nothing more", page=page)


# ------------------------------------------------------------------ 3. no group

def test_a_cell_in_no_group_reads_not_in_any_group(page, served):
    levels = {"source": CELL_TYPE["source"], "levels": ["c:B cell", "c:T cell"], "rest": "exclude"}
    grid._open(page, served, [levels])
    rows = _download(page)
    expected = [[str(name), ct if ct in ("B cell", "T cell") else "Not in any group"] for name, ct in zip(DATA.obs.index, DATA.obs["cell_type"])]
    assert rows[1:] == expected
    assert sum(1 for r in rows[1:] if r[1] == "Not in any group") == int((~DATA.obs["cell_type"].isin(["B cell", "T cell"])).sum())
