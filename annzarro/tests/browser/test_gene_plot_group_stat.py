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
from annzarro.tests.core import grouping_store as gstore  # noqa: E402

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

def _entry(grouping=GA):
    """The item picker's value of a grouping: the groups of it are the row's next select."""
    return axis_sets.set_value("group-stat", grouping)


def _member(axis="color"):
    return axis_sets.sel(C, axis, "member")


def _members(page, axis="color"):
    return page.evaluate("(s) => [...document.querySelector(s).options].map(o => [o.value, o.textContent, o.disabled])", _member(axis))


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


def _pick_grouping(page, axis="color", layer="logged", grouping=GA):
    """Layer source, its layer, then the grouping in the item picker: the row takes its first group (one request)."""
    page.select_option(axis_sets.sel(C, axis, "type"), "layer")
    until(page, "([s]) => document.querySelector(s).options.length > 1", [axis_sets.sel(C, axis, "key")])
    if page.input_value(axis_sets.sel(C, axis, "key")) != layer:
        page.select_option(axis_sets.sel(C, axis, "key"), layer)
    until(page, "([s, v]) => [...document.querySelector(s).options].some(o => o.value === v)", [axis_sets.sel(C, axis, "column"), _entry(grouping)])
    page.select_option(axis_sets.sel(C, axis, "column"), _entry(grouping))
    page.wait_for_selector(axis_sets.button(C, axis))


# ------------------------------------------------------------------ 1 and 2: the path, and a switch of statistic

def test_the_path_through_the_row_sends_one_request_and_a_switch_of_statistic_sends_none(page, served):
    _open(page, served, {G: _plot(), GA: _grouping()})
    until(page, "(t) => !!document.querySelector(t + ' select.axis-type-select[data-axis=\"color\"] option[value=\"layer\"]')", C)
    shown = page.evaluate("(t) => [...document.querySelectorAll(t + ' select.axis-type-select[data-axis=\"color\"] option')].map(o => o.value)", C)
    assert "group-stat" not in shown, f"a group is no source: it is picked in the item picker of a layer ({shown})"
    page.select_option(axis_sets.sel(C, "color", "type"), "layer")
    until(page, "(s) => [...document.querySelector(s).options].some(o => o.textContent === 'Grouping 1')", axis_sets.sel(C, "color", "column"))
    items = _items(page)
    groupings = [(t, g) for _, t, g, _ in items if g == "Cell groupings"]
    assert groupings == [("Grouping 1", "Cell groupings")], "one entry per grouping, by its name: the groups are the next select"
    assert not [g for _, _, g, _ in items if g == "Gene signatures"], "a Gene Plot lists cell sets only"
    assert not page.is_visible(_member()) if page.locator(_member()).count() else True
    assert not _genes(page), "nothing is asked before a grouping is chosen"
    layers = [o["v"] for o in axis_sets.layer_options(page, C, "color")]
    assert "logged" in layers and "X" in layers, layers
    page.select_option(axis_sets.sel(C, "color", "key"), "logged")
    waits.expect_stays(lambda: not _genes(page), "no grouping is chosen: nothing is asked", page=page, seconds=1.0)
    with page.expect_request(_computes_genes):
        page.select_option(axis_sets.sel(C, "color", "column"), _entry())
    # the groups of the grouping follow, in its order, all of them, with the first chosen
    until(page, "([s]) => !!document.querySelector(s) && document.querySelector(s).options.length === 7", [_member()])
    members = _members(page)
    assert members[0] == ["", "Choose a group", True] and [t for _, t, _ in members[1:]] == [n for n, _ in gstore.CELL_TYPES], members
    assert page.input_value(_member()) == B_KEY
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
    names = [t for _, t, _ in _members(page)]
    assert "B lymphocyte" in names and "B cell" not in names, names
    assert page.evaluate("(s) => document.querySelector(s).selectedOptions[0].textContent", _member()) == "B lymphocyte"
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
    until(page, """(s) => [...document.querySelectorAll(s + ' option')].some(o => o.textContent === 'B lymphocytes')""", _member())
    names = [t for _, t, _ in _members(page)]
    assert "B cell" not in names, names
    assert page.evaluate("(s) => document.querySelector(s).selectedOptions[0].textContent", _member()) == "B lymphocytes"
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


def _many(page, served, **grouping):
    many = {"source": {"type": "obs", "key": "many"}}
    _open(page, served, {G: _plot(), GA: _grouping(partitionings=[many], **grouping)})
    until(page, "(t) => !!document.querySelector(t + ' select.axis-type-select[data-axis=\"color\"] option[value=\"layer\"]')", C)
    _pick_grouping(page)
    until(page, "([s]) => !!document.querySelector(s) && document.querySelector(s).options.length > 1000", [_member()])


def test_a_grouping_of_many_groups_lists_every_group_in_a_native_select_and_has_no_filter_field(page, served):
    _many(page, served)
    select = _member()
    assert page.is_visible(select) and page.is_enabled(select), "the groups are a select like every other"
    assert page.evaluate("(s) => { const e = document.querySelector(s); return e.tagName === 'SELECT' && e.className.includes('form-select-sm') && e.tabIndex >= 0; }", select)
    options = _members(page)
    assert [t for v, t, _ in options if v] == [f"m{i:04d}" for i in range(1200)], "all 1,200 groups, in the grouping's order, with no typing"
    assert page.locator(f"{C} input.group-filter, {C} .axis-selector input[type=search]").count() == 0, "no filter field in any axis row"
    # choosing one is a native choice: one request for that group
    with page.expect_request(_computes_genes) as asked:
        page.select_option(select, json.dumps(["c:m0007"], separators=(",", ":")))
    assert json.loads(asked.value.post_data)["group"] == ["c:m0007"]
    assert _config(page)["column"] == json.dumps(["c:m0007"], separators=(",", ":"))
    assert page.evaluate("(s) => document.querySelector(s).selectedOptions[0].textContent", select) == "m0007"
    assert len(_members(page)) == 1201


def test_a_group_with_a_custom_name_is_listed_by_it_and_a_renamed_grouping_by_its_new_name(page, served):
    _many(page, served, groupOverrides=[{"name": "m0100", "label": "Zeta cluster"}])
    names = [t for _, t, _ in _members(page)]
    assert "Zeta cluster" in names and "m0100" not in names, "the select lists the displayed name"
    page.evaluate("(id) => window.PanelManager.getPanel(id).setTitle('Many')", GA)
    until(page, "(s) => [...document.querySelector(s).options].some(o => o.textContent === 'Many')", axis_sets.sel(C, "color", "column"))
    items = [t for _, t, g, _ in _items(page) if g == "Cell groupings"]
    assert items == ["Many"], items


def test_switching_the_grouping_keeps_the_group_of_the_same_name_or_takes_the_first_with_one_request(page, served):
    # Grouping 2 is the cell types without Platelet: another key, so another request, and no group called Platelet
    other = {"id": "cell-grouping-B", "title": "Grouping 2", "version": 1, "partitionings": [{**CELL_TYPE, "levels": ["c:B cell", "c:T cell", "c:NK cell"], "rest": "exclude"}]}
    t_cell = json.dumps(["c:T cell"], separators=(",", ":"))
    platelet = json.dumps(["c:Platelet"], separators=(",", ":"))
    _open(page, served, {G: _plot(color=_stat(column=t_cell, groupWas=["T cell"])), GA: _grouping(), "cell-grouping-B": other})
    page.wait_for_selector(_member(), timeout=30000)
    until(page, "([s, v]) => [...document.querySelector(s).options].some(o => o.value === v)", [axis_sets.sel(C, "color", "column"), _entry("cell-grouping-B")])
    # the groups of Grouping 2 are known (it is asked for when listed): a grouping picked before they are shows no group yet
    until(page, """async () => { const R = await import('/static/js/utils/source-registry.js');
        const m = R.getSource('group-stat').aggregate.members({ type: 'group-stat', key: 'cell-grouping-B', column: '' });
        return !!m && m.options.length > 1; }""")
    _wait_colours(page, 40)              # the first draw has asked and landed: its request is not counted as the switch's
    n = len(_genes(page))
    assert n == 1, "the plot's own first request"
    with page.expect_request(_computes_genes) as asked:
        page.select_option(axis_sets.sel(C, "color", "column"), _entry("cell-grouping-B"))
    assert json.loads(asked.value.post_data)["group"] == ["c:T cell"], "T cell is a group of both: it is kept"
    assert page.input_value(_member()) == t_cell and _config(page)["key"] == "cell-grouping-B"
    waits.expect_stays(lambda: len(_genes(page)) == n + 1, "one request for the switch, and the plot redraws once", page=page, seconds=1.0)
    # a group the other grouping lacks: the first group of it
    page.select_option(axis_sets.sel(C, "color", "column"), _entry())
    page.select_option(_member(), platelet)
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().color.column === '[\"c:Platelet\"]'", G)
    with page.expect_request(_computes_genes) as asked:
        page.select_option(axis_sets.sel(C, "color", "column"), _entry("cell-grouping-B"))
    assert json.loads(asked.value.post_data)["group"] == ["c:B cell"], "Platelet is not in Grouping 2: its first group"
    assert page.input_value(_member()) == B_KEY


def test_the_columns_of_a_grouping_row_a_plain_row_and_a_row_with_a_lock_keep_their_edges(page, served):
    _open(page, served, {G: _plot(x=_stat(), y={"type": "layer", "key": "logged", "column": "CELL0003"}, color=_stat(stat="sd")), GA: _grouping()})
    page.wait_for_selector(axis_sets.button(C, "x"), timeout=30000)
    edges = page.evaluate("""(t) => Object.fromEntries(['x', 'y', 'color'].map((a) => {
        const row = document.querySelector(t + ` select.axis-type-select[data-axis="${a}"]`).closest('.axis-selector');
        const left = (s) => { const e = row.querySelector(s); return e ? Math.round(e.getBoundingClientRect().left) : null; };
        const right = (s) => { const e = row.querySelector(s); return e ? Math.round(e.getBoundingClientRect().right) : null; };
        const last = [...row.children].filter((e) => e.offsetParent !== null).pop();
        return [a, { type: left('.axis-type-select'), key: left('.axis-key-select'), item: left('.axis-column-select'), member: left('.axis-member-select'),
                     itemRight: right('.axis-column-select'), memberRight: right('.axis-member-select'), rowRight: Math.round(row.getBoundingClientRect().right),
                     button: Math.round(last.getBoundingClientRect().left) }];
    }))""", C)
    assert len({e["type"] for e in edges.values()}) == 1 and len({e["key"] for e in edges.values()}) == 1 and len({e["item"] for e in edges.values()}) == 1, edges
    assert edges["x"]["member"] and edges["color"]["member"] and edges["y"]["member"] is None, "only a grouping's row has the group select"
    # the item column and the group select share the width the item column has on a plain row
    assert abs(edges["x"]["memberRight"] - edges["y"]["itemRight"]) <= 2, edges
    assert edges["x"]["memberRight"] - edges["x"]["item"] == edges["y"]["itemRight"] - edges["y"]["item"] or abs((edges["x"]["memberRight"] - edges["x"]["item"]) - (edges["y"]["itemRight"] - edges["y"]["item"])) <= 2, edges
    # the aggregation button of a grouping's row and the lock of a plain row are in the same place
    assert abs(edges["x"]["button"] - edges["y"]["button"]) <= 2 and abs(edges["color"]["button"] - edges["x"]["button"]) <= 2, edges


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
def test_screenshots_of_a_grouping_row_above_a_plain_row(page, served):
    """X on grouping > group (type, layer, grouping, group, x with a bar) above a plain Y row."""
    _open(page, served, {G: _plot(x=_stat(), y={"type": "layer", "key": "logged", "column": "CELL0003"}), GA: _grouping()}, open_ids=(G,))
    page.wait_for_selector(axis_sets.button(C, "x"), timeout=30000)
    os.makedirs(SHOTS, exist_ok=True)
    for theme in ("light", "dark"):
        page.evaluate("(t) => { document.documentElement.setAttribute('data-theme', t); document.documentElement.setAttribute('data-bs-theme', t); }", theme)
        box = page.locator(f"{C} .plot-controls").bounding_box()
        page.screenshot(path=os.path.join(SHOTS, f"agg-d-gene-grouping-group-above-plain-{theme}.png"), clip={**box, "height": 150})


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


# ------------------------------------------------------------------ a grouping picked before its groups are known

def test_a_grouping_picked_before_its_reply_lands_takes_its_first_group_with_one_request_and_no_undo_step(page, served):
    """The grouping's reply is held. The pick leaves the group unset; when the reply lands the row takes the first group (the
    rule of a grouping switch), asks once, and the change is the pick's one undo step, not a second."""
    held = []

    def hold(route):
        request = route.request
        body = json.loads(request.post_data or "{}")
        if request.method == "POST" and body.get("shape") != "genes" and not body.get("estimate_only"):
            held.append(route)
            return
        route.continue_()
    page.route("**/api/v1/data/cell_groups**", hold)
    _open(page, served, {G: _plot(), GA: _grouping()})
    page.select_option(axis_sets.sel(C, "color", "type"), "layer")
    until(page, "([s]) => document.querySelector(s).options.length > 1", [axis_sets.sel(C, "color", "key")])
    page.select_option(axis_sets.sel(C, "color", "key"), "logged")
    until(page, "([s, v]) => [...document.querySelector(s).options].some(o => o.value === v)", [axis_sets.sel(C, "color", "column"), _entry()])
    page.select_option(axis_sets.sel(C, "color", "column"), _entry())
    page.click(f"{C} .plot-controls", position={"x": 3, "y": 3})            # a click of the user's own: the pick is seen as its step
    page.wait_for_selector(f"#plot-undo-{G}:not([disabled])")
    assert held, "the grouping's reply is held"
    assert not _genes(page) and not _config(page).get("column"), "nothing is asked and no group is set while its groups are unknown"
    with page.expect_request(_computes_genes):
        for route in held:
            route.continue_()
        page.unroute("**/api/v1/data/cell_groups**", hold)
    until(page, "(g) => window.PanelManager.getPanel(g).getConfig().color.column", G, timeout=30)
    _wait_colours(page, 40)
    assert len(_genes(page)) == 1, "one request"
    assert page.input_value(_member()) == _config(page)["column"], "the group select shows the group it took"
    before = page.evaluate("(g) => window.PanelManager.getPanel(g).getConfig().color.type", G)
    page.click(f"#plot-undo-{G}")
    until(page, "(g) => window.PanelManager.getPanel(g).getConfig().color.type !== 'group-stat'", G)
    assert _config(page).get("type") != "group-stat", f"one Undo returns to the colour before ({before})"
