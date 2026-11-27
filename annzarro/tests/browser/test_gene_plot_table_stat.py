"""A Cell Table's cells as a source of a Gene Plot axis (SO-8c): the item picker lists the tables under Cell tables, and each gene
is the statistic of that gene over the table's passing cells.

1.  The item picker has a Cell tables section, with a line that says there are none when there are none; no group select follows a
    table (the table is the group).
2.  Choosing a table sends ONE `genes` request that carries the table's bitset as `sets` and `member` (nothing is resolved on the
    server); a switch of statistic sends none; two axes on one table share one request.
3.  The axis FOLLOWS the table's rows: a filter change is one new request for the new cells, the old values staying drawn until
    they come; a table with no rows says so; a deleted table says so and the plot keeps its setting.
4.  Expressed above of the table's Methods is the request's threshold: one request when it changes.
5.  A link round trip.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import json
import os
import urllib.parse

import numpy as np
import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import axis_sets  # noqa: E402
from annzarro.tests.browser.test_cell_gene_panel import DATA, _url, page, served  # noqa: E402,F401
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

G, TA = "gene-plot-G", "cell-table-T"
C = f'.tile[data-tile-id="{G}"]'
T = f'.tile[data-tile-id="{TA}"]'
NONE = {"type": "none", "key": "", "column": ""}
POP = "[data-popover='methods']"
ALL = np.ones(len(DATA.obs), dtype=bool)
MONOCYTE = (DATA.obs["cell_type"] == "Monocyte").to_numpy()


def _plot(**extra):
    cfg = {"id": G, "title": "Gene Plot 1", "x": {"type": "layer", "key": "logged", "column": "CELL0000"},
           "y": {"type": "layer", "key": "logged", "column": "CELL0001"}, "z": None, "color": NONE, "pointSize": 6,
           "pointOpacity": 1, "categoryPalette": "uns"}
    cfg.update(extra)
    return cfg


def _table(**extra):
    return {"id": TA, "title": "Table 1", "columns": [{"type": "obs", "key": "cell_type", "column": ""}], **extra}


def _stat(**extra):
    return {"type": "table-stat", "key": TA, "stat": "mean", "layer": "logged", **extra}


def _open(page, served, configs, open_ids=(G, TA)):
    page.goto(_url(served, list(open_ids), configs))
    page.wait_for_selector(f"{C} .js-plotly-plot", timeout=30000)


def _genes(page):
    return [c for c in page.calls if c.get("shape") == "genes"]


def _computes_genes(request):
    body = json.loads(request.post_data or "{}")
    return "/data/cell_groups" in request.url and request.method == "POST" and body.get("shape") == "genes" and not body.get("estimate_only")


def _entry():
    return axis_sets.set_value("table-stat", TA)


def _numbers(stat, mask, layer="logged", threshold=0.0):
    x = DATA.layer(layer)[mask].astype(np.float64)
    above = x > threshold
    if stat == "mean":
        out = x.mean(axis=0)
    elif stat == "sum":
        out = x.sum(axis=0)
    else:
        out = above.mean(axis=0)
    return out


def _wait_colours(page, want, axis="color", timeout=60):
    """Wait until the distinct values the axis draws are the statistic of the genes."""
    until(page, """([t, axis, want]) => { const gd = document.querySelector(t + ' .js-plotly-plot');
        const key = axis === 'color' ? (d) => Array.from((d.marker && d.marker.color) || []) : (d) => Array.from(d[axis] || []);
        const v = [...new Set(((gd && gd.data) || []).flatMap(key).filter(x => typeof x === 'number').map(x => Math.round(x * 1e6) / 1e6))].sort((a, b) => a - b);
        const w = [...new Set(want.map(x => Math.round(x * 1e6) / 1e6))].sort((a, b) => a - b);
        return v.length === w.length && v.every((x, i) => Math.abs(x - w[i]) < 2e-6); }""", [C, axis, [float(x) for x in want]], timeout=timeout)


def _config(page, axis="color"):
    return page.evaluate("([id, a]) => window.PanelManager.getPanel(id).getConfig()[a]", [G, axis])


def _notice(page):
    return page.evaluate("""(t) => { const el = document.querySelector(t + ' .score-notice');
        return el ? { state: el.dataset.state, text: el.textContent.replace(/\\s+/g, ' ').trim() } : null; }""", C)


def _pick_table(page, axis="color", layer="logged"):
    page.select_option(axis_sets.sel(C, axis, "type"), "layer")
    until(page, "([s]) => document.querySelector(s).options.length > 1", [axis_sets.sel(C, axis, "key")])
    if page.input_value(axis_sets.sel(C, axis, "key")) != layer:
        page.select_option(axis_sets.sel(C, axis, "key"), layer)
    until(page, "([s, v]) => [...document.querySelector(s).options].some(o => o.value === v)", [axis_sets.sel(C, axis, "column"), _entry()])
    page.select_option(axis_sets.sel(C, axis, "column"), _entry())
    page.wait_for_selector(axis_sets.button(C, axis))


# ------------------------------------------------------------------ 1: the item picker

def test_the_item_picker_lists_the_tables_and_says_when_there_are_none(page, served):
    _open(page, served, {G: _plot(), TA: _table()})
    page.select_option(axis_sets.sel(C, "color", "type"), "layer")
    column = axis_sets.sel(C, "color", "column")
    until(page, "(s) => [...document.querySelector(s).options].some(o => o.textContent === 'Table 1')", column)
    entries = page.evaluate("(s) => [...document.querySelector(s).options].map(o => [o.textContent, o.parentElement.label || '', o.disabled])", column)
    assert [t for t, g, _ in entries if g == "Cell tables"] == ["Table 1"], entries
    # no table: the section is there, with a line that is no choice
    page.goto("about:blank")
    _open(page, served, {G: _plot()}, open_ids=(G,))
    page.select_option(axis_sets.sel(C, "color", "type"), "layer")
    until(page, "(s) => [...document.querySelector(s).options].some(o => o.parentElement.label === 'Cell tables')", column)
    none = page.evaluate("(s) => [...document.querySelector(s).options].filter(o => o.parentElement.label === 'Cell tables').map(o => [o.textContent, o.disabled])", column)
    assert none == [["No cell tables yet", True]], none


# ------------------------------------------------------------------ 2: one request, bitset as sets and member

def test_a_table_is_one_request_of_its_bitset_and_a_switch_of_statistic_sends_none(page, served):
    _open(page, served, {G: _plot(), TA: _table()})
    page.wait_for_selector(f"{T} .dataTables_scrollBody tbody tr", timeout=30000)
    assert not _genes(page)
    with page.expect_request(_computes_genes) as asked:
        _pick_table(page)
    body = json.loads(asked.value.post_data)
    assert body["shape"] == "genes" and body["layer"] == "logged" and body["thresholds"] == [0]
    assert body["member"] in body["sets"] and "partitionings" not in body and "group" not in body, sorted(body)
    assert body["sets"][body["member"]]["length"] == len(DATA.obs), "one bit per cell shown"
    _wait_colours(page, _numbers("mean", ALL))
    assert page.locator(f"{C} select.axis-member-select").count() == 0, "the table is the group: no group select"
    cfg = _config(page)
    assert (cfg["type"], cfg["key"], cfg["stat"], cfg["layer"]) == ("table-stat", TA, "mean", "logged") and "groupWas" not in cfg, cfg
    assert cfg.get("column", "") == "", "the table has no group: nothing is stored in column"
    assert page.get_attribute(axis_sets.button(C, "color"), "aria-label") == "Aggregation: Mean"
    rows = axis_sets.aggregations(page, C, "color")
    assert [r["v"] for r in rows] == ["zscore_mean", "mean", "fraction_of_cells", "mean_expressing", "sum", "sd"], "the group statistics, in their order"
    assert rows[0]["off"] is True and "cell groups" in rows[0]["title"], "z-score mean is not offered for a table, and says why"
    for stat in ("fraction_of_cells", "sum", "mean"):
        axis_sets.choose_aggregation(page, C, "color", stat)
        until(page, "([s]) => window.PanelManager.getPanel('gene-plot-G').getConfig().color.stat === s", [stat])
        _wait_colours(page, _numbers(stat, ALL))
    assert len(_genes(page)) == 1, "the other statistics are the same moments: nothing was asked"


def test_two_axes_on_one_table_share_one_request(page, served):
    _open(page, served, {G: _plot(x=_stat(), y=_stat(stat="sum")), TA: _table()})
    _wait_colours(page, _numbers("mean", ALL), axis="x")
    _wait_colours(page, _numbers("sum", ALL), axis="y")
    assert len(_genes(page)) == 1, _genes(page)


# ------------------------------------------------------------------ 3: the table's rows change

def test_the_axis_follows_the_tables_filter_with_one_request_and_keeps_what_it_shows_meanwhile(page, served):
    _open(page, served, {G: _plot(color=_stat()), TA: _table()})
    page.wait_for_selector(f"{T} .dataTables_scrollBody tbody tr", timeout=30000)
    _wait_colours(page, _numbers("mean", ALL))
    n = len(_genes(page))
    with page.expect_request(_computes_genes) as asked:
        page.fill(f'{T} input[type="search"]', "Monocyte")
    body = json.loads(asked.value.post_data)
    assert body["shape"] == "genes" and body["member"] in body["sets"]
    _wait_colours(page, _numbers("mean", MONOCYTE))
    assert len(_genes(page)) == n + 1, "one request for the filter"
    assert _notice(page) is None
    # the filter cleared: the cells of the first request again, from the store (the same bitset, the same key)
    page.fill(f'{T} input[type="search"]', "")
    _wait_colours(page, _numbers("mean", ALL))
    assert len(_genes(page)) == n + 1, "the same rows are the same key: nothing is asked again"


def test_a_table_with_no_rows_says_so_and_a_deleted_table_says_so_and_the_setting_is_kept(page, served):
    _open(page, served, {G: _plot(color=_stat()), TA: _table()})
    page.wait_for_selector(f"{T} .dataTables_scrollBody tbody tr", timeout=30000)
    _wait_colours(page, _numbers("mean", ALL))
    page.fill(f'{T} input[type="search"]', "no such cell type")
    until(page, "(t) => { const n = document.querySelector(t + ' .score-notice'); return !!n && n.dataset.state === 'empty'; }", C, timeout=60)
    assert "no rows" in _notice(page)["text"]
    page.fill(f'{T} input[type="search"]', "")
    _wait_colours(page, _numbers("mean", ALL))
    page.evaluate("(id) => window.PanelManager.removePanel(id)", TA)
    until(page, "(t) => { const n = document.querySelector(t + ' .score-notice'); return !!n && n.dataset.state === 'deleted'; }", C, timeout=60)
    assert "was deleted" in _notice(page)["text"].lower() or "deleted" in _notice(page)["text"].lower()
    assert _config(page)["key"] == TA and _config(page)["type"] == "table-stat", "the setting is kept, so Choose another is a choice"


# ------------------------------------------------------------------ 4: Expressed above of the table

def test_the_tables_expressed_above_is_the_threshold_and_a_change_is_one_request(page, served):
    _open(page, served, {G: _plot(color=_stat(stat="fraction_of_cells")), TA: _table()})
    page.wait_for_selector(f"{T} .cmeth__toggle", timeout=30000)
    _wait_colours(page, _numbers("fraction_of_cells", ALL))
    n = len(_genes(page))
    page.click(f"{T} .cmeth__toggle")
    page.locator(POP).wait_for(state="visible")
    box = f"{POP} [data-param='detect_above']"
    page.fill(box, "0.5")
    with page.expect_request(_computes_genes) as asked:
        page.press(box, "Enter")
    assert json.loads(asked.value.post_data)["thresholds"] == [0.5]
    _wait_colours(page, _numbers("fraction_of_cells", ALL, threshold=0.5))
    assert len(_genes(page)) == n + 1


# ------------------------------------------------------------------ 5: a link

def test_a_link_round_trip_keeps_the_setting_and_the_values(page, served):
    _open(page, served, {G: _plot(color=_stat(stat="sd")), TA: _table()})
    _wait_colours(page, np.sqrt(np.maximum(DATA.layer("logged").astype(np.float64).var(axis=0), 0)))
    root, store = served
    payload = page.evaluate("""async () => { const { encodeViewPayload } = await import('/static/js/utils/deeplink.js');
        return await encodeViewPayload(window.sessionManager.captureView()); }""")
    cfg = page.evaluate("() => window.sessionManager.captureView()")["layout"]["panelConfigs"][G]["color"]
    assert (cfg["type"], cfg["key"], cfg["stat"], cfg["layer"]) == ("table-stat", TA, "sd", "logged")
    page.goto("about:blank")
    page.goto(f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={payload}")
    page.wait_for_selector(f"{C} .js-plotly-plot", timeout=30000)
    _wait_colours(page, np.sqrt(np.maximum(DATA.layer("logged").astype(np.float64).var(axis=0), 0)))
    assert page.input_value(axis_sets.sel(C, "color", "type")) == "layer" and page.input_value(axis_sets.sel(C, "color", "key")) == "logged"
    assert page.input_value(axis_sets.sel(C, "color", "column")) == _entry()


# ------------------------------------------------------------------ 6: Undo and Refresh

def test_choosing_a_table_and_then_a_statistic_undoes_in_one_step_back_to_the_colour_before(page, served):
    """The plot's Undo (ui/panel-undo.js) makes changes of one kind within a short while one step: the colour set to a table and
    given a statistic goes back to what it was with one Undo, and asks for nothing."""
    _open(page, served, {G: _plot(), TA: _table()})
    page.wait_for_selector(f"{T} .dataTables_scrollBody tbody tr", timeout=30000)
    _pick_table(page)
    _wait_colours(page, _numbers("mean", ALL))
    axis_sets.choose_aggregation(page, C, "color", "sum")
    _wait_colours(page, _numbers("sum", ALL))
    page.click(f"#plot-undo-{G}")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().color.type === 'none'", G)
    assert not page.is_visible(axis_sets.button(C, "color")), "the table is gone from the row with the step"
    assert len(_genes(page)) == 1, "going back asked for nothing"
    assert "stat" not in _config(page) and "key" in _config(page)


def test_the_header_refresh_keeps_the_axis_and_its_values(page, served):
    _open(page, served, {G: _plot(color=_stat()), TA: _table()})
    page.wait_for_selector(f"{T} .dataTables_scrollBody tbody tr", timeout=30000)
    _wait_colours(page, _numbers("mean", ALL))
    with page.expect_response(lambda r: r.request.method == "POST" and "/api/v1/data/refresh" in r.url, timeout=30000):
        page.click("#refresh-dataset")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().color.type === 'table-stat'", G)
    _wait_colours(page, _numbers("mean", ALL))
    assert _config(page)["key"] == TA and _config(page)["stat"] == "mean"
