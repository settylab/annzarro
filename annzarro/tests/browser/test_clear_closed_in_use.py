"""Clear closed panels keeps the closed panels that are in use (design-gene-signature 7.1, GRP-13, CAT-9).

A closed panel that an open panel refers to (a plot's table filter, a score column), or that a kept
closed panel refers to, is kept; the others are deleted, and the notice says how many were kept. The
uses are asked of utils/panel-references.js (usersOf), the one declaration of each panel type's references.
Before this change every closed panel was deleted, and the open plot lost its filter.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_memory_guard import until  # noqa: E402
from annzarro.tests.browser.test_restore_closed_panels import (  # noqa: E402
    B, CT, HOLD_BUILDS, X, Y, _panels, _plot_cfg, _url, _view, _wait_plot, server)  # noqa: F401

SCORE = {"type": "gene-score", "key": "gene-signature-S", "column": "mean", "layer": "X", "label": "S"}
CLOSED = {
    # used by the open plot's filter; shows a score column of the signature, so that one is kept too
    "cell-table-A": {"id": "cell-table-A", "title": "Table 1", "columns": [CT, SCORE], "searchText": "cell_01"},
    "gene-signature-S": {"id": "gene-signature-S", "title": "Signature S", "genes": []},
    # used by nothing that stays
    "cell-plot-C": {"id": "cell-plot-C", "title": "Closed cell plot", "x": X, "y": Y, "z": None, "color": CT,
                    "tableFilter": "cell-table-E"},
    "cell-table-E": {"id": "cell-table-E", "title": "Table 2", "columns": [CT]},
    "gene-plot-D": {"id": "gene-plot-D", "title": "Closed gene plot"},
}
NOTICES = """window.__azNotices = [];
document.addEventListener('annzarro:notify', (e) => window.__azNotices.push(e.detail));"""


@pytest.fixture
def page(server):  # noqa: F811
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1400, "height": 1000})
            page.add_init_script(HOLD_BUILDS)
            page.add_init_script(NOTICES)
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            yield page
            assert not errors, errors
        finally:
            browser.close()


def _clear(page):
    """Press Clear closed panels twice: the first press asks, the second deletes."""
    button = page.locator(".clear-closed-panels-btn:visible").first
    button.click()
    until(page, "() => !!document.querySelector('.clear-closed-panels-btn[data-armed=\"1\"]')")
    page.locator('.clear-closed-panels-btn[data-armed="1"]').first.click()


ONE = {"cell-table-A": {**CLOSED["cell-table-A"], "columns": [CT]}, "gene-plot-D": CLOSED["gene-plot-D"]}
NONE = {"gene-plot-D": CLOSED["gene-plot-D"], "cell-table-E": CLOSED["cell-table-E"]}


@pytest.mark.parametrize("closed, kept, said", [
    (CLOSED, {"cell-table-A", "gene-signature-S"}, ["Kept 2 closed panels in use."]),
    (ONE, {"cell-table-A"}, ["Kept 1 closed panel in use."]),
    (NONE, set(), []),
], ids=["two-kept-one-through-a-kept-table", "one-kept", "none-kept"])
def test_clear_closed_panels_keeps_the_ones_in_use_and_says_how_many(page, server, closed, kept, said):  # noqa: F811
    plot = _plot_cfg() if "cell-table-A" in closed else _plot_cfg(tableFilter="none")
    view = _view(["cell-plot-B"], {"cell-plot-B": plot, **closed})
    view["layout"]["hierarchy"] = [view["layout"]["hierarchy"][0], {"type": "selector"}]
    page.goto(_url(server, view))
    _wait_plot(page, notice="cell-table-A" in closed)
    assert set(closed) <= set(_panels(page))
    _clear(page)
    until(page, "() => !window.PanelManager.getPanel('gene-plot-D')")
    panels = _panels(page)
    assert set(panels) == {"cell-plot-B"} | kept, sorted(panels)
    assert all(panels[i]["open"] is False for i in kept)
    assert panels["cell-plot-B"]["config"]["tableFilter"] == plot["tableFilter"]
    # the notice is raised in the same task that deletes, so by now it is there or it never comes
    notices = page.evaluate("() => window.__azNotices")
    assert [n["message"] for n in notices] == said, notices
