"""Back and Forward over a change of layout redraw only what changed.

Opening a panel, closing one and moving a split are layout steps. The panels
whose settings did not change keep their graph (the very same element, no data
asked for again); only a new panel is built and only a removed one is disposed.
A settings step of a gene plot and of a table rebuilds just that panel.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import base64
import json
import urllib.parse

import pytest

from annzarro.tests.browser.test_memory_guard import STORE  # noqa: E402
from annzarro.tests.browser.test_plot_options import (  # noqa: F401
    A, B, _cfgs, _change, _menu, _settings, page, server)
from annzarro.tests.browser.test_url_history import LENGTH, SETTLE_MS, _until_font  # noqa: E402

GRAPH = "document.querySelector(`.tile[data-tile-id=\"${id}\"] .js-plotly-plot`)"
TILES = "() => [...document.querySelectorAll('.tile-container .tile[data-tile-id]')].map(t => t.dataset.tileId).sort()"


def _view_link(root, hierarchy, cfgs):
    layout = {"v": 1, "hierarchy": hierarchy, "controlState": {k: True for k in cfgs}, "panelConfigs": cfgs}
    enc = base64.urlsafe_b64encode(json.dumps({"v": 1, "subset": None, "layout": layout}).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={enc}"


def _tile(i):
    return {"type": "tile", "id": i, "controlsVisible": True}


def _split(ids):
    return {"type": "split", "direction": "horizontal", "panes": [{"percentage": 100 / len(ids)} for _ in ids],
            "children": [_tile(i) for i in ids]}


def _drawn(page, pid):
    page.wait_for_selector(f".tile[data-tile-id='{pid}'] .js-plotly-plot", timeout=60000)
    page.wait_for_timeout(800)


def _mark(page, pid):
    page.evaluate("(id) => { %s.__kept = 'mine'; }" % GRAPH, pid)


def _marked(page, pid):
    return page.evaluate("(id) => (%s || {}).__kept" % GRAPH, pid)


def _log_requests(page):
    seen = []
    page.on("request", lambda r: seen.append(r.url) if "/api/" in r.url else None)
    return seen


def _no_data_asked_for_a(seen):
    """A colours by cell_type; B by total_counts: a request for cell_type is A's data read again."""
    assert not [u for u in seen if "cell_type" in u], seen


def _start_with_a(page, server):
    page.goto(_view_link(server, [_tile(A)], {A: _cfgs()[A]}))
    _drawn(page, A)
    page.wait_for_timeout(SETTLE_MS)
    _mark(page, A)
    return page.evaluate(LENGTH)


def _open_b(page):
    page.evaluate("(cfg) => window.PanelManager.createPanelInLayout('cell-plot', cfg)", _cfgs()[B])
    page.wait_for_function("() => document.querySelectorAll('.tile-container .tile[data-tile-id]').length === 2", timeout=30000)
    page.wait_for_timeout(SETTLE_MS)


def test_back_over_opening_a_panel_keeps_the_other_graph(page, server):
    base = _start_with_a(page, server)
    _open_b(page)
    assert page.evaluate(LENGTH) == base + 1
    seen = _log_requests(page)
    page.go_back()
    page.wait_for_function("() => document.querySelectorAll('.tile-container .tile[data-tile-id]').length === 1", timeout=30000)
    page.wait_for_timeout(1500)
    assert page.evaluate(TILES) == [A]
    assert _marked(page, A) == "mine"
    _no_data_asked_for_a(seen)
    # Forward builds the panel again, and A is still the same graph
    page.go_forward()
    page.wait_for_function("() => document.querySelectorAll('.tile-container .tile[data-tile-id]').length === 2", timeout=30000)
    _drawn(page, B)
    assert _marked(page, A) == "mine"
    _no_data_asked_for_a(seen)


def test_back_over_closing_a_panel_keeps_the_other_graph(page, server):
    page.goto(_view_link(server, [_split([A, B])], _cfgs()))
    _drawn(page, A)
    _drawn(page, B)
    page.wait_for_timeout(SETTLE_MS)
    _mark(page, A)
    base = page.evaluate(LENGTH)
    page.locator(f".tile[data-tile-id='{B}'] .tile-close").first.click()
    page.wait_for_function("() => document.querySelectorAll('.tile-container .tile[data-tile-id]').length === 1")
    page.wait_for_timeout(SETTLE_MS)
    assert page.evaluate(LENGTH) == base + 1
    seen = _log_requests(page)
    page.go_back()
    page.wait_for_function("() => document.querySelectorAll('.tile-container .tile[data-tile-id]').length === 2", timeout=30000)
    _drawn(page, B)
    assert page.evaluate(TILES) == [A, B]
    assert _marked(page, A) == "mine"
    _no_data_asked_for_a(seen)


def _widths(page):
    return page.evaluate("""() => { const h = window.PanelManager.saveLayout().hierarchy[0]; return h.panes.map(p => Math.round(p.percentage)); }""")


def test_back_over_moving_a_split_only_resizes(page, server):
    page.goto(_view_link(server, [_split([A, B])], _cfgs()))
    _drawn(page, A)
    _drawn(page, B)
    page.wait_for_timeout(SETTLE_MS)
    _mark(page, A)
    _mark(page, B)
    before = _widths(page)
    base = page.evaluate(LENGTH)
    box = page.locator(".split-handle").first.bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x - 250, y, steps=8)
    page.mouse.up()
    page.wait_for_timeout(SETTLE_MS)
    moved = _widths(page)
    assert moved != before, (before, moved)
    assert page.evaluate(LENGTH) == base + 1
    seen = _log_requests(page)
    page.go_back()
    page.wait_for_function("(w) => JSON.stringify(window.PanelManager.saveLayout().hierarchy[0].panes.map(p => Math.round(p.percentage))) === JSON.stringify(w)",
                           arg=before, timeout=30000)
    page.wait_for_timeout(1500)
    assert _marked(page, A) == "mine" and _marked(page, B) == "mine"
    assert not [u for u in seen if "cell_type" in u or "total_counts" in u], seen
    # the graphs fit their panes again
    for pid in (A, B):
        pane = page.eval_on_selector(f".tile[data-tile-id='{pid}'] .tile-content", "e => e.getBoundingClientRect().width")
        graph = page.eval_on_selector(f".tile[data-tile-id='{pid}'] .js-plotly-plot", "e => e.getBoundingClientRect().width")
        assert graph <= pane + 1


G, T = "gene-plot-G", "cell-table-T"


def test_a_step_rebuilds_a_gene_plot_and_a_table_in_place(page, server):
    cfgs = {A: _cfgs()[A], G: {"id": G, "z": None}, T: {"id": T, "columns": [{"type": "obs", "key": "cell_type", "column": ""}]}}
    page.goto(_view_link(server, [_split([A, G]), _tile(T)], cfgs))
    _drawn(page, A)
    _drawn(page, G)
    page.wait_for_selector(f".tile[data-tile-id='{T}'] table", timeout=60000)
    page.wait_for_timeout(SETTLE_MS)
    _mark(page, A)
    base = page.evaluate(LENGTH)
    initial = _settings(page, G).get("fontSize")
    # the gene plot: a setting through its menu
    _menu(page, G, "text")
    _change(page, f"#font-size-{G}", 15)
    page.wait_for_timeout(SETTLE_MS)
    assert page.evaluate(LENGTH) == base + 1
    # the table: its search box
    search = page.locator(f".tile[data-tile-id='{T}'] input[type=search]").first
    search.fill("T cell")
    page.wait_for_timeout(SETTLE_MS)
    assert page.evaluate(LENGTH) == base + 2
    assert _settings(page, T).get("searchText") == "T cell"
    page.go_back()
    page.wait_for_function(
        "([id]) => { const s = window.PanelManager.saveLayout().panelConfigs[id]; return s && !s.searchText; }", arg=[T], timeout=30000)
    page.wait_for_selector(f".tile[data-tile-id='{T}'] table", timeout=30000)
    assert page.locator(f".tile[data-tile-id='{T}'] input[type=search]").first.input_value() == ""
    assert _settings(page, G).get("fontSize") == 15
    page.go_back()
    page.wait_for_function(
        "([id, want]) => { const s = window.PanelManager.saveLayout().panelConfigs[id]; return s && s.fontSize === want; }",
        arg=[G, initial], timeout=30000)
    page.wait_for_selector(f".tile[data-tile-id='{G}'] .js-plotly-plot", timeout=30000)
    assert _marked(page, A) == "mine"
