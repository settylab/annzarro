"""A Cell Grouping in a Cell Plot (G8a), in a real browser against the real cell_groups route.

The store is the grouping fixture (tests/core/grouping_store.py): 1,200 cells, cell_type with 6 levels, condition with 2,
an obs column `many` with one level per cell (1,200 groups), X_umap.

1.  Colour (CAT-1, CAT-2, CAT-8): the type menus of colour, x, y, z and hover list `cell-group` after `gene-score`; the
    key list lists every grouping, open or closed, then New grouping…; there is no third select; the legend is titled
    by the grouping and lists its groups in group order with the grouping's colours; cells in no group are drawn as
    the missing entry, "Not in any group".
2.  An axis is a category axis titled by the grouping; the hover picker lists groupings in their own group and the
    hover line reads "Grouping 1: B cell | ctrl" (CAT-5).
3.  Past 64 groups the colour-group rule of the grouping applies, and the codes are 2 bytes (CAT-4).
4.  Every dependant state (SHR-35): asks first, held behind Update grouping, a live edit followed, refused for its
    size, building and asking for a table upstream, deleted, a loop from a link, an empty grouping.
5.  New grouping… and Open grouping (GRP-17); the Groupings group under obs (UX 5).
6.  The codes on the memory guard's ledger: a hidden plot's codes are evicted with its drawing, and asked for again
    when it is shown (CAT-4).
7.  A link round trip.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
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

from annzarro.tests.browser import waits  # noqa: E402
from annzarro.tests.browser.test_cell_grouping_panel import served, _rewrite_estimate, N  # noqa: E402,F401
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402
from annzarro.tests.core import grouping_store as gstore  # noqa: E402

GA, GB, GC = "cell-grouping-A", "cell-grouping-B", "cell-grouping-C"
P, TA = "cell-plot-P", "cell-table-T"
C = f'.tile[data-tile-id="{P}"]'
CELL_TYPE = {"source": {"type": "obs", "key": "cell_type"}}
CONDITION = {"source": {"type": "obs", "key": "condition"}}
TYPES = [name for name, _ in gstore.CELL_TYPES]
UMAP_X = {"type": "obsm", "key": "X_umap", "column": "0"}
UMAP_Y = {"type": "obsm", "key": "X_umap", "column": "1"}
NONE = {"type": "none", "key": "", "column": ""}
ROUTE = "**/api/v1/data/cell_groups*"


def by(pid):
    return {"type": "cell-group", "key": pid, "column": ""}


@pytest.fixture
def page(served):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1500, "height": 1000})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.calls = []
            page.on("request", lambda r: page.calls.append(json.loads(r.post_data or "{}"))
                    if "/data/cell_groups" in r.url and r.method == "POST" else None)
            yield page
            assert not errors, errors
        finally:
            browser.close()


# ------------------------------------------------------------------ helpers

def _grouping(pid=GA, title="Grouping 1", partitionings=(CELL_TYPE,), **extra):
    return {"id": pid, "title": title, "version": 1, "partitionings": list(partitionings), **extra}


def _plot(**extra):
    cfg = {"id": P, "title": "Cell Plot 1", "x": UMAP_X, "y": UMAP_Y, "z": None, "color": NONE, "pointSize": 6,
           "pointOpacity": 1, "categoryPalette": "uns"}
    cfg.update(extra)
    return cfg


def _url(served, open_ids, configs):
    root, store = served
    tiles = [{"type": "tile", "id": i, "controlsVisible": True} for i in open_ids]

    def tree(nodes):
        if len(nodes) == 1:
            return nodes[0]
        return {"type": "split", "direction": "horizontal", "panes": [{"percentage": 100 // len(nodes)}, {"percentage": 100 - 100 // len(nodes)}],
                "children": [nodes[0], tree(nodes[1:])]}
    view = {"v": 1, "layout": {"v": 1, "hierarchy": [tree(tiles)] if tiles else [],
                               "controlState": {i: True for i in open_ids}, "panelConfigs": configs}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={enc}"


def _open(page, served, configs, open_ids=(P,), wait=True):
    page.goto(_url(served, list(open_ids), configs))
    if wait:
        page.wait_for_selector(f"{C} .js-plotly-plot", timeout=30000)


def _menus(page, axis="color"):
    until(page, """([t, a]) => { const s = document.querySelector(`${t} select.axis-type-select[data-axis="${a}"]`);
        return !!s && [...s.options].some(o => o.value === 'cell-group'); }""", [C, axis])


def _options(page, kind, axis):
    return page.evaluate("""([t, kind, axis]) => [...document.querySelectorAll(`${t} select.axis-${kind}-select[data-axis="${axis}"] option`)]
        .map(o => [o.value, o.textContent])""", [C, kind, axis])


def _traces(page):
    """Each legend entry: [name, colour, points]. The points are its legend group's (a legend entry may be a proxy of
    the traces that hold them, plot-make-helper.js withLegendProxies)."""
    return page.evaluate("""(t) => { const gd = document.querySelector(t + ' .js-plotly-plot');
        if (!gd || !gd.data) return [];
        const points = (d) => gd.data.filter(e => e !== d && e.showlegend === false && e.legendgroup === d.legendgroup)
            .reduce((n, e) => n + (e.x || []).length, 0) || (d.x || []).filter(v => v !== null).length;
        return gd.data.filter(d => d.showlegend !== false).map(d => [d.name || '', typeof (d.marker && d.marker.color) === 'string' ? d.marker.color : null,
            points(d)]); }""", C)


def _legend(page):
    return page.evaluate("""(t) => { const gd = document.querySelector(t + ' .js-plotly-plot');
        const text = gd && gd.layout && gd.layout.legend && gd.layout.legend.title ? String(gd.layout.legend.title.text || '') : '';
        return text.replace(/<[^>]+>/g, ' ').replace(/\\u00a0/g, ' ').trim(); }""", C)


def _wait_legend(page, names):
    until(page, """([t, names]) => { const gd = document.querySelector(t + ' .js-plotly-plot');
        return !!(gd && gd.data && names.every(n => gd.data.some(d => d.name === n)) && !document.querySelector(t + ' .loading-overlay')
            && !document.querySelector(t + ' .score-notice')); }""", [C, names])


def _notice(page):
    return page.evaluate("""(t) => { const el = document.querySelector(t + ' .score-notice');
        if (!el) return null;
        return { state: el.dataset.state, text: el.textContent.replace(/\\s+/g, ' ').trim(),
                 actions: [...el.querySelectorAll('[data-ps-action]')].map(b => b.dataset.psAction + '|' + b.textContent.trim()) }; }""", C)


def _wait_notice(page, state):
    until(page, "([t, s]) => { const n = document.querySelector(t + ' .score-notice'); return !!n && n.dataset.state === s; }", [C, state])
    return _notice(page)


def _placeholder(page):
    return page.evaluate("""(t) => { const el = document.querySelector(t + ' .coverage-placeholder');
        if (!el) return null;
        return { state: el.dataset.scoreState || null, text: el.textContent.replace(/\\s+/g, ' ').trim(),
                 actions: [...el.querySelectorAll('[data-ps-action]')].map(b => b.dataset.psAction + '|' + b.textContent.trim()) }; }""", C)


def _tag(page):
    return page.evaluate("""(t) => { const el = document.querySelector(t + ' .plot-status .ps-tag[data-tag="score"]');
        return el ? el.textContent.trim() : null; }""", C)


def _computes(page):
    return [c for c in page.calls if not c.get("estimate_only")]


def _colour_cfg(page):
    return page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig().color", P)


def _palette(page, n):
    return page.evaluate("""async (n) => (await import('/static/js/panels/plot-utilities/colors.js')).generateDiscreteColors(n)""", n)


# ------------------------------------------------------------------ 1. colour

def test_colour_by_a_grouping_from_the_menus_in_group_order_with_its_colours(page, served):
    configs = {P: _plot(), GA: _grouping(), GB: _grouping(GB, "Grouping 2", [CONDITION])}
    _open(page, served, configs, open_ids=(P, GA))
    _menus(page)
    for axis in ("color", "x", "y", "z"):
        _menus(page, axis)
        types = [v for v, _ in _options(page, "type", axis)]
        assert "cell-group" in types and types.index("cell-group") > types.index("gene-score"), (axis, types)
    page.select_option(f'{C} select.axis-type-select[data-axis="color"]', "cell-group")
    until(page, """(t) => [...document.querySelectorAll(`${t} select.axis-key-select[data-axis="color"] option`)].some(o => o.value === 'cell-grouping-B')""", C)
    keys = _options(page, "key", "color")
    assert sorted(keys[:-1]) == [[GA, "Grouping 1"], [GB, "Grouping 2"]] and keys[-1] == ["__new_grouping__", "New grouping…"], \
        "every grouping, open or closed, then New grouping…"
    assert page.is_hidden(f'{C} select.axis-column-select[data-axis="color"]') or \
        page.is_disabled(f'{C} select.axis-column-select[data-axis="color"]'), "no third select (CAT-1)"
    page.select_option(f'{C} select.axis-key-select[data-axis="color"]', GA)
    _wait_legend(page, TYPES)
    assert _legend(page) == "Grouping 1", "the legend is titled by the grouping (CAT-8)"
    traces = _traces(page)
    assert [t[0] for t in traces] == TYPES, "one entry per group, in group order"
    assert [t[1] for t in traces] == _palette(page, 6), "the grouping's colours: the app's palette in group order (SHR-11)"
    assert [t[2] for t in traces] == [n for _, n in gstore.CELL_TYPES]
    assert _colour_cfg(page)["key"] == GA and _colour_cfg(page)["label"] == "Grouping 1"
    request = _computes(page)[-1]
    assert request["want"]["codes"] is True


def test_cells_in_no_group_are_drawn_as_missing_not_in_any_group(page, served):
    two = {**CELL_TYPE, "levels": ["c:B cell", "c:T cell"], "rest": "exclude"}
    _open(page, served, {P: _plot(color=by(GA)), GA: _grouping(partitionings=[two])})
    _wait_legend(page, ["B cell", "T cell"])
    traces = {t[0]: t for t in _traces(page)}
    assert set(traces) == {"B cell", "T cell", "Not in any group"}
    assert traces["Not in any group"][2] == N - 800, "the cells of the levels left out"
    assert traces["Not in any group"][1] == "rgba(200, 200, 200, 1.)", "the grey of a missing category (SHR-5)"


def test_a_grouping_as_an_axis_is_a_category_axis_titled_by_it(page, served):
    _open(page, served, {P: _plot(x=by(GA)), GA: _grouping()})
    until(page, """(t) => { const gd = document.querySelector(t + ' .js-plotly-plot');
        return !!(gd && gd.layout && gd.layout.xaxis && gd.layout.xaxis.title && gd.layout.xaxis.title.text === 'Grouping 1'
            && gd.data.some(d => (d.x || []).length > 1)); }""", C)
    assert page.evaluate("(t) => document.querySelector(t + ' .js-plotly-plot').layout.xaxis.type", C) == "category"
    xs = page.evaluate("(t) => [...new Set(document.querySelector(t + ' .js-plotly-plot').data.flatMap(d => Array.from(d.x || [])))].sort()", C)
    assert xs == sorted(TYPES)


def test_hover_lists_groupings_in_their_own_group_and_the_line_names_the_group(page, served):
    cfg = _plot(hoverInfo=[{"type": "obs", "key": "_index"}, by(GA)])
    _open(page, served, {P: cfg, GA: _grouping(partitionings=[CELL_TYPE, CONDITION]), GB: _grouping(GB, "Grouping 2", [CONDITION])})
    options = page.evaluate("""(t) => [...document.querySelectorAll(t + ' select.hover-columns-select optgroup[label="Groupings"] option')]
        .map(o => [o.value, o.textContent, o.selected])""", C)
    assert options == [[f"cell-group:{GA}", "Grouping 1", True], [f"cell-group:{GB}", "Grouping 2", False]]
    until(page, "(t) => { const g = document.querySelector(t + ' .js-plotly-plot'); return !!(g && g.data && g.data.some(d => (d.hovertext || []).some(h => String(h).includes('Grouping 1:')))); }", C)
    lines = page.evaluate("""(t) => document.querySelector(t + ' .js-plotly-plot').data.flatMap(d => Array.from(d.hovertext || []))
        .map(h => String(h).split('<br>').find(l => l.startsWith('Grouping 1:'))).filter(Boolean)""", C)
    assert len(lines) == N, "one line per cell"
    assert set(lines) <= {f"Grouping 1: {t} | {c}" for t in TYPES for c in gstore.CONDITIONS}
    assert "Grouping 1: B cell | ctrl" in lines, "the group's name, its labels joined by the separator (CAT-5)"
    # picking another in the picker writes the setting
    page.select_option(f"{C} select.hover-columns-select", [f"cell-group:{GB}"])
    until(page, "(id) => (window.PanelManager.getPanel(id).getConfig().hoverInfo || []).some(h => h.type === 'cell-group' && h.key === 'cell-grouping-B')", P)


# ------------------------------------------------------------------ 3. past 64 groups

def test_past_64_groups_the_colour_groups_of_the_grouping_and_two_byte_codes(page, served):
    many = {"source": {"type": "obs", "key": "many"}}
    _open(page, served, {P: _plot(color=by(GA)), GA: _grouping(partitionings=[many])})
    until(page, """(t) => { const gd = document.querySelector(t + ' .js-plotly-plot');
        return !!(gd && gd.data && gd.data.filter(d => d.showlegend !== false).length >= 64 && !document.querySelector(t + ' .loading-overlay')); }""", C)
    traces = _traces(page)
    assert len(traces) == 64, "one legend entry per colour group"
    palette = page.evaluate("async () => (await import('/static/js/panels/plot-utilities/colors.js')).groupColours(64)")
    assert [t[1] for t in traces] == palette, "colour group g is the grouping's colour of the groups g, g + 64, ... (SHR-11)"
    assert sum(t[2] for t in traces) == N
    assert all("more" in t[0] for t in traces[:2]), traces[:2]
    held = page.evaluate("""async () => { const { ledger } = await import('/static/js/utils/memory-guard-ui.js'); return ledger.heldBytes(); }""")
    assert held >= 2 * N, "1,200 groups: 2 bytes per cell, on the memory guard's ledger (CAT-4)"


# ------------------------------------------------------------------ 4. dependant states

def test_a_grouping_that_asks_first_says_so_and_compute_colours_the_plot(page, served):
    _rewrite_estimate(page, 120, tier="confirm")
    _open(page, served, {P: _plot(color=by(GA)), GA: _grouping()})
    note = _wait_notice(page, "awaiting")
    assert note["text"].startswith("'Grouping 1' will take about 2 minutes. This plot has no color.")
    assert note["actions"] == ["score-compute|Compute", "score-choose|Choose another"]
    assert _tag(page) == "Grouping not computed"
    assert not _computes(page), "nothing computed before Compute"
    page.click(f"{C} [data-ps-action='score-compute']")
    _wait_legend(page, TYPES)


def test_an_edit_is_followed_at_once_or_held_behind_update_grouping(page, served):
    _open(page, served, {P: _plot(color=by(GA)), GA: _grouping()}, open_ids=(P, GA))
    _wait_legend(page, TYPES)
    # a cheap edit: the plot follows by itself
    page.evaluate("(id) => window.PanelManager.getPanel(id).addFactor({source: {type: 'obs', key: 'condition'}})", GA)
    _wait_legend(page, ["B cell | ctrl", "B cell | treated"])
    assert len(_traces(page)) == 12
    # a slow one waits for Update grouping, and the plot keeps the groups it shows
    _rewrite_estimate(page, 40)
    page.evaluate("(id) => window.PanelManager.getPanel(id).addFactor({source: {type: 'obs', key: 'is_doublet'}})", GA)
    note = _wait_notice(page, "held")
    assert note["text"].startswith("Showing the previous 'Grouping 1'. 1 change is not applied. About 40 seconds.")
    assert note["actions"] == ["score-update|Update grouping"]
    assert len(_traces(page)) == 12, "the previous groups stay drawn (SHR-36)"
    page.click(f"{C} [data-ps-action='score-update']")
    _wait_legend(page, ["B cell | ctrl | is_doublet", "B cell | ctrl | not is_doublet"])


def test_a_grouping_refused_for_its_size_says_why_with_open_grouping(page, served):
    def handler(route):
        body = json.loads(route.request.post_data or "{}")
        if body.get("estimate_only"):
            return route.continue_()
        frame = {"type": "result", "version": 1, "shape": "grouping", "n_shown": N,
                 "refused": {"reason": "too_many_groups", "count": 6840, "limit": 2000, "levels": [6, 1140]}, "blocks": []}
        route.fulfill(status=200, body=json.dumps({"type": "start", "entries_done": 0, "entries_total": 0}) + "\n" + json.dumps(frame) + "\n",
                      headers={"Content-Type": "application/x-ndjson"})
    page.route(ROUTE, handler)
    _open(page, served, {P: _plot(x=by(GA)), GA: _grouping()}, wait=False)
    until(page, "(t) => { const e = document.querySelector(t + ' .coverage-placeholder'); return !!e && e.dataset.scoreState === 'refused'; }", C)
    box = _placeholder(page)
    assert "'Grouping 1' has 6,840 groups: a grouping holds up to 2,000, so it was not computed." in box["text"]
    assert box["actions"] == ["score-open|Open grouping", "score-choose|Choose another"]
    assert page.evaluate("(id) => document.getElementById('plot-container-' + id).dataset.sourceState", P) == "refused"


def test_a_table_upstream_that_is_building_or_asks_first_says_so(page, served):
    table = {"id": TA, "title": "Table 1", "columns": [{"type": "obs", "key": "cell_type", "column": ""}]}
    configs = {P: _plot(color=by(GA)), GA: _grouping(partitionings=[{"source": {"type": "table", "key": TA}}]), TA: table}
    # the table's resolver says what a large table would: building, then ask first
    page.add_init_script("""
        window.__gate = { state: 'building' };
        import('/static/js/utils/table-resolver.js').then(({ TableResolver }) => {
            const need = TableResolver.need.bind(TableResolver);
            const accept = TableResolver.accept.bind(TableResolver);
            TableResolver.need = (id, dep) => (id === 'cell-table-T' && window.__gate ? { ...window.__gate } : need(id, dep));
            TableResolver.gate = (id) => (id === 'cell-table-T' && window.__gate ? { ...window.__gate } : null);
            TableResolver.accept = (id) => { if (id === 'cell-table-T') { window.__accepted = true; window.__gate = null;
                document.dispatchEvent(new CustomEvent('annzarro:table-filtered', { detail: { id } })); return true; } return accept(id); };
        });""")
    _open(page, served, configs)
    note = _wait_notice(page, "building")
    assert note["text"].startswith("Building 'Table 1' to find its cells, then grouping them. This plot has no color.")
    page.evaluate("() => { window.__gate = { state: 'ask', rows: 2000000 }; document.dispatchEvent(new CustomEvent('annzarro:table-filtered', { detail: { id: 'cell-table-T' } })); }")
    note = _wait_notice(page, "ask")
    assert note["text"].startswith("Building 'Table 1' to find its cells will pause the page for a few seconds.")
    assert note["actions"][0] == "score-compute|Build filter"
    assert not _computes(page), "nothing asked of the route while the table is not known"
    page.click(f"{C} [data-ps-action='score-compute']")
    until(page, "() => window.__accepted === true")


def test_a_deleted_grouping_says_so_and_the_plot_keeps_its_setting(page, served):
    _open(page, served, {P: _plot(color=by(GA)), GA: _grouping()}, open_ids=(P, GA))
    _wait_legend(page, TYPES)
    page.evaluate("(id) => window.PanelManager.removePanel(id)", GA)
    note = _wait_notice(page, "deleted")
    assert note["text"].startswith("Grouping 'Grouping 1' was deleted.")
    assert note["actions"] == ["score-choose|Choose another"]
    assert _tag(page) == "Grouping deleted"
    assert _colour_cfg(page)["key"] == GA, "nothing is silently reset (SHR-38)"
    until(page, """(t) => [...document.querySelectorAll(`${t} select.axis-key-select[data-axis="color"] option`)].some(o => o.textContent === 'Grouping 1 (deleted)')""", C)
    assert _options(page, "key", "color") == [[GA, "Grouping 1 (deleted)"], ["__new_grouping__", "New grouping…"]]


def test_a_loop_from_a_link_computes_nothing_and_names_the_panels(page, served):
    ring = {P: _plot(color=by(GA)),
            GA: _grouping(partitionings=[{"source": {"type": "cell-group", "key": GB}}]),
            GB: _grouping(GB, "Grouping 2", partitionings=[{"source": {"type": "cell-group", "key": GA}}])}
    _open(page, served, ring)
    note = _wait_notice(page, "cycle")
    assert note["text"].startswith("'Grouping 1' and 'Grouping 2' depend on each other. This plot has no color.")
    assert note["actions"] == ["score-open|Open grouping", "score-choose|Choose another"]
    assert _tag(page) == "Circular groupings"
    waits.expect_stays(lambda: not _computes(page), "a loop must never reach the route; there is no event for nothing sent", page=page)


def test_an_empty_grouping_asks_nothing_and_adding_a_factor_colours_the_plot(page, served):
    _open(page, served, {P: _plot(color=by(GA)), GA: _grouping(partitionings=[])}, open_ids=(P, GA))
    note = _wait_notice(page, "nofactors")
    assert note["text"].startswith("'Grouping 1' has no factors yet. This plot has no color.")
    assert note["actions"] == ["score-open|Open grouping", "score-choose|Choose another"]
    assert not _computes(page)
    page.evaluate("(id) => window.PanelManager.getPanel(id).addFactor({source: {type: 'obs', key: 'cell_type'}})", GA)
    _wait_legend(page, TYPES)


# ------------------------------------------------------------------ 5. New grouping…, Open grouping, under obs

def test_new_grouping_opens_one_beside_the_plot_and_the_plot_takes_it(page, served):
    _open(page, served, {P: _plot(color=by(GA)), GA: _grouping()})
    _wait_legend(page, TYPES)
    page.select_option(f'{C} select.axis-key-select[data-axis="color"]', "__new_grouping__")
    until(page, "() => document.querySelectorAll('.tile[data-tile-id^=\"cell-grouping-\"]').length === 1")
    made = page.evaluate("() => document.querySelector('.tile[data-tile-id^=\"cell-grouping-\"]').dataset.tileId")
    assert made != GA
    until(page, "([id, g]) => window.PanelManager.getPanel(id).getConfig().color.key === g", [P, made])
    assert _wait_notice(page, "nofactors")["text"].startswith("'Grouping 2' has no factors yet.")
    page.evaluate("(id) => window.PanelManager.getPanel(id).addFactor({source: {type: 'obs', key: 'condition'}})", made)
    _wait_legend(page, gstore.CONDITIONS)


def test_open_grouping_reopens_a_closed_grouping_beside_the_plot(page, served):
    _open(page, served, {P: _plot(color=by(GB)), GB: _grouping(GB, "Grouping 2", partitionings=[])})
    _wait_notice(page, "nofactors")
    assert not page.query_selector(f'.tile[data-tile-id="{GB}"]')
    page.click(f"{C} [data-ps-action='score-open']")
    page.wait_for_selector(f'.tile[data-tile-id="{GB}"] .cgrp-panel', timeout=30000)
    assert page.query_selector(C), "the plot stays open beside it"


def test_groupings_are_listed_under_obs_and_choosing_one_switches_the_type(page, served):
    _open(page, served, {P: _plot(color={"type": "obs", "key": "condition", "column": ""}), GA: _grouping()})
    _menus(page)
    until(page, """(t) => !!document.querySelector(`${t} select.axis-key-select[data-axis="color"] optgroup[label="Groupings"] option`)""", C)
    listed = page.evaluate("""(t) => [...document.querySelectorAll(`${t} select.axis-key-select[data-axis="color"] optgroup[label="Groupings"] option`)]
        .map(o => [o.value, o.textContent])""", C)
    assert [text for _, text in listed] == ["Grouping 1"]
    page.select_option(f'{C} select.axis-key-select[data-axis="color"]', listed[0][0])
    until(page, "(t) => document.querySelector(`${t} select.axis-type-select[data-axis=\"color\"]`).value === 'cell-group'", C)
    _wait_legend(page, TYPES)
    cfg = _colour_cfg(page)
    assert cfg["type"] == "cell-group" and cfg["key"] == GA, "the setting stores cell-group, never obs"


# ------------------------------------------------------------------ 6. the codes under the memory guard

def test_a_hidden_plots_codes_are_evicted_with_its_drawing_and_asked_for_again_when_shown(page, served):
    _open(page, served, {P: _plot(color=by(GA)), GA: _grouping()})
    _wait_legend(page, TYPES)
    held = "async () => { const { ledger } = await import('/static/js/utils/memory-guard-ui.js'); return [ledger.heldBytes(), ledger.evictable()]; }"
    before = page.evaluate(held)
    assert before[0] >= N, "the plot's codes are held"
    assert not before[1], "pinned while the plot is on screen"
    # hidden: the codes are evictable, and the guard may take them
    page.evaluate("(t) => { document.querySelector(t).style.display = 'none'; }", C)
    until(page, "async () => { const { ledger } = await import('/static/js/utils/memory-guard-ui.js'); return ledger.evictable() >= 1200; }")
    page.evaluate("async () => { const { ledger } = await import('/static/js/utils/memory-guard-ui.js'); ledger.evict(); }")
    assert page.evaluate(held)[0] == 0, "nothing still counts the codes the guard took"
    asked = len(_computes(page))
    waits.expect_stays(lambda: len(_computes(page)) == asked, "a hidden plot asks for nothing; there is no event for a request not sent",
                       page=page)
    # shown again: asked for again, and drawn
    page.evaluate("(t) => { document.querySelector(t).style.display = ''; }", C)
    _wait_legend(page, TYPES)
    assert len(_computes(page)) == asked + 1


# ------------------------------------------------------------------ 7. a link round trip

def test_a_link_round_trip_keeps_the_grouping_on_colour_and_axis(page, served):
    _open(page, served, {P: _plot(color=by(GA), hoverInfo=[by(GA)]), GA: _grouping()}, open_ids=(P, GA))
    _wait_legend(page, TYPES)
    root, store = served
    payload = page.evaluate("""async () => { const { encodeViewPayload } = await import('/static/js/utils/deeplink.js');
        return await encodeViewPayload(window.sessionManager.captureView()); }""")
    view = page.evaluate("() => window.sessionManager.captureView()")
    cfg = view["layout"]["panelConfigs"][P]
    assert cfg["color"]["type"] == "cell-group" and cfg["color"]["key"] == GA
    want = _traces(page)
    page.goto("about:blank")
    page.goto(f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={payload}")
    page.wait_for_selector(f"{C} .js-plotly-plot", timeout=30000)
    _wait_legend(page, TYPES)
    assert _traces(page) == want
    assert _legend(page) == "Grouping 1"


# ------------------------------------------------------------------ 8. light and dark

def _shot(page, name):
    """Screenshots for looking: only when ANNZARRO_THEME_SHOTS names a directory (as test_dark_theme.py)."""
    out = os.environ.get("ANNZARRO_THEME_SHOTS")
    if out:
        os.makedirs(out, exist_ok=True)
        page.locator(C).screenshot(path=os.path.join(out, name + ".png"))


def test_the_legend_of_a_grouping_follows_the_theme(page, served):
    _open(page, served, {P: _plot(color=by(GA), title="Cell Plot 1"), GA: _grouping(title="Cell type × condition", partitionings=[CELL_TYPE, CONDITION])})
    names = [f"{t} | {c}" for t in TYPES for c in gstore.CONDITIONS]
    _wait_legend(page, names)
    font = "(t) => document.querySelector(t + ' .js-plotly-plot').layout.legend.title.font.color"
    page.click('#theme-toggle button[data-theme-mode="light"]')
    page.wait_for_function("() => document.documentElement.getAttribute('data-theme') === 'light'", timeout=5000)
    light = page.evaluate(font, C)
    _shot(page, "g8a-grouping-colour-light")
    page.click('#theme-toggle button[data-theme-mode="dark"]')
    page.wait_for_function("() => document.documentElement.getAttribute('data-theme') === 'dark'", timeout=5000)
    until(page, "([t, was]) => document.querySelector(t + ' .js-plotly-plot').layout.legend.title.font.color !== was", [C, light])
    _wait_legend(page, names)
    assert [t[0] for t in _traces(page)][:2] == names[:2], "the groups keep their order and colours in either theme"
    assert _legend(page) == "Cell type × condition"
    _shot(page, "g8a-grouping-colour-dark")
