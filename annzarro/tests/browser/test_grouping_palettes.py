"""Grouping and factor palettes in a real browser (operator decision 33).

The store is the grouping fixture (tests/core/grouping_store.py) with `uns.cell_type_colors` stored with 8 colours, two more
than the 6 cell types (scanpy takes them: at least as many as categories); `condition` stores none.

1.  One resolver: the group grid's swatch of each group is the colour the Cell Plot draws it in, for a grouping of two
    factors (it was not: the grid and the plot each chose their own palette) and for one.
2.  The dataset's colours are the default of a categorical factor; an old link with no `colors` loads and draws.
3.  A factor's palette, set in its Edit pop-over, reaches the Cell-Gene strips and their legend, the Count Plot's bars and
    densities and the Cell Plot, as one undo step and with no request to the server.
4.  Settings: "Color groups by", the grouping's palette, a group's own color from its swatch, and the reset.
5.  A link keeps the palettes and the overrides.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import json
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import test_focus_outside_subset as _focus  # noqa: E402
from annzarro.tests.browser.test_cell_gene_panel import GENES, P as GP, S1, TP as GT, _plot as _gene_plot, _sig  # noqa: E402
from annzarro.tests.browser.test_cell_group_plots import C, by, _plot, _traces, _wait_legend  # noqa: E402
from annzarro.tests.browser.test_cell_grouping_panel import A, CELL_TYPE, CONDITION, GA, N, _grouping, _url  # noqa: E402
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402
from annzarro.tests.browser.test_names_dataset_scope import _serve  # noqa: E402
from annzarro.tests.core import grouping_store as gstore  # noqa: E402
from annzarro.tests.zarr_compat import open_group, write_strings, consolidate  # noqa: E402

P = "cell-plot-P"
CC, CD = "cell-count-A", "cell-count-D"
SC, SD = f'.tile[data-tile-id="{CC}"]', f'.tile[data-tile-id="{CD}"]'
TYPES = [name for name, _ in gstore.CELL_TYPES]
UNS = ["#112233", "#223344", "#334455", "#445566", "#556677", "#667788", "#778899", "#8899aa"]
SET1 = ["#e41a1c", "#377eb8", "#4daf4a", "#984ea3", "#ff7f00", "#ffff33"]
DATA = gstore.make_data()
EDIT = f"{A} .cgrp-card[data-index='0'] .cgrp-card__edit"
LEVELS = "[data-popover='levels']"
SETTINGS = "[data-popover='settings']"
SETTINGS_BUTTON = f"{A} .cgrp-settings-btn"


def _make_store(path):
    gstore.make_store(str(path), "csc", "zarr", data=DATA)
    uns = open_group(os.path.join(str(path), "uns"), mode="a")
    write_strings(uns, "cell_type_colors", UNS)
    consolidate(str(path))
    return str(path)


@pytest.fixture(scope="module")
def served(tmp_path_factory):
    original = _focus._make_store
    _focus._make_store = _make_store
    try:
        proc, root, store = _serve(tmp_path_factory)
    finally:
        _focus._make_store = original
    yield root, store
    proc.terminate()
    proc.wait(10)


@pytest.fixture
def page(served):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1700, "height": 1300})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.calls = []
            page.on("request", lambda r: page.calls.append(json.loads(r.post_data or "{}"))
                    if "/data/cell_groups" in r.url and r.method == "POST" else None)
            yield page
            # the neighbours' own first-draw error in a narrow tile (test_cell_grouping_popovers.py), nothing else
            others = [e for e in errors if "Something went wrong with axis scaling" not in e]
            assert not others, others
        finally:
            browser.close()


# ------------------------------------------------------------------ helpers

def _open(page, served, configs, open_ids):
    page.goto(_url(served, list(open_ids), configs))
    page.wait_for_selector(f"{A} .cgrp-panel .cgrp-status[data-state='ready']", timeout=60000)


def _rgb(page, colours):
    """Colours as the browser reads them (rgb(...)), whatever text they were written in."""
    return page.evaluate("""(list) => list.map((c) => { if (!c) return null; const e = document.createElement('i'); e.style.color = c;
        document.body.appendChild(e); const v = getComputedStyle(e).color; e.remove(); return v; })""", colours)


def _grid(page):
    """The group grid's rows as {name: swatch colour}."""
    until(page, f"() => document.querySelectorAll('{A} .cgg-row .cgg-swatch').length > 0")
    rows = page.evaluate(f"""() => [...document.querySelectorAll('{A} .cgg-row')].map((r) => [r.querySelector('.cgg-name').textContent,
        r.querySelector('.cgg-swatch').style.backgroundColor])""")
    return dict(rows)


def _plot_colours(page):
    return {name: colour for name, colour, _ in _traces(page)}


def _wait_plot(page, names):
    _wait_legend(page, names)


def _computes(page):
    return [c for c in page.calls if not c.get("estimate_only")]


def _open_levels(page):
    page.click(EDIT)
    page.wait_for_selector(LEVELS, state="visible")


def _config(page, pid=GA):
    return page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig()", pid)


def _undo_size(page, pid=GA):
    return page.evaluate("(id) => window.PanelManager.getPanel(id)._debugState().undo", pid)


def _strip_colours(page):
    """The Cell-Gene plot's strips: [per-group colours of each strip, colours of each strip's legend]."""
    return page.evaluate(f"""() => {{ const gd = document.querySelector('{GT} .cgene-plot');
        const strips = gd.data.filter((t) => t.name === 'group strip').map((t) => Array.from(t.marker.color));
        const legend = gd.data.filter((t) => t.name === 'strip legend').map((t) => Array.from(t.marker.color));
        return {{ strips, legend }}; }}""")


def _count_colours(page, selector):
    """name -> colour of the traces a Count Plot draws, one per level of its split."""
    return page.evaluate("""(s) => { const gd = document.querySelector(s + ' .ccnt-plot'); const out = {};
        for (const t of gd.data || []) { const c = (t.marker && typeof t.marker.color === 'string' && t.marker.color)
            || (t.line && typeof t.line.color === 'string' && t.line.color); if (t.name && c) out[t.name] = c; }
        return out; }""", selector)


def _count_ready(page, selector, mode):
    until(page, """([s, m]) => { const r = document.querySelector(s + ' .ccnt-panel'); return r && r.dataset.drawn === m && r.dataset.state === 'ready'; }""",
          [selector, mode], timeout=60)


TWO = [CELL_TYPE, CONDITION]
GROUP_NAMES = [f"{t} | {c}" for t in TYPES for c in gstore.CONDITIONS]


# ------------------------------------------------------------------ 1. one resolver

def test_the_grid_swatch_of_each_group_is_the_colour_the_cell_plot_draws_it_in_for_two_factors(page, served):
    _open(page, served, {P: _plot(color=by(GA)), GA: _grouping(partitionings=TWO)}, (P, GA))
    _wait_plot(page, GROUP_NAMES)
    grid = _grid(page)
    plot = _plot_colours(page)
    assert set(grid) == set(GROUP_NAMES) == set(plot)
    names = list(grid)
    assert _rgb(page, [grid[n] for n in names]) == _rgb(page, [plot[n] for n in names]), "one colour per group, in every panel"
    assert len(set(_rgb(page, list(grid.values())))) == len(GROUP_NAMES), "twelve groups, twelve colours"


# ------------------------------------------------------------------ 2. the dataset's colours, an old link

def test_the_dataset_colours_are_the_default_and_an_old_link_with_no_colors_loads_and_draws(page, served):
    """`uns.cell_type_colors` has 8 colours for 6 types: used, by the category index (scanpy)."""
    cfg = _grouping(partitionings=[CELL_TYPE])
    assert "colors" not in cfg and "colors" not in cfg["partitionings"][0]
    _open(page, served, {P: _plot(color=by(GA)), GA: cfg}, (P, GA))
    _wait_plot(page, TYPES)
    want = _rgb(page, UNS[:6])
    grid = _grid(page)
    assert _rgb(page, [grid[t] for t in TYPES]) == want
    assert _rgb(page, [_plot_colours(page)[t] for t in TYPES]) == want
    assert "colors" not in json.dumps(_config(page)), "nothing is stored at the defaults"


# ------------------------------------------------------------------ 3. a factor's palette reaches every consumer

def test_a_factor_palette_reaches_the_strips_the_count_bars_and_densities_and_the_cell_plot(page, served):
    configs = {
        P: _plot(color=by(GA)),
        GA: _grouping(partitionings=[CELL_TYPE]),
        GP: _gene_plot(cellAxis={"type": "cell-group", "key": GA}, sections=[{"source": S1, "rows": "genes"}]),
        S1: _sig(S1, "Markers", GENES[:4]),
        CC: {"id": CC, "title": "Count 1", "version": 1, "mode": "bar", "x": CONDITION, "split": {"source": {"type": "cell-group", "key": GA}}},
        CD: {"id": CD, "title": "Count 2", "version": 1, "mode": "density", "x": {"source": {"type": "obs", "key": "depth"}},
             "split": {"source": {"type": "cell-group", "key": GA}}},
    }
    _open(page, served, configs, (P, GA, GP, S1, CC, CD))
    _wait_plot(page, TYPES)
    until(page, f"() => document.querySelector('{GT} .cgene-panel').dataset.state === 'ready'", timeout=60)
    _count_ready(page, SC, "bar")
    _count_ready(page, SD, "density")
    uns = _rgb(page, UNS[:6])
    assert _rgb(page, _strip_colours(page)["legend"][0]) == uns, "the strip legend starts from the dataset's colours"
    assert [_rgb(page, [_count_colours(page, SC)[t]])[0] for t in TYPES] == uns
    asked = len(_computes(page))
    before = _undo_size(page)

    _open_levels(page)
    page.select_option(f"{LEVELS} select.cgrp-palette", "Set1")
    want = _rgb(page, SET1)
    until(page, """([s, want]) => { const gd = document.querySelector(s + ' .js-plotly-plot'); return !!gd && !!gd.data
        && JSON.stringify(gd.data.filter(d => d.showlegend !== false).map(d => d.marker.color)) === JSON.stringify(want); }""", [C, SET1])
    assert [_plot_colours(page)[t] for t in TYPES] == SET1, "the Cell Plot"
    until(page, """([s, want]) => { const gd = document.querySelector(s + ' .cgene-plot');
        const l = gd.data.find((t) => t.name === 'strip legend'); return !!l && JSON.stringify(Array.from(l.marker.color)) === JSON.stringify(want); }""",
          [GT, SET1])
    strips = _strip_colours(page)
    assert strips["legend"][0] == SET1, "the strip legend, in level order"
    assert set(strips["strips"][0]) <= set(SET1) and len(set(strips["strips"][0])) == 6, "the strip: each group in its level's colour"
    until(page, """([s, want]) => { const gd = document.querySelector(s + ' .ccnt-plot'); const c = (gd.data || []).filter(t => t.type === 'bar').map(t => t.marker.color);
        return JSON.stringify(c) === JSON.stringify(want); }""", [SC, SET1])
    until(page, """([s, want]) => { const gd = document.querySelector(s + ' .ccnt-plot');
        const c = (gd.data || []).filter(t => want.includes(t.name) === false && t.line && t.name && typeof t.line.color === 'string').map(t => t.line.color);
        return c.length >= 6 && want.every((w) => c.includes(w)); }""", [SD, SET1])
    assert len(_computes(page)) == asked, "a colour is no request"
    assert _undo_size(page) == before + 1, "one undo step"
    assert _config(page)["partitionings"][0]["colors"] == {"palette": "Set1"}
    assert want == _rgb(page, SET1)


# ------------------------------------------------------------------ 3b. a level's colour

def test_a_level_swatch_sets_one_override_and_reset_colors_clears_it(page, served):
    _open(page, served, {P: _plot(color=by(GA)), GA: _grouping(partitionings=[CELL_TYPE])}, (P, GA))
    _wait_plot(page, TYPES)
    _open_levels(page)
    page.fill(f"{LEVELS} .cgrp-level[data-id='c:T cell'] input[type=color]", "#123456")
    until(page, "([s]) => { const gd = document.querySelector(s + ' .js-plotly-plot'); return !!gd && gd.data.some(d => d.name === 'T cell' && d.marker.color === '#123456'); }", [C])
    assert _config(page)["partitionings"][0]["colors"] == {"overrides": {"c:T cell": "#123456"}}
    page.click(f"{LEVELS} .cgrp-colors-reset")
    until(page, "([s]) => { const gd = document.querySelector(s + ' .js-plotly-plot'); return !!gd && !gd.data.some(d => d.marker && d.marker.color === '#123456'); }", [C])
    assert "colors" not in json.dumps(_config(page))


# ------------------------------------------------------------------ 4. the grouping's colours

def test_color_groups_by_a_factor_a_group_override_and_its_reset(page, served):
    _open(page, served, {P: _plot(color=by(GA)), GA: _grouping(partitionings=TWO)}, (P, GA))
    _wait_plot(page, GROUP_NAMES)
    page.click(SETTINGS_BUTTON)
    page.wait_for_selector(SETTINGS, state="visible")
    options = page.evaluate(f"() => [...document.querySelectorAll(\"{SETTINGS} select.cgrp-color-by option\")].map((o) => [o.value, o.textContent])")
    assert options == [["own", "Own palette"], ["0", "cell_type"], ["1", "condition"]]
    page.select_option(f"{SETTINGS} select.cgrp-color-by", "0")
    until(page, "([s]) => { const gd = document.querySelector(s + ' .js-plotly-plot'); return !!gd && gd.data.some(d => d.name === 'B cell | ctrl' && d.marker.color === '"
                + UNS[0] + "'); }", [C])
    plot = _plot_colours(page)
    assert _rgb(page, [plot["B cell | ctrl"]]) == _rgb(page, [plot["B cell | treated"]]) == _rgb(page, [UNS[0]])
    grid = _grid(page)
    assert _rgb(page, [grid[n] for n in GROUP_NAMES]) == _rgb(page, [plot[n] for n in GROUP_NAMES])
    # a group's own colour from its swatch
    page.keyboard.press("Escape")
    page.fill(f"{A} .cgg-row:has(.cgg-name:text-is('B cell | treated')) .cgg-swatch input[type=color]", "#fedcba")
    until(page, "([s]) => { const gd = document.querySelector(s + ' .js-plotly-plot'); return !!gd && gd.data.some(d => d.name === 'B cell | treated' && d.marker.color === '#fedcba'); }", [C])
    assert _config(page)["colors"]["overrides"] == {json.dumps(["c:B cell", "c:treated"], separators=(",", ":")): "#fedcba"}
    page.click(SETTINGS_BUTTON)
    page.wait_for_selector(SETTINGS, state="visible")
    assert page.inner_text(f"{SETTINGS} .cgrp-group-reset") == "Reset group colors (1)"
    page.click(f"{SETTINGS} .cgrp-group-reset")
    until(page, "([s]) => { const gd = document.querySelector(s + ' .js-plotly-plot'); return !!gd && !gd.data.some(d => d.marker && d.marker.color === '#fedcba'); }", [C])
    assert "overrides" not in _config(page).get("colors", {})


def test_a_group_color_is_set_from_the_keyboard_and_the_grid_keeps_one_tab_stop(page, served):
    """Enter or Space on a focused row opens its group's color picker; the picker is no extra tab stop."""
    _open(page, served, {P: _plot(color=by(GA)), GA: _grouping(partitionings=TWO)}, (P, GA))
    _wait_plot(page, GROUP_NAMES)
    page.evaluate("""() => { window.__picked = []; const own = HTMLInputElement.prototype.showPicker;
        HTMLInputElement.prototype.showPicker = function () { window.__picked.push(this.getAttribute('aria-label')); }; window.__own = own; }""")
    row = f"{A} .cgg-row:has(.cgg-name:text-is('B cell | treated'))"
    assert page.get_attribute(row, "aria-keyshortcuts") == "Enter Space"
    page.focus(row)
    page.keyboard.press("Enter")
    page.keyboard.press(" ")
    assert page.evaluate("() => window.__picked") == ["Color of B cell | treated"] * 2
    assert page.locator(f"{A} .cgg-grid [tabindex='0']").count() == 1, "the row is the grid's one tab stop"
    # what the picker gives is the group's own color, as a click on the swatch gives it
    page.fill(f"{row} .cgg-swatch input[type=color]", "#fedcba")
    until(page, "([s]) => { const gd = document.querySelector(s + ' .js-plotly-plot'); return !!gd && gd.data.some(d => d.name === 'B cell | treated' && d.marker.color === '#fedcba'); }", [C])


# ------------------------------------------------------------------ 5. a link

def test_a_link_keeps_the_palettes_and_the_overrides(page, served):
    key = json.dumps(["c:B cell", "c:ctrl"], separators=(",", ":"))
    cfg = _grouping(partitionings=[{**CELL_TYPE, "colors": {"palette": "Set1", "overrides": {"c:T cell": "#123456"}}}, CONDITION],
                    colors={"by": 0, "overrides": {key: "#fedcba"}})
    _open(page, served, {P: _plot(color=by(GA)), GA: cfg}, (P, GA))
    _wait_plot(page, GROUP_NAMES)
    plot = _plot_colours(page)
    assert _rgb(page, [plot["B cell | ctrl"]]) == _rgb(page, ["#fedcba"]), "the group override"
    assert _rgb(page, [plot["B cell | treated"]]) == _rgb(page, [SET1[0]]), "colored by the first factor, in its palette"
    assert _rgb(page, [plot["T cell | ctrl"]]) == _rgb(page, ["#123456"]), "the level override"
    got = _config(page)
    assert got["colors"] == cfg["colors"] and got["partitionings"][0]["colors"] == cfg["partitionings"][0]["colors"]
    assert N == 1200
