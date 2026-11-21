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
    _wait_legend, _wait_notice, by)
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
    request = [c for c in page.calls if not c.get("estimate_only")][-1]
    assert request["want"]["codes"] is True


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
    _menus(page, "x")
    state = page.evaluate("""(t) => { const o = document.querySelector(`${t} select.axis-type-select[data-axis="x"] option[value="cell-group"]`);
        return { disabled: o.disabled, title: o.getAttribute('title') }; }""", C)
    assert state["disabled"] is True and state["title"], state
    colour = page.evaluate("""(t) => { const o = document.querySelector(`${t} select.axis-type-select[data-axis="color"] option[value="cell-group"]`);
        return { disabled: o.disabled }; }""", C)
    assert colour["disabled"] is False, "colour is the one axis a grouping has in large-plot mode"


# ------------------------------------------------------------------ 2. the memory guard

# Set the tab's buffer ceiling so that `fraction` of the way from what the redraw of the drawn large plot needs to what
# its peak holds is free, with no margin: the redraw's own check passes, and the codes' check (made once the plot's draw
# is reserved at its peak) is the one that binds.
LIMIT = """async ([id, where]) => {
    const { Config } = await import('/static/js/config.js');
    const g = await import('/static/js/utils/memory-guard-ui.js');
    const m = await import('/static/js/utils/memory-guard.js');
    g.held();
    const n = g.ledger.get(id).n;
    const p = { kind: 'cell-plot', n, large: true };
    const need = m.bufferDrawNeed(p, g.ledger.get(id));
    const peak = m.panelBuffers(p).peak;
    const codes = n;
    // the buffers held beside the plot's own old drawing (it is counted once, as the redraw's check counts it)
    const base = g.ledger.buffers();
    const free = where === 'between' ? (need + peak) / 2 : peak + 2 * codes;
    Config.DEFAULTS.MEMORY = { ...(Config.DEFAULTS.MEMORY || {}), margin: 0, buffers_gb: (base + free) / m.GB };
    document.dispatchEvent(new CustomEvent(g.MEMORY_EVENT));
    return { need, peak, base, free, codes };
}"""

HELD = """async () => (await import('/static/js/utils/memory-guard-ui.js')).ledger.heldBytes()"""


def test_codes_that_do_not_fit_are_refused_before_the_request_and_another_that_fits_is_drawn(page, large_served):
    _open(page, large_served, {P: _plot(color=NONE), GA: _grouping(), GB: _grouping(GB, "Grouping 2", [CONDITION])})
    until(page, """async (id) => { const g = await import('/static/js/utils/memory-guard-ui.js');
        return !!g.ledger.get(id) && !g.ledger.pending.has(id); }""", P)
    assert _large(page)["large"] is True
    _menus(page)
    figures = page.evaluate(LIMIT, [P, "between"])
    assert figures["need"] < figures["free"] < figures["peak"], figures
    before = {"requests": len(page.requests), "held": page.evaluate(HELD)}
    page.select_option(f'{C} select.axis-type-select[data-axis="color"]', "cell-group")
    until(page, """(t) => [...document.querySelectorAll(`${t} select.axis-key-select[data-axis="color"] option`)].some(o => o.value === 'cell-grouping-A')""", C)
    page.select_option(f'{C} select.axis-key-select[data-axis="color"]', GA)
    notice = _wait_notice(page, "refused")
    assert "buffers" in notice["text"].lower(), f"the guard's words, naming what ran out: {notice}"
    assert [a.split("|")[0] for a in notice["actions"]] == ["score-choose"], "the way out is another grouping"
    assert len(page.requests) == before["requests"], "no request of any kind: not even an estimate"
    assert page.evaluate(HELD) == before["held"], "nothing held on the ledger"
    # a grouping that fits: the same guard, room for its codes, and the plot draws it
    page.evaluate(LIMIT, [P, "room"])
    page.select_option(f'{C} select.axis-key-select[data-axis="color"]', GB)
    _wait_legend(page, gstore.CONDITIONS)
    assert _notice(page) is None
    assert [c for c in page.calls if not c.get("estimate_only") and c["want"]["codes"]], "its codes were asked for now"
    assert page.evaluate(HELD) == before["held"] + N, "one byte a cell on the ledger"
    assert not [c for c in page.calls if c.get("partitionings") and c["partitionings"][0]["source"]["key"] == "cell_type"
                and c["want"]["codes"]], "the refused grouping's codes were never asked for"
