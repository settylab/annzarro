"""A Cell Grouping as the colour of a LARGE plot (G8b), in a real browser against the real cell_groups route.

The store is the grouping fixture (tests/core/grouping_store.py): 1,200 cells. The server lowers
``ui.defaults.large_plot_points`` to 10, so every plot of it is a large plot.

1.  Colour (CAT-3): a grouping colours a large plot as a categorical colours it, with one legend entry per group in
    group order, and the cells in no group read "Not in any group"; it is not an axis there (the existing text-axis
    reason).
2.  The memory guard (CAT-4): codes that do not fit are refused BEFORE the request, in the guard's words. No request of
    any kind goes out (counted), nothing is held on the ledger, and another grouping that fits is then drawn.

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
from annzarro.tests.browser.test_cell_group_plots import (  # noqa: E402
    C, CELL_TYPE, CONDITION, GA, GB, N, NONE, P, TYPES, _grouping, _legend, _menus, _notice, _open, _plot, _traces,
    _pick, _wait_legend, _wait_notice, by)
from annzarro.tests.browser.test_cell_grouping_panel import _make_store  # noqa: E402
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402
from annzarro.tests.browser.test_names_dataset_scope import _serve  # noqa: E402
from annzarro.tests.core import grouping_store as gstore  # noqa: E402


@pytest.fixture(scope="module")
def large_served(tmp_path_factory):
    original = _focus._make_store
    _focus._make_store = _make_store
    try:
        proc, root, store = _serve(tmp_path_factory, "ui:\n  defaults:\n    large_plot_points: 10\n")
    finally:
        _focus._make_store = original
    yield root, store
    proc.terminate()
    proc.wait(10)


@pytest.fixture
def page(large_served):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1500, "height": 1000})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.calls = []
            page.requests = []
            page.on("request", lambda r: page.requests.append(r.url) if "/data/cell_groups" in r.url else None)
            page.on("request", lambda r: page.calls.append(json.loads(r.post_data or "{}"))
                    if "/data/cell_groups" in r.url and r.method == "POST" else None)
            yield page
            assert not errors, errors
        finally:
            browser.close()


def _large(page):
    """Whether the plot is drawn in large-plot mode, and how many points it holds."""
    return page.evaluate("""(t) => { const gd = document.querySelector(t + ' .js-plotly-plot');
        return { large: !!(gd && gd.__isLarge), tag: !!document.querySelector(t + ' .plot-status .ps-tag[data-tag="large"]') }; }""", C)


# ------------------------------------------------------------------ 1. colour

def test_a_grouping_colours_a_large_plot_one_entry_per_group_in_group_order(page, large_served):
    _open(page, large_served, {P: _plot(color=by(GA)), GA: _grouping()}, open_ids=(P, GA))
    _wait_legend(page, TYPES)
    assert _large(page) == {"large": True, "tag": True}, "this is large-plot mode"
    traces = _traces(page)
    assert [t[0] for t in traces] == TYPES, "one entry per group, in group order"
    assert [t[2] for t in traces] == [n for _, n in gstore.CELL_TYPES], "every cell is drawn, in its group's colour"
    assert _legend(page) == "Grouping 1", "the legend is named for the grouping (CAT-8)"
    # the grouping's own panel asks too, without codes: the plot's request is the one that wants them
    assert [c for c in page.calls if not c.get("estimate_only") and c["want"]["codes"]], "the plot asked for the codes"


def test_cells_in_no_group_read_not_in_any_group_in_large_plot_mode(page, large_served):
    two = {**CELL_TYPE, "levels": ["c:B cell", "c:T cell"], "rest": "exclude"}
    _open(page, large_served, {P: _plot(color=by(GA)), GA: _grouping(partitionings=[two])})
    _wait_legend(page, ["B cell", "T cell"])
    assert _large(page)["large"] is True
    traces = {t[0]: t for t in _traces(page)}
    assert set(traces) == {"B cell", "T cell", "Not in any group"}, "not NA: the grouping's own words"
    assert traces["Not in any group"][2] == N - 800, "the cells of the levels left out"


def test_a_grouping_is_not_an_axis_of_a_large_plot(page, large_served):
    _open(page, large_served, {P: _plot(color=by(GA)), GA: _grouping()})
    _wait_legend(page, TYPES)
    for axis in ("x", "y"):
        _menus(page, axis)
        page.select_option(f'{C} select.axis-type-select[data-axis="{axis}"]', "layer")
        sel = f'{C} select.axis-column-select[data-axis="{axis}"]'
        until(page, "([s]) => !!document.querySelector(s) && [...document.querySelector(s).options].some(o => o.value.includes('cell-group'))", [sel])
        state = page.evaluate("""(s) => [...document.querySelector(s).options].filter(o => o.value.includes('cell-group'))
            .map(o => [o.disabled, o.getAttribute('title')])""", sel)
        assert state and all(d and t == "A grouping can color a large plot, not be one of its axes." for d, t in state), (axis, state)
    # colour is the one axis a grouping has in large-plot mode
    _menus(page, "color")
    page.select_option(f'{C} select.axis-type-select[data-axis="color"]', "layer")
    sel = f'{C} select.axis-column-select[data-axis="color"]'
    until(page, "([s]) => !!document.querySelector(s) && [...document.querySelector(s).options].some(o => o.value.includes('cell-group'))", [sel])
    assert page.evaluate("""(s) => [...document.querySelector(s).options].filter(o => o.value.includes('cell-group')).every(o => !o.disabled)""", sel)


# ------------------------------------------------------------------ 2. the memory guard

P2 = "cell-plot-Q"
C2 = f'.tile[data-tile-id="{P2}"]'

# Set the tab's buffer ceiling, with no margin, so that a SECOND large plot's first draw just fits beside the first
# (`room` 'none': its own check passes with 100 bytes to spare) and the codes it then asks for do not (a grouping's
# codes are 1 byte a cell: 1,200). With `room` 'codes' there is room for them.
LIMIT = """async ([id, room]) => {
    const { Config } = await import('/static/js/config.js');
    const g = await import('/static/js/utils/memory-guard-ui.js');
    const m = await import('/static/js/utils/memory-guard.js');
    g.held();
    const n = g.ledger.get(id).n;
    const peak = m.panelBuffers({ kind: 'cell-plot', n, large: true }).peak;
    const base = g.ledger.buffers();
    const free = room === 'none' ? peak + 100 : peak + 4 * n;
    Config.DEFAULTS.MEMORY = { ...(Config.DEFAULTS.MEMORY || {}), margin: 0, buffers_gb: (base + free) / m.GB };
    document.dispatchEvent(new CustomEvent(g.MEMORY_EVENT));
    return { peak, base, free, codes: n };
}"""

HELD = """async () => (await import('/static/js/utils/memory-guard-ui.js')).ledger.heldBytes()"""


def test_codes_that_do_not_fit_are_refused_before_the_request_and_another_that_fits_is_drawn(page, large_served):
    plot2 = _plot(color=by(GA), id=P2, title="Cell Plot 2")
    _open(page, large_served, {P: _plot(color=NONE), P2: plot2, GA: _grouping(), GB: _grouping(GB, "Grouping 2", [CONDITION])})
    until(page, """async (id) => { const g = await import('/static/js/utils/memory-guard-ui.js');
        return !!g.ledger.get(id) && !g.ledger.pending.has(id); }""", P)
    assert _large(page)["large"] is True
    figures = page.evaluate(LIMIT, [P, "none"])
    assert figures["free"] == figures["peak"] + 100 and figures["codes"] == N, figures
    before = {"requests": len(page.requests), "held": page.evaluate(HELD)}
    # the second plot is drawn now, with the first one beside it
    page.evaluate("(id) => window.PanelManager.reopenClosedPanel(id)", P2)
    page.wait_for_selector(f"{C2}", timeout=30000)
    until(page, """(t) => { const n = document.querySelector(t + ' .score-notice'); return !!n && n.dataset.state === 'refused'; }""", C2)
    notice = page.evaluate("""(t) => { const el = document.querySelector(t + ' .score-notice');
        return { text: el.textContent.replace(/\\s+/g, ' ').trim(),
                 actions: [...el.querySelectorAll('[data-ps-action]')].map(b => b.dataset.psAction) }; }""", C2)
    assert "buffers" in notice["text"].lower(), f"the guard's words, naming what ran out: {notice}"
    assert notice["actions"] == ["score-choose"], "the way out is another grouping"
    assert len(page.requests) == before["requests"], "no request of any kind: not even an estimate"
    assert page.evaluate(HELD) == before["held"], "nothing held on the ledger"
    # room for the codes of another grouping: the same guard lets them in, and the plot draws it
    page.evaluate(LIMIT, [P, "codes"])
    _pick(page, "color", GB, C2)
    until(page, """([t, names]) => { const gd = document.querySelector(t + ' .js-plotly-plot');
        return !!(gd && gd.data && names.every(n => gd.data.some(d => d.name === n)) && !document.querySelector(t + ' .score-notice')); }""",
          [C2, gstore.CONDITIONS])
    assert [c for c in page.calls if not c.get("estimate_only") and c["want"]["codes"]], "its codes were asked for now"
    assert page.evaluate(HELD) == before["held"] + N, "one byte a cell on the ledger"
    assert not [c for c in page.calls if c.get("partitionings") and c["partitionings"][0]["source"]["key"] == "cell_type"
                and c["want"]["codes"]], "the refused grouping's codes were never asked for"
