"""A table's search text is kept with the panel (user decision T8).

1. Search a table, close it, Reopen it: the search box has the text again,
   the table shows the rows that match, and a plot filtered by the table
   follows it (before: the table came back unfiltered, and the plot with it).
2. The panel set and the share link carry the search (searchText in the
   table's config), and a link with it opens the table searched and the plot
   filtered.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_closed_table_filter import A, B, PASS, _link, _state, server, page  # noqa: E402,F401

STRIP_100 = f"() => /^100 of 200 cells shown/.test(document.querySelector('{B} .plot-status')?.getAttribute('data-summary') || '')"


def test_reopen_restores_the_search_and_the_plot(page, server):
    page.goto(_link(server, None))
    page.wait_for_selector(f"{A} .dataTables_scrollBody tbody tr", timeout=30000)
    page.fill(f'{A} input[type="search"]', "cell_01")
    page.wait_for_function(STRIP_100, timeout=20000)
    page.evaluate("() => window.PanelManager.closePanel('cell-table-A')")
    page.click('.panel-closed-btn[data-id="cell-table-A"]')
    page.wait_for_selector(f"{A} .dataTables_scrollBody tbody tr", timeout=30000)
    assert page.input_value(f'{A} input[type="search"]') == "cell_01"
    assert "of 100 entries (filtered from 200 total entries)" in page.inner_text(f"{A} .dataTables_info")
    page.wait_for_function(STRIP_100, timeout=20000)
    s = _state(page)
    assert len(s["names"]) == 100 and all(PASS.match(c) for c in s["names"])


def test_panel_set_and_link_carry_the_search(page, server):
    page.goto(_link(server, None))
    page.wait_for_selector(f"{A} .dataTables_scrollBody tbody tr", timeout=30000)
    page.fill(f'{A} input[type="search"]', "cell_01")
    page.wait_for_function(STRIP_100, timeout=20000)
    saved = page.evaluate("() => window.PanelManager.saveLayout()")
    assert saved["panelConfigs"]["cell-table-A"]["searchText"] == "cell_01"
    assert "currentEntries" not in saved["panelConfigs"]["cell-table-A"]
    # a link made from that panel set opens searched, and the plot filtered
    import base64, json, urllib.parse  # noqa: E401
    from annzarro.tests.browser.test_memory_guard import STORE
    view = {"v": 1, "subset": None, "layout": saved}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    page.goto("about:blank")
    page.goto(f"{server}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={enc}")
    page.wait_for_selector(f"{A} .dataTables_scrollBody tbody tr", timeout=30000)
    assert page.input_value(f'{A} input[type="search"]') == "cell_01"
    page.wait_for_function(STRIP_100, timeout=20000)
