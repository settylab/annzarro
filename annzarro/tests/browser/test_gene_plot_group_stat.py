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
    assert stats == ["zscore_mean", "mean", "pct_expressing", "mean_expressing", "sum", "sd"], "every statistic but Cell count"
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


COLUMN = 'select.axis-column-select[data-axis="color"]'
FILTER = 'input.group-filter[data-axis="color"]'


def _visible_options(page):
    return page.evaluate("""(sel) => [...document.querySelector(sel).options].filter(o => !o.hidden).map(o => [o.value, o.textContent])""", f"{C} {COLUMN}")


def _many(page, served, **grouping):
    many = {"source": {"type": "obs", "key": "many"}}
    _open(page, served, {G: _plot(), GA: _grouping(partitionings=[many], **grouping)})
    until(page, "(t) => !!document.querySelector(t + ' select.axis-type-select[data-axis=\"color\"] option[value=\"group-stat\"]')", C)
    _pick(page, "type", "group-stat")
    page.wait_for_selector(f"{C} {FILTER}", timeout=60000)


def test_a_grouping_of_many_groups_is_a_normal_dropdown_with_every_group_and_a_filter_beside_it(page, served):
    _many(page, served)
    select = f"{C} {COLUMN}"
    assert page.is_visible(select) and page.is_enabled(select), "the dropdown is there, as for every other source"
    assert len(_visible_options(page)) == 1201, "no typing: the choose entry and all 1,200 groups are listed"
    # the filter narrows the dropdown; the choose entry stays, and Enter chooses the first match
    page.fill(f"{C} {FILTER}", "m0007")
    shown = _visible_options(page)
    assert [v for v, _ in shown if v] == [json.dumps(["c:m0007"], separators=(",", ":"))], shown
    with page.expect_request(_computes_genes) as asked:
        page.press(f"{C} {FILTER}", "Enter")
    assert json.loads(asked.value.post_data)["group"] == ["c:m0007"]
    _wait_colours(page, 40)
    assert _config(page)["column"] == json.dumps(["c:m0007"], separators=(",", ":"))
    assert len(_visible_options(page)) == 1201, "the list is whole again once a group is chosen"
    assert page.input_value(f"{C} {FILTER}") == ""
    assert page.evaluate("(s) => document.querySelector(s).selectedOptions[0].textContent", select) == "m0007"


def test_the_dropdown_keeps_its_keyboard_after_the_filter(page, served):
    _many(page, served)
    page.fill(f"{C} {FILTER}", "m001")
    page.press(f"{C} {FILTER}", "ArrowDown")
    assert page.evaluate("(s) => document.activeElement === document.querySelector(s)", f"{C} {COLUMN}"), "Down goes to the select"
    # the select answers type-ahead as any select does (its options are the groups' names)
    page.focus(f"{C} {COLUMN}")
    page.keyboard.type("m0500")
    assert page.evaluate("(s) => document.querySelector(s).selectedOptions[0].textContent", f"{C} {COLUMN}") == "m0500"


def test_the_filter_finds_a_group_by_the_label_it_was_given_and_by_its_generated_name(page, served):
    _many(page, served, groupOverrides=[{"name": "m0100", "label": "Zeta cluster"}])
    names = [t for _, t in _visible_options(page)]
    assert "Zeta cluster" in names and "m0100" not in names, "the dropdown lists the displayed name"
    page.fill(f"{C} {FILTER}", "zeta")
    assert [t for v, t in _visible_options(page) if v] == ["Zeta cluster"], "the label the user gave"
    page.fill(f"{C} {FILTER}", "m0100")
    assert [t for v, t in _visible_options(page) if v] == ["Zeta cluster"], "and the generated name it is keyed by"
    page.fill(f"{C} {FILTER}", "nothing like it")
    assert [v for v, _ in _visible_options(page) if v] == []
    page.fill(f"{C} {FILTER}", "")
    assert len(_visible_options(page)) == 1201


# ------------------------------------------------------------------ every axis

def _same_set(got, want):
    """The distinct values drawn equal the statistic of the genes (a point may be drawn twice, as the focused one)."""
    return np.allclose(np.unique(np.round(got, 6)), np.unique(np.round(want, 6)), rtol=1e-6, atol=1e-6)


def _axis_values(page, axis):
    return page.evaluate("""([t, axis]) => { const gd = document.querySelector(t + ' .js-plotly-plot');
        const v = (gd.data || []).flatMap(d => Array.from(d[axis] || [])).filter(x => typeof x === 'number');
        return v; }""", [C, axis])


def test_x_and_y_take_a_group_statistic_and_two_axes_on_one_group_share_one_request(page, served):
    stat_x = _stat(stat="mean")
    stat_y = _stat(stat="sd")                     # another statistic of the same moments
    _open(page, served, {G: _plot(x=stat_x, y=stat_y), GA: _grouping()})
    until(page, "([t]) => { const gd = document.querySelector(t + ' .js-plotly-plot'); return !!gd && (gd.data || []).some(d => (d.x || []).filter(v => typeof v === 'number').length === 40); }", [C], timeout=60)
    xs, ys = _axis_values(page, "x"), _axis_values(page, "y")
    want_x, want_y = DATA.logged[B].astype(np.float64).mean(axis=0), DATA.logged[B].astype(np.float64).std(axis=0)
    assert _same_set(xs, want_x) and _same_set(ys, want_y)
    assert len(_genes(page)) == 1, f"the moments are shared by the two axes: {_genes(page)}"
    cfg = page.evaluate("(id) => { const c = window.PanelManager.getPanel(id).getConfig(); return [c.x, c.y]; }", G)
    assert [c["stat"] for c in cfg] == ["mean", "sd"] and all(c["type"] == "group-stat" for c in cfg), "each axis has its own setting"


def test_an_axis_is_chosen_in_its_own_selects_and_survives_a_link(page, served):
    _open(page, served, {G: _plot(), GA: _grouping()})
    until(page, "(t) => !!document.querySelector(t + ' select.axis-type-select[data-axis=\"x\"] option[value=\"group-stat\"]')", C)
    page.select_option(f'{C} select.axis-type-select[data-axis="x"]', "group-stat")
    until(page, "(t) => document.querySelectorAll(t + ' select.axis-column-select[data-axis=\"x\"] option').length > 2", C)
    page.select_option(f'{C} select.axis-layer-select[data-axis="x"]', "logged")
    with page.expect_request(_computes_genes):
        page.select_option(f'{C} select.axis-column-select[data-axis="x"]', B_KEY)
    until(page, "([t]) => { const gd = document.querySelector(t + ' .js-plotly-plot'); return !!gd && (gd.data || []).some(d => (d.x || []).filter(v => typeof v === 'number').length === 40); }", [C], timeout=60)
    assert _same_set(_axis_values(page, "x"), DATA.logged[B].astype(np.float64).mean(axis=0))
    root, store = served
    payload = page.evaluate("""async () => { const { encodeViewPayload } = await import('/static/js/utils/deeplink.js');
        return await encodeViewPayload(window.sessionManager.captureView()); }""")
    cfg = page.evaluate("() => window.sessionManager.captureView()")["layout"]["panelConfigs"][G]["x"]
    assert (cfg["type"], cfg["key"], cfg["column"], cfg["stat"], cfg["layer"]) == ("group-stat", GA, B_KEY, "mean", "logged")
    page.goto("about:blank")
    page.goto(f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={payload}")
    page.wait_for_selector(f"{C} .js-plotly-plot", timeout=30000)
    until(page, "([t]) => { const gd = document.querySelector(t + ' .js-plotly-plot'); return !!gd && (gd.data || []).some(d => (d.x || []).filter(v => typeof v === 'number').length === 40); }", [C], timeout=60)
    assert _same_set(_axis_values(page, "x"), DATA.logged[B].astype(np.float64).mean(axis=0))


def test_the_statistic_and_layer_selects_share_one_line_under_the_type_grouping_and_group(page, served):
    _open(page, served, {G: _plot(color=_stat()), GA: _grouping()})
    until(page, "(t) => !!document.querySelector(t + ' select.axis-stat-select[data-axis=\"color\"]')", C)
    boxes = page.evaluate("""(t) => { const row = document.querySelector(t + ' select.axis-type-select[data-axis="color"]').closest('.axis-selector');
        const top = (s) => Math.round(row.querySelector(s).getBoundingClientRect().top);
        const r = row.getBoundingClientRect();
        return { type: top('.axis-type-select'), key: top('.axis-key-select'), group: top('.axis-column-select'),
                 stat: top('.axis-stat-select'), layer: top('.axis-layer-select'), height: Math.round(r.height),
                 select: Math.round(row.querySelector('.axis-type-select').getBoundingClientRect().height) }; }""", C)
    assert boxes["stat"] == boxes["layer"], "the statistic and the layer are on one line"
    assert boxes["type"] == boxes["key"] == boxes["group"] and boxes["stat"] > boxes["type"], boxes
    assert boxes["height"] <= 2 * boxes["select"] + 12, f"two lines, as a gene score's row is: {boxes}"


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
