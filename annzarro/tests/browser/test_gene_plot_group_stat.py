"""A Gene Plot coloured by a statistic of one group of a Cell Grouping (SO-8b), in a real browser against the real
cell_groups route (`shape: "genes"`, SO-8a).

1.  Color > layer logged > Grouping 1 / B cell (in the item picker, under Cell groupings) sends ONE `genes` POST, and the
    colours are the mean of each gene over the B cells.
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

from annzarro.tests.browser import axis_sets, waits  # noqa: E402
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
        const v = ((gd && gd.data) || []).flatMap(d => Array.from((d.marker && d.marker.color) || []));
        return v.filter(x => typeof x === 'number').sort((a, b) => a - b); }""", C)


def _wait_colours(page, n):
    until(page, """([t, n]) => { const gd = document.querySelector(t + ' .js-plotly-plot');
        return !!gd && ((gd && gd.data) || []).flatMap(d => Array.from((d.marker && d.marker.color) || [])).filter(x => typeof x === 'number').length === n; }""",
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


# ------------------------------------------------------------------ helpers of the row: layer, item picker, aggregation

def _entry(group_key=B_KEY, grouping=GA):
    """The item picker's value of a group: the grouping and the group's key."""
    return axis_sets.set_value("group-stat", json.dumps([grouping, group_key], separators=(",", ":")))


def _items(page, axis="color"):
    return page.evaluate("""(s) => [...document.querySelector(s).options].map(o => [o.value, o.textContent, o.parentElement.tagName === 'OPTGROUP' ? o.parentElement.label : '', o.hidden])""",
                         axis_sets.sel(C, axis, "column"))


def _wait_stat(page, stat):
    """Wait until the colours drawn are the statistic of the genes over the B cells."""
    until(page, """([t, want]) => { const gd = document.querySelector(t + ' .js-plotly-plot');
        const v = ((gd && gd.data) || []).flatMap(d => Array.from((d.marker && d.marker.color) || [])).filter(x => typeof x === 'number').sort((a, b) => a - b);
        return v.length === want.length && v.every((x, i) => Math.abs(x - want[i]) < 1e-6 * Math.max(1, Math.abs(want[i])) + 1e-7); }""",
          [C, _numbers(stat).tolist()], timeout=30)


def _computes_genes(request):
    body = json.loads(request.post_data or "{}")
    return "/data/cell_groups" in request.url and request.method == "POST" and body.get("shape") == "genes" and not body.get("estimate_only")


def _pick_group(page, axis="color", layer="logged", group_key=B_KEY):
    """Layer source, its layer, then the group in the item picker: one request when the group is chosen."""
    page.select_option(axis_sets.sel(C, axis, "type"), "layer")
    until(page, "([s]) => document.querySelector(s).options.length > 1", [axis_sets.sel(C, axis, "key")])
    if page.input_value(axis_sets.sel(C, axis, "key")) != layer:
        page.select_option(axis_sets.sel(C, axis, "key"), layer)
    until(page, "([s, v]) => [...document.querySelector(s).options].some(o => o.value === v)", [axis_sets.sel(C, axis, "column"), _entry(group_key)])
    page.select_option(axis_sets.sel(C, axis, "column"), _entry(group_key))
    page.wait_for_selector(axis_sets.button(C, axis))


# ------------------------------------------------------------------ 1 and 2: the path, and a switch of statistic

def test_the_path_through_the_row_sends_one_request_and_a_switch_of_statistic_sends_none(page, served):
    _open(page, served, {G: _plot(), GA: _grouping()})
    until(page, "(t) => !!document.querySelector(t + ' select.axis-type-select[data-axis=\"color\"] option[value=\"layer\"]')", C)
    shown = page.evaluate("(t) => [...document.querySelectorAll(t + ' select.axis-type-select[data-axis=\"color\"] option')].map(o => o.value)", C)
    assert "group-stat" not in shown, f"a group is no source: it is picked in the item picker of a layer ({shown})"
    page.select_option(axis_sets.sel(C, "color", "type"), "layer")
    until(page, "(s) => [...document.querySelector(s).options].some(o => o.textContent.includes('B cell'))", axis_sets.sel(C, "color", "column"))
    items = _items(page)
    groups = [(t, g) for _, t, g, _ in items if g == "Cell groupings"]
    assert groups[0] == ("Grouping 1 \u203a B cell", "Cell groupings") and len(groups) == 6, groups
    assert not [g for _, _, g, _ in items if g == "Gene signatures"], "a Gene Plot lists cell sets only"
    assert not _genes(page), "nothing is asked before a group is chosen"
    layers = [o["v"] for o in axis_sets.layer_options(page, C, "color")]
    assert "logged" in layers and "X" in layers, layers
    page.select_option(axis_sets.sel(C, "color", "key"), "logged")
    waits.expect_stays(lambda: not _genes(page), "no group is chosen: nothing is asked", page=page, seconds=1.0)
    with page.expect_request(_computes_genes):
        page.select_option(axis_sets.sel(C, "color", "column"), _entry())
    page.wait_for_selector(axis_sets.button(C, "color"))
    _wait_stat(page, "mean")
    assert len(_genes(page)) == 1, _genes(page)
    request = _genes(page)[0]
    assert request["group"] == ["c:B cell"] and request["layer"] == "logged" and request["thresholds"] == [0]
    assert _close(_colours(page), _numbers("mean"))
    cfg = _config(page)
    assert (cfg["type"], cfg["key"], cfg["column"], cfg["stat"], cfg["layer"], cfg["groupWas"]) == \
        ("group-stat", GA, B_KEY, "mean", "logged", ["B cell"])
    assert page.get_attribute(axis_sets.button(C, "color"), "aria-label") == "Aggregation: Mean"
    stats = axis_sets.aggregations(page, C, "color")
    assert [r["v"] for r in stats] == ["zscore_mean", "mean", "pct_expressing", "mean_expressing", "sum", "sd"], "every statistic but Cell count"
    assert [r["text"].split(" ", 1)[1] for r in stats] == ["Z-score mean", "Mean", "% expressing", "Mean of expressing cells", "Sum", "SD"]
    # the other statistics are the same moments: no request; % expressing is 0 to 100
    for stat in ("pct_expressing", "sd", "mean_expressing", "sum", "mean"):
        axis_sets.choose_aggregation(page, C, "color", stat)
        until(page, "([id, s]) => window.PanelManager.getPanel(id).getConfig().color.stat === s", [G, stat])
        _wait_stat(page, stat)
    assert len(_genes(page)) == 1, "switching between statistics of the same moments sent nothing"
    assert max(_numbers("pct_expressing")) <= 100.0


def test_another_layer_is_another_request(page, served):
    _open(page, served, {G: _plot(color=_stat()), GA: _grouping()})
    _wait_colours(page, 40)
    assert len(_genes(page)) == 1
    with page.expect_request(_computes_genes):
        page.select_option(axis_sets.sel(C, "color", "key"), "counts")
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
        const v = ((gd && gd.data) || []).flatMap(d => Array.from((d.marker && d.marker.color) || [])).filter(x => typeof x === 'number').sort((a, b) => a - b);
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
    names = [t for _, t, _, _ in _items(page)]
    assert "Grouping 1 \u203a B lymphocyte" in names and not any("B cell" in n for n in names), names
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
    until(page, """(t) => [...document.querySelectorAll(t + ' select.axis-column-select[data-axis="color"] option')].some(o => o.textContent === 'Grouping 1 \u203a B lymphocytes')""", C)
    names = [t for _, t, _, _ in _items(page)]
    assert "Grouping 1 \u203a B cell" not in names, names
    assert page.evaluate("(s) => document.querySelector(s).selectedOptions[0].textContent", axis_sets.sel(C, "color", "column")) == "Grouping 1 \u203a B lymphocytes"
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


FILTER = 'input.group-filter[data-axis="color"]'
COLUMN = 'select.axis-column-select[data-axis="color"]'


def _visible_items(page):
    return [(v, t) for v, t, _, hidden in _items(page) if not hidden]


def _many(page, served, **grouping):
    many = {"source": {"type": "obs", "key": "many"}}
    _open(page, served, {G: _plot(), GA: _grouping(partitionings=[many], **grouping)})
    until(page, "(t) => !!document.querySelector(t + ' select.axis-type-select[data-axis=\"color\"] option[value=\"layer\"]')", C)
    page.select_option(axis_sets.sel(C, "color", "type"), "layer")
    page.wait_for_selector(f"{C} {FILTER}", timeout=60000)


def test_a_grouping_of_many_groups_is_a_normal_dropdown_with_every_group_and_a_filter_beside_it(page, served):
    _many(page, served)
    select = f"{C} {COLUMN}"
    assert page.is_visible(select) and page.is_enabled(select), "the dropdown is there, as for every other source"
    groups = [(v, t) for v, t in _visible_items(page) if t.startswith("Grouping 1")]
    assert len(groups) == 1200, "no typing: all 1,200 groups are listed"
    page.fill(f"{C} {FILTER}", "m0007")
    shown = [t for v, t in _visible_items(page) if v and t.startswith("Grouping 1")]
    assert shown == ["Grouping 1 \u203a m0007"], shown
    with page.expect_request(_computes_genes) as asked:
        page.press(f"{C} {FILTER}", "Enter")
    assert json.loads(asked.value.post_data)["group"] == ["c:m0007"]
    _wait_colours(page, 40)
    assert _config(page)["column"] == json.dumps(["c:m0007"], separators=(",", ":"))
    assert len([1 for v, t in _visible_items(page) if t.startswith("Grouping 1")]) == 1200, "the list is whole again once a group is chosen"
    assert page.input_value(f"{C} {FILTER}") == ""
    assert page.evaluate("(s) => document.querySelector(s).selectedOptions[0].textContent", select) == "Grouping 1 \u203a m0007"


def test_the_dropdown_keeps_its_keyboard_after_the_filter(page, served):
    _many(page, served)
    page.fill(f"{C} {FILTER}", "m001")
    page.press(f"{C} {FILTER}", "ArrowDown")
    assert page.evaluate("(s) => document.activeElement === document.querySelector(s)", f"{C} {COLUMN}"), "Down goes to the select"
    # Escape clears the filter; the select answers type-ahead as any select does (its options are the groups' names)
    page.press(f"{C} {FILTER}", "Escape")
    assert len([1 for v, t in _visible_items(page) if t.startswith("Grouping 1")]) == 1200
    # the select itself is the native one: focusable, with every option a real entry the arrow keys and type-ahead reach
    assert page.evaluate("(s) => { const e = document.querySelector(s); return e.tagName === 'SELECT' && !e.hidden && e.tabIndex >= 0; }", f"{C} {COLUMN}")
    page.press(f"{C} {FILTER}", "ArrowDown")
    assert page.evaluate("(s) => document.activeElement === document.querySelector(s)", f"{C} {COLUMN}")


def test_the_filter_finds_a_group_by_the_label_it_was_given_and_by_its_generated_name(page, served):
    _many(page, served, groupOverrides=[{"name": "m0100", "label": "Zeta cluster"}])
    names = [t for _, t in _visible_items(page)]
    assert "Grouping 1 \u203a Zeta cluster" in names and "Grouping 1 \u203a m0100" not in names, "the dropdown lists the displayed name"
    page.fill(f"{C} {FILTER}", "zeta")
    assert [t for v, t in _visible_items(page) if v and t.startswith("Grouping 1")] == ["Grouping 1 \u203a Zeta cluster"], "the label the user gave"
    # the section keeps its header while it has a hit, and the headers of sections with none are gone
    headers = page.evaluate("(s) => [...document.querySelector(s).querySelectorAll('optgroup')].filter(g => !g.hidden).map(g => g.label)", f"{C} {COLUMN}")
    assert headers == ["Cell groupings"], headers
    page.fill(f"{C} {FILTER}", "m0100")
    assert [t for v, t in _visible_items(page) if v and t.startswith("Grouping 1")] == ["Grouping 1 \u203a Zeta cluster"], "and the generated name it is keyed by"
    page.fill(f"{C} {FILTER}", "nothing like it")
    assert [t for v, t in _visible_items(page) if v and t.startswith("Grouping 1")] == []
    page.fill(f"{C} {FILTER}", "")
    assert len([1 for v, t in _visible_items(page) if t.startswith("Grouping 1")]) == 1200


# ------------------------------------------------------------------ every axis

def _same_set(got, want):
    """The distinct values drawn equal the statistic of the genes (a point may be drawn twice, as the focused one)."""
    return np.allclose(np.unique(np.round(got, 6)), np.unique(np.round(want, 6)), rtol=1e-6, atol=1e-6)


def _axis_values(page, axis):
    return page.evaluate("""([t, axis]) => { const gd = document.querySelector(t + ' .js-plotly-plot');
        const v = ((gd && gd.data) || []).flatMap(d => Array.from(d[axis] || [])).filter(x => typeof x === 'number');
        return v; }""", [C, axis])


def _wait_axis(page, axis, want):
    """Wait until the axis draws the distinct values `want` (the statistic of the genes)."""
    until(page, """([t, axis, want]) => { const gd = document.querySelector(t + ' .js-plotly-plot');
        const v = [...new Set((gd && gd.data || []).flatMap(d => Array.from(d[axis] || [])).filter(x => typeof x === 'number').map(x => Math.round(x * 1e6) / 1e6))].sort((a, b) => a - b);
        const w = [...new Set(want.map(x => Math.round(x * 1e6) / 1e6))].sort((a, b) => a - b);
        return v.length === w.length && v.every((x, i) => Math.abs(x - w[i]) < 2e-6); }""", [C, axis, [float(x) for x in want]], timeout=60)


def test_x_and_y_take_a_group_statistic_and_two_axes_on_one_group_share_one_request(page, served):
    stat_x = _stat(stat="mean")
    stat_y = _stat(stat="sd")                     # another statistic of the same moments
    _open(page, served, {G: _plot(x=stat_x, y=stat_y), GA: _grouping()})
    until(page, "([t]) => { const gd = document.querySelector(t + ' .js-plotly-plot'); return !!gd && ((gd && gd.data) || []).some(d => (d.x || []).filter(v => typeof v === 'number').length === 40); }", [C], timeout=60)
    xs, ys = _axis_values(page, "x"), _axis_values(page, "y")
    want_x, want_y = DATA.logged[B].astype(np.float64).mean(axis=0), DATA.logged[B].astype(np.float64).std(axis=0)
    assert _same_set(xs, want_x) and _same_set(ys, want_y)
    assert len(_genes(page)) == 1, f"the moments are shared by the two axes: {_genes(page)}"
    cfg = page.evaluate("(id) => { const c = window.PanelManager.getPanel(id).getConfig(); return [c.x, c.y]; }", G)
    assert [c["stat"] for c in cfg] == ["mean", "sd"] and all(c["type"] == "group-stat" for c in cfg), "each axis has its own setting"


def test_an_axis_is_chosen_in_its_own_row_and_survives_a_link(page, served):
    _open(page, served, {G: _plot(), GA: _grouping()})
    until(page, "(t) => !!document.querySelector(t + ' select.axis-type-select[data-axis=\"x\"] option[value=\"layer\"]')", C)
    page.select_option(axis_sets.sel(C, "x", "type"), "layer")
    until(page, "([s, v]) => [...document.querySelector(s).options].some(o => o.value === v)", [axis_sets.sel(C, "x", "column"), _entry()])
    page.select_option(axis_sets.sel(C, "x", "key"), "logged")
    until(page, "([s, v]) => [...document.querySelector(s).options].some(o => o.value === v)", [axis_sets.sel(C, "x", "column"), _entry()])
    with page.expect_request(_computes_genes):
        page.select_option(axis_sets.sel(C, "x", "column"), _entry())
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().x.type === 'group-stat'", G)
    _wait_axis(page, "x", DATA.logged[B].astype(np.float64).mean(axis=0))
    root, store = served
    payload = page.evaluate("""async () => { const { encodeViewPayload } = await import('/static/js/utils/deeplink.js');
        return await encodeViewPayload(window.sessionManager.captureView()); }""")
    cfg = page.evaluate("() => window.sessionManager.captureView()")["layout"]["panelConfigs"][G]["x"]
    assert (cfg["type"], cfg["key"], cfg["column"], cfg["stat"], cfg["layer"]) == ("group-stat", GA, B_KEY, "mean", "logged")
    page.goto("about:blank")
    page.goto(f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={payload}")
    page.wait_for_selector(f"{C} .js-plotly-plot", timeout=30000)
    _wait_axis(page, "x", DATA.logged[B].astype(np.float64).mean(axis=0))
    assert page.input_value(axis_sets.sel(C, "x", "type")) == "layer" and page.input_value(axis_sets.sel(C, "x", "key")) == "logged"


def test_three_aggregated_axes_are_three_one_line_rows_and_leaving_the_layer_clears_the_set(page, served):
    _open(page, served, {G: _plot(x=_stat(), y=_stat(stat="sd"), color=_stat(stat="pct_expressing")), GA: _grouping()})
    for axis in ("x", "y", "color"):
        page.wait_for_selector(axis_sets.button(C, axis), timeout=30000)
    boxes = page.evaluate("""(t) => ['x', 'y', 'color'].map((a) => { const row = document.querySelector(t + ` select.axis-type-select[data-axis="${a}"]`).closest('.axis-selector');
        const one = row.querySelector('.axis-type-select').getBoundingClientRect().height;
        return { axis: a, height: Math.round(row.getBoundingClientRect().height), select: Math.round(one),
                 extra: row.querySelectorAll('.axis-layer-select, .axis-stat-select').length }; })""", C)
    for b in boxes:
        assert b["extra"] == 0 and b["height"] <= b["select"] + 6, f"one line per axis: {b}"
    # each axis says its own aggregation, so the rows can be told apart
    assert [page.get_attribute(axis_sets.button(C, a), "aria-label") for a in ("x", "y", "color")] == \
        ["Aggregation: Mean", "Aggregation: SD", "Aggregation: % expressing"]
    # leaving the layer source clears the set completely: no stale statistic or group, and the axis is a plain one
    page.select_option(axis_sets.sel(C, "y", "type"), "var")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().y.type === 'var'", G)
    left = page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig().y", G)
    assert not [f for f in ("stat", "groupWas", "layer", "label", "labelFull", "follow") if f in left], left
    assert not page.is_visible(axis_sets.button(C, "y"))


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


SHOTS = os.environ.get("ANNZARRO_SHOTS")


@pytest.mark.skipif(not SHOTS, reason="screenshots only when ANNZARRO_SHOTS names a directory")
def test_screenshots_of_the_gene_plot_rows_and_the_open_item_picker(page, served):
    """(b) X on a group (x with a bar) with the item picker open, its sections listed; (c) a plain row beside an aggregated one."""
    # the grouping is closed (its tile not in the layout), so the plot has the width a plot has
    _open(page, served, {G: _plot(x=_stat(), y={"type": "layer", "key": "logged", "column": "CELL0003"}), GA: _grouping()}, open_ids=(G,))
    page.wait_for_selector(axis_sets.button(C, "x"), timeout=30000)
    os.makedirs(SHOTS, exist_ok=True)
    select = axis_sets.sel(C, "x", "column")
    for theme in ("light", "dark"):
        page.evaluate("(t) => { document.documentElement.setAttribute('data-theme', t); document.documentElement.setAttribute('data-bs-theme', t); }", theme)
        box = page.locator(f"{C} .plot-controls").bounding_box()
        page.screenshot(path=os.path.join(SHOTS, f"agg-c-gene-plain-beside-aggregated-{theme}.png"), clip={**box, "height": 150})
        # a native dropdown is not in a page screenshot: the list is unfolded in place, as the browser would show it
        page.evaluate("""(s) => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); e.__was = e.getAttribute('style') || '';
            e.size = 11; e.style.position = 'fixed'; e.style.zIndex = '9999'; e.style.height = 'auto'; e.style.left = r.left + 'px'; e.style.top = (r.bottom + 3) + 'px'; e.style.width = '340px'; }""", select)
        page.screenshot(path=os.path.join(SHOTS, f"agg-b-gene-group-item-picker-open-{theme}.png"), clip={**box, "height": 360})
        page.evaluate("(s) => { const e = document.querySelector(s); e.removeAttribute('size'); e.setAttribute('style', e.__was); }", select)


# ------------------------------------------------------------------ G1a: z-score mean of a group

def _zmeans():
    """The mean of each gene's clipped z-score (over ALL cells) over the B cells, by NumPy; genes with no spread have none."""
    x = DATA.logged.astype(np.float64)
    sd = x.std(axis=0)
    ok = sd > 0
    z = np.clip((x[:, ok] - x[:, ok].mean(axis=0)) / sd[ok], -10, 10)
    return np.sort(z[B].mean(axis=0))


def test_zscore_mean_on_csc_equals_cell_gene_row(page, served):
    """On a CSC store the Gene Plot offers z-score mean of a group: one `genes` request with the transform, and every
    gene's colour is the number the Cell-Gene Plot's gene row shows (the mean of its clipped z-score over all cells)."""
    _open(page, served, {G: _plot(color=_stat()), GA: _grouping()})
    _wait_colours(page, 40)
    axis_sets.until_methods(page, G, "color", "(o) => o.some((e) => e.value === 'zscore_mean' && !e.disabled)")
    with page.expect_request(_computes_genes):
        axis_sets.choose_aggregation(page, C, "color", "zscore_mean")
    want = _zmeans()
    until(page, """([t, want]) => { const gd = document.querySelector(t + ' .js-plotly-plot');
        const v = ((gd && gd.data) || []).flatMap(d => Array.from((d.marker && d.marker.color) || [])).filter(x => typeof x === 'number' && x === x).sort((a, b) => a - b);
        return v.length === want.length && v.every((x, i) => Math.abs(x - want[i]) < 1e-6 * Math.max(1, Math.abs(want[i])) + 1e-7); }""",
          [C, want.tolist()], timeout=30)
    request = _genes(page)[-1]
    assert request["transform"] == "zscore" and request["clip"] == 10 and request["layer"] == "logged", request
    # back to the mean reads the moments already held: no request, and the colours are the mean's again
    axis_sets.choose_aggregation(page, C, "color", "mean")
    _wait_stat(page, "mean")
    assert len(_genes(page)) == 2 and "transform" not in _genes(page)[0]


@pytest.fixture(scope="module")
def served_csr(tmp_path_factory):
    from annzarro.tests.browser import test_focus_outside_subset as focus
    from annzarro.tests.browser.test_names_dataset_scope import _serve
    from annzarro.tests.core import grouping_store as gstore
    original = focus._make_store
    focus._make_store = lambda path: (gstore.make_store(str(path), "csr", "zarr", data=DATA), str(path))[1]
    try:
        proc, root, store = _serve(tmp_path_factory)
    finally:
        focus._make_store = original
    yield root, store
    proc.terminate()
    proc.wait(10)


def test_zscore_mean_on_csr_disabled_with_reason(page, served_csr):
    _open(page, served_csr, {G: _plot(color=_stat()), GA: _grouping()})
    axis_sets.until_methods(page, G, "color", "(o) => o.some((e) => e.value === 'zscore_mean' && e.disabled && e.title.includes('whole-layer read'))")
    rows = {r["v"]: r for r in axis_sets.aggregations(page, C, "color")}
    assert rows["zscore_mean"]["off"] is True
    assert rows["zscore_mean"]["title"] == "Z-score mean of a cell group needs a whole-layer read on this store's layout; coming with the moments cache."
