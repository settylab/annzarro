"""A Gene Plot coloured by a statistic of one group of a Cell Grouping (SO-8b), in a real browser against the real
cell_groups route (`shape: "genes"`, SO-8a).

1.  Color > Cell group > Grouping 1 > mean > logged > B cell sends ONE `genes` POST (the selects before the group ask
    nothing), and the colours are the mean of each gene over the B cells.
2.  Switching between statistics of the same moments (% expressing, SD, mean of expressing cells) sends none; % expressing
    is in the Cell-Gene Plot's units, 0 to 100.
3.  Expressed above edited in the grouping's Methods sends one, at the new threshold.
4.  A grouping whose level was renamed keeps the colour: the group is keyed by its key, the label is display.
5.  A group that is no longer one says "No longer a group" and asks for nothing.
6.  A link round trip keeps the setting and the colours.

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

from annzarro.tests.browser import waits  # noqa: E402
from annzarro.tests.browser.test_cell_gene_panel import DATA, _url, page, served  # noqa: E402,F401
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

G, GA = "gene-plot-G", "cell-grouping-A"
C = f'.tile[data-tile-id="{G}"]'
TG = f'.tile[data-tile-id="{GA}"]'
CELL_TYPE = {"source": {"type": "obs", "key": "cell_type"}}
B_KEY = json.dumps(["c:B cell"], separators=(",", ":"))
NONE = {"type": "none", "key": "", "column": ""}
POP = "[data-popover='methods']"
B = (DATA.obs["cell_type"] == "B cell").to_numpy()


def _plot(**extra):
    cfg = {"id": G, "title": "Gene Plot 1", "x": {"type": "layer", "key": "logged", "column": "CELL0000"},
           "y": {"type": "layer", "key": "logged", "column": "CELL0001"}, "z": None, "color": NONE, "pointSize": 6,
           "pointOpacity": 1, "categoryPalette": "uns"}
    cfg.update(extra)
    return cfg


def _grouping(**extra):
    return {"id": GA, "title": "Grouping 1", "version": 1, "partitionings": [CELL_TYPE], **extra}


def _stat(**extra):
    return {"type": "group-stat", "key": GA, "column": B_KEY, "stat": "mean", "layer": "logged", "groupWas": ["B cell"], **extra}


def _open(page, served, configs, open_ids=(G, GA)):
    page.goto(_url(served, list(open_ids), configs))
    page.wait_for_selector(f"{C} .js-plotly-plot", timeout=30000)


def _genes(page):
    return [c for c in page.calls if c.get("shape") == "genes"]


def _colours(page):
    """The colour of every gene as drawn, sorted (the plot may order its points by colour)."""
    return page.evaluate("""(t) => { const gd = document.querySelector(t + ' .js-plotly-plot');
        const v = (gd.data || []).flatMap(d => Array.from((d.marker && d.marker.color) || []));
        return v.filter(x => typeof x === 'number').sort((a, b) => a - b); }""", C)


def _wait_colours(page, n):
    until(page, """([t, n]) => { const gd = document.querySelector(t + ' .js-plotly-plot');
        return !!gd && (gd.data || []).flatMap(d => Array.from((d.marker && d.marker.color) || [])).filter(x => typeof x === 'number').length === n; }""",
          [C, n], timeout=60)


def _pick(page, kind, value):
    page.select_option(f'{C} select.axis-{kind}-select[data-axis="color"]', value)


def _config(page):
    return page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig().color", G)


def _notice(page):
    return page.evaluate("""(t) => { const el = document.querySelector(t + ' .score-notice');
        return el ? { state: el.dataset.state, text: el.textContent.replace(/\\s+/g, ' ').trim() } : null; }""", C)


def _numbers(stat, layer="logged", threshold=0.0):
    """The statistic of every gene over the B cells, from the dataset, by NumPy (as the plot should show it)."""
    x = DATA.layer(layer)[B].astype(np.float64)
    above = x > threshold
    if stat == "mean":
        out = x.mean(axis=0)
    elif stat == "sum":
        out = x.sum(axis=0)
    elif stat == "sd":
        out = x.std(axis=0)
    elif stat == "pct_expressing":
        out = 100 * above.mean(axis=0)                              # % expressing, as the Cell-Gene Plot has it: 0 to 100
    else:
        out = np.where(above.sum(axis=0) > 0, (x * above).sum(axis=0) / np.maximum(above.sum(axis=0), 1), 0.0)
    return np.sort(out)


def _close(got, want):
    return len(got) == len(want) and np.allclose(got, want, rtol=1e-6, atol=1e-7)


# ------------------------------------------------------------------ 1 and 2: the path, and a switch of statistic

def test_the_path_through_the_selects_sends_one_request_and_a_switch_of_statistic_sends_none(page, served):
    _open(page, served, {G: _plot(), GA: _grouping()})
    until(page, "(t) => !!document.querySelector(t + ' select.axis-type-select[data-axis=\"color\"] option[value=\"group-stat\"]')", C)
    types = dict(page.evaluate("""(t) => [...document.querySelectorAll(t + ' select.axis-type-select[data-axis="color"] option')]
        .map(o => [o.value, o.textContent])""", C))
    assert types["group-stat"] == "Cell group", types
    _pick(page, "type", "group-stat")
    until(page, "(t) => document.querySelector(t + ' select.axis-key-select[data-axis=\"color\"]').value === 'cell-grouping-A'", C)
    # the group select lists the groups of the grouping, in group order; none is chosen yet
    until(page, "(t) => document.querySelectorAll(t + ' select.axis-column-select[data-axis=\"color\"] option').length > 2", C)
    groups = page.evaluate("""(t) => [...document.querySelectorAll(t + ' select.axis-column-select[data-axis="color"] option')]
        .map(o => [o.value, o.textContent, o.disabled])""", C)
    assert groups[0] == ["", "Choose a group", True] and groups[1] == [B_KEY, "B cell", False] and len(groups) == 7, groups
    layers = page.evaluate("""(t) => [...document.querySelectorAll(t + ' select.axis-layer-select[data-axis="color"] option')].map(o => o.value)""", C)
    assert "logged" in layers and "X" in layers, layers
    stats = page.evaluate("""(t) => [...document.querySelectorAll(t + ' select.axis-stat-select[data-axis="color"] option')].map(o => o.value)""", C)
    assert stats == ["mean", "pct_expressing", "mean_expressing", "sum", "sd"], "every statistic but Cell count"
    # the selects before the group ask nothing
    _pick(page, "layer", "logged")
    _pick(page, "stat", "mean")
    waits.expect_stays(lambda: not _genes(page), "no group is chosen: nothing is asked", page=page, seconds=1.0)
    _pick(page, "column", B_KEY)
    _wait_colours(page, 40)
    assert len(_genes(page)) == 1, _genes(page)
    request = _genes(page)[0]
    assert request["group"] == ["c:B cell"] and request["layer"] == "logged" and request["thresholds"] == [0]
    assert _close(_colours(page), _numbers("mean"))
    cfg = _config(page)
    assert (cfg["type"], cfg["key"], cfg["column"], cfg["stat"], cfg["layer"], cfg["groupWas"]) == \
        ("group-stat", GA, B_KEY, "mean", "logged", ["B cell"])
    # the other statistics are the same moments: no request; % expressing is 0 to 100
    for stat in ("pct_expressing", "sd", "mean_expressing", "sum", "mean"):
        _pick(page, "stat", stat)
        until(page, "([id, s]) => window.PanelManager.getPanel(id).getConfig().color.stat === s", [G, stat])
        until(page, """([t, want]) => { const gd = document.querySelector(t + ' .js-plotly-plot');
            const v = (gd.data || []).flatMap(d => Array.from((d.marker && d.marker.color) || [])).filter(x => typeof x === 'number').sort((a, b) => a - b);
            return v.length === want.length && v.every((x, i) => Math.abs(x - want[i]) < 1e-6 * Math.max(1, Math.abs(want[i])) + 1e-7); }""",
              [C, _numbers(stat).tolist()], timeout=30)
    assert len(_genes(page)) == 1, "switching between statistics of the same moments sent nothing"
    assert max(_numbers("pct_expressing")) <= 100.0


def _computes_genes(request):
    body = json.loads(request.post_data or "{}")
    return "/data/cell_groups" in request.url and request.method == "POST" and body.get("shape") == "genes" and not body.get("estimate_only")


def test_another_layer_is_another_request(page, served):
    _open(page, served, {G: _plot(color=_stat()), GA: _grouping()})
    _wait_colours(page, 40)
    assert len(_genes(page)) == 1
    with page.expect_request(_computes_genes):
        _pick(page, "layer", "counts")
    assert _genes(page)[1]["layer"] == "counts" and _genes(page)[1]["group"] == ["c:B cell"]
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().color.layer === 'counts'", G)
    waits.expect_stays(lambda: len(_genes(page)) == 2, "one request for the new layer", page=page, seconds=1.0)


# ------------------------------------------------------------------ 3: Expressed above

def test_expressed_above_edited_in_the_groupings_methods_sends_one_request(page, served):
    _open(page, served, {G: _plot(color=_stat(stat="pct_expressing")), GA: _grouping()})
    _wait_colours(page, 40)
    assert _close(_colours(page), _numbers("pct_expressing"))
    n = len(_genes(page))
    page.wait_for_selector(f"{TG} .cgrp-controls .cmeth__toggle", timeout=30000)
    page.click(f"{TG} .cmeth__toggle")
    page.locator(POP).wait_for(state="visible")
    box = f"{POP} [data-param='detect_above']"
    page.fill(box, "0.5")
    with page.expect_request(_computes_genes):
        page.press(box, "Enter")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().detect_above === 0.5", GA)
    until(page, """([t, want]) => { const gd = document.querySelector(t + ' .js-plotly-plot');
        const v = (gd.data || []).flatMap(d => Array.from((d.marker && d.marker.color) || [])).filter(x => typeof x === 'number').sort((a, b) => a - b);
        return v.length === want.length && v.every((x, i) => Math.abs(x - want[i]) < 1e-6); }""", [C, _numbers("pct_expressing", threshold=0.5).tolist()], timeout=60)
    new = _genes(page)[n:]
    assert len(new) == 1 and new[0]["thresholds"] == [0.5], new


# ------------------------------------------------------------------ 4 and 5: a renamed group, a group that is gone

def test_a_renamed_level_keeps_the_colour_and_the_group_is_listed_by_its_new_name(page, served):
    renamed = {**CELL_TYPE, "labels": {"c:B cell": "B lymphocyte"}}
    _open(page, served, {G: _plot(color=_stat()), GA: _grouping(partitionings=[renamed])})
    _wait_colours(page, 40)
    assert _close(_colours(page), _numbers("mean"))
    assert _notice(page) is None, "a rename is display only: no notice"
    names = page.evaluate("""(t) => [...document.querySelectorAll(t + ' select.axis-column-select[data-axis="color"] option')].map(o => o.textContent)""", C)
    assert "B lymphocyte" in names and "B cell" not in names, names
    assert _config(page)["column"] == B_KEY


def test_a_group_that_is_no_longer_one_says_so_and_asks_for_nothing(page, served):
    gone = _stat(column=json.dumps(["c:Ghost"], separators=(",", ":")), groupWas=["Ghost"])
    _open(page, served, {G: _plot(color=gone), GA: _grouping()})
    until(page, "(t) => { const n = document.querySelector(t + ' .score-notice'); return !!n && n.dataset.state === 'gone'; }", C, timeout=60)
    assert "no longer a group" in _notice(page)["text"].lower()
    waits.expect_stays(lambda: not _genes(page), "a group that is gone asks for nothing", page=page, seconds=1.0)


ROW = f"{TG} .cgg-row:has(.cgg-name:text-is('B cell'))"
FIELD = f"{TG} .cgg-edit input.cgg-edit__name"
LEVELS = "[data-popover='levels']"


def test_a_group_renamed_live_in_the_grouping_grid_keeps_colouring_with_the_new_name(page, served):
    _open(page, served, {G: _plot(color=_stat()), GA: _grouping()})
    _wait_colours(page, 40)
    want = _colours(page)
    asked = len(_genes(page))
    page.dblclick(f"{ROW} .cgg-name")
    page.wait_for_selector(FIELD)
    page.fill(FIELD, "B lymphocytes")
    page.keyboard.press("Enter")
    until(page, """(t) => [...document.querySelectorAll(t + ' select.axis-column-select[data-axis="color"] option')].some(o => o.textContent === 'B lymphocytes')""", C)
    names = page.evaluate("""(t) => [...document.querySelectorAll(t + ' select.axis-column-select[data-axis="color"] option')].map(o => o.textContent)""", C)
    assert "B cell" not in names, names
    assert page.evaluate("(t) => document.querySelector(t + ' select.axis-column-select[data-axis=\"color\"]').selectedOptions[0].textContent", C) == "B lymphocytes"
    until(page, "(id) => (window.PanelManager.getPanel(id).getConfig().color.labelFull || '').includes('B lymphocytes')", G)
    assert _config(page)["column"] == B_KEY, "the key is the group's; the name is display"
    assert _notice(page) is None
    assert _close(_colours(page), want)
    waits.expect_stays(lambda: len(_genes(page)) == asked, "a name is a label: nothing is asked", page=page, seconds=1.0)


def test_a_group_removed_live_from_the_grouping_says_it_is_no_longer_a_group(page, served):
    _open(page, served, {G: _plot(color=_stat()), GA: _grouping()})
    _wait_colours(page, 40)
    asked = len(_genes(page))
    page.click(f"{TG} .cgrp-card[data-index='0'] .cgrp-card__edit")
    page.wait_for_selector(LEVELS, state="visible")
    page.uncheck(f"{LEVELS} .cgrp-level[data-id='c:B cell'] input[type=checkbox]")      # B cell joins the others: no such group now
    until(page, "(t) => { const n = document.querySelector(t + ' .score-notice'); return !!n && n.dataset.state === 'gone'; }", C, timeout=60)
    assert "no longer a group" in _notice(page)["text"].lower()
    assert _config(page)["column"] == B_KEY, "the setting is kept, so Choose another is a choice"
    waits.expect_stays(lambda: len(_genes(page)) == asked, "a group that is gone asks for nothing", page=page, seconds=1.0)


def test_a_grouping_of_many_groups_is_searched_not_scrolled(page, served):
    many = {"source": {"type": "obs", "key": "many"}}
    _open(page, served, {G: _plot(), GA: _grouping(partitionings=[many])})
    until(page, "(t) => !!document.querySelector(t + ' select.axis-type-select[data-axis=\"color\"] option[value=\"group-stat\"]')", C)
    _pick(page, "type", "group-stat")
    search = f'{C} input.group-search[data-axis="color"]'
    page.wait_for_selector(search, timeout=60000)
    assert page.is_hidden(f'{C} select.axis-column-select[data-axis="color"]'), "the 1,200 groups are not a select"
    assert page.evaluate("(s) => document.getElementById(document.querySelector(s).getAttribute('list')).children.length", search) == 1200
    with page.expect_request(_computes_genes) as asked:
        page.fill(search, "m0007")
        page.press(search, "Tab")
    assert json.loads(asked.value.post_data)["group"] == ["c:m0007"]
    _wait_colours(page, 40)
    assert _config(page)["column"] == json.dumps(["c:m0007"], separators=(",", ":"))
    assert page.input_value(search) == "m0007"


# ------------------------------------------------------------------ 6: a link

def test_a_link_round_trip_keeps_the_setting_and_the_colours(page, served):
    _open(page, served, {G: _plot(color=_stat(stat="sd")), GA: _grouping()})
    _wait_colours(page, 40)
    want = _colours(page)
    root, store = served
    payload = page.evaluate("""async () => { const { encodeViewPayload } = await import('/static/js/utils/deeplink.js');
        return await encodeViewPayload(window.sessionManager.captureView()); }""")
    view = page.evaluate("() => window.sessionManager.captureView()")
    cfg = view["layout"]["panelConfigs"][G]["color"]
    assert (cfg["type"], cfg["key"], cfg["column"], cfg["stat"], cfg["layer"], cfg["groupWas"]) == \
        ("group-stat", GA, B_KEY, "sd", "logged", ["B cell"])
    page.goto("about:blank")
    page.goto(f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={payload}")
    page.wait_for_selector(f"{C} .js-plotly-plot", timeout=30000)
    _wait_colours(page, 40)
    assert _close(_colours(page), want)
