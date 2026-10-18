"""The autosave waits for idle time, and still saves on every tick and when the page goes.

The periodic autosave read every panel's config at once, the Cell Table's
row list included (about 0.1 s at 1M cells), wherever the tick fell, e.g.
between a click and its focus marker. It now runs in idle time
(requestIdleCallback, at most 2 s late), and the table's row list is not read
for it at all. What must stay: a focus change reaches the autosave on the
next tick, and leaving the page saves at once.

The committed 200-cell fixture, served with ``ui.autosave.interval_ms`` 300
(a tick) and 3,600,000 (no tick: only the save on leaving), with a Cell Plot
and a Cell Table.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI).
"""
import base64
import json
import os
import urllib.parse

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_click_focus_busy import _start  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
STORE = os.path.join(os.path.dirname(HERE), "data", "fixture_small.zarr")


@pytest.fixture(scope="module", params=[300, 3600000], ids=["tick", "no-tick"])
def server(request, tmp_path_factory):
    proc, root = _start(tmp_path_factory.mktemp("home"),
                        f"ui:\n  autosave:\n    enabled: true\n    interval_ms: {request.param}\n")
    yield request.param, root
    proc.terminate()
    proc.wait(10)


def _link(root):
    plot = {"id": "cell-plot-a", "title": "A",
            "x": {"type": "obsm", "key": "X_umap", "column": "0"},
            "y": {"type": "obsm", "key": "X_umap", "column": "1"},
            "color": {"type": "obs", "key": "cell_type", "column": ""}}
    table = {"id": "cell-table-a", "title": "Table",
             "columns": [{"type": "obs", "key": "cell_type", "column": ""}]}
    tiles = [{"type": "tile", "id": i, "controlsVisible": True} for i in ("cell-plot-a", "cell-table-a")]
    view = {"v": 1, "subset": None,
            "layout": {"v": 1, "hierarchy": [{"type": "split", "direction": "horizontal",
                                              "panes": [{"percentage": 60}, {"percentage": 40}], "children": tiles}],
                       "controlState": {"cell-plot-a": True, "cell-table-a": True},
                       "panelConfigs": {"cell-plot-a": plot, "cell-table-a": table}}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={enc}"


SAVED = """() => { const s = localStorage.getItem('annzarro_autosave');
  return s ? JSON.parse(s).constants.focusedCell : null; }"""


def test_a_focus_change_is_autosaved_on_the_next_tick_and_when_the_page_goes(server):
    interval, root = server
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            context = browser.new_context(viewport={"width": 1400, "height": 900})
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(_link(root))
            page.wait_for_function("() => { const g = document.querySelector('.tile[data-tile-id=\"cell-plot-a\"] .js-plotly-plot');"
                                   " return !!(g && g.data && g.data.some(t => t.name === 'Focused Cell')); }", timeout=60000)
            page.evaluate("async () => (await import('/static/js/data-manager.js')).DataManager.setFocusedCell('cell_0042', false)")
            if interval < 1000:
                # a tick, in idle time (at most 2 s after it)
                page.wait_for_function(f"() => ({SAVED})() === 'cell_0042'", timeout=5000)
            else:
                page.wait_for_timeout(1500)
                assert page.evaluate(SAVED) != "cell_0042", "saved without a tick: the test does not test leaving"
                page.goto(root + "/api/v1/config")      # leave the page: saved at once
                assert page.evaluate(SAVED) == "cell_0042"
            assert not errors, errors
        finally:
            browser.close()
