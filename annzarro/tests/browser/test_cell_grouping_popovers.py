"""Cell Grouping's expanding forms are pop-overs (WP-7 of the options redesign, FB-2 decision h).

The operator's complaint: folding sections change the minimum size of a panel and move the whole layout. A factor's
levels or binning and Settings now open in a pop-over (static/js/ui/popover.js), so editing a
factor moves nothing: not the Grouping tile, not its scroll position, not the tiles beside it.

1.  Three tiles side by side (Grouping, Cell-Gene, Cell Count): editing a factor (a level unticked) keeps the Grouping
    tile's box and scrollTop, the other tiles' boxes and every scroll position above the tile as they were.
2.  The same for Settings (Statistics offered went with decision 31).
3.  The keyboard path: Edit, tick, Escape, and focus is back on Edit; the edit is one undo step.
4.  Each form lives in its own `[data-popover]` surface, and Escape closes it.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import json
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import waits  # noqa: E402
from annzarro.tests.browser.test_cell_gene_panel import GENES, P, S1, S2, TP, _plot, _sig  # noqa: E402
from annzarro.tests.browser.test_cell_grouping_panel import (  # noqa: E402,F401
    A, CELL_TYPE, CONDITION, GA, _grouping, _open, _ready, _state, _url, served)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

CC = "cell-count-A"
SC = f'.tile[data-tile-id="{CC}"]'
EDIT = f"{A} .cgrp-card[data-index='0'] .cgrp-card__edit"
TICK_T = ".cgrp-level[data-id='c:T cell'] input[type=checkbox]"
POP = "[data-popover='levels']"


# The Cell-Gene and Cell Count plots of a 460 px tile make Plotly throw "Something went wrong with axis scaling" on their
# first draw (the same finding as FB-2 finding 10; it is in the neighbours, not in the Grouping panel, and is the plots'
# own work). This page fixture is the panel tests' own, listening for every other error; that one it only records.
NEIGHBOUR_PLOT_ERROR = "Something went wrong with axis scaling"


@pytest.fixture
def page(served):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1500, "height": 1100})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.calls = []
            page.on("request", lambda r: page.calls.append(json.loads(r.post_data or "{}"))
                    if "/data/cell_groups" in r.url and r.method == "POST" else None)
            yield page
            others = [e for e in errors if NEIGHBOUR_PLOT_ERROR not in e]
            assert not others, others
        finally:
            browser.close()


def _configs():
    grouping = _grouping(partitionings=[CELL_TYPE, CONDITION], layers=["logged"])
    return {GA: grouping,
            P: _plot(cellAxis={"type": "cell-group", "key": GA}, cluster={"genes": "sections", "groups": "all"},
                     sections=[{"source": S1, "rows": "genes"}, {"source": S2, "rows": "genes"}]),
            S1: _sig(S1, "B cell markers", GENES[0:6]), S2: _sig(S2, "Pathway", GENES[6:14]),
            CC: {"id": CC, "title": "Count 1", "version": 1, "mode": "bar",
                 "x": {"source": {"type": "obs", "key": "cell_type"}}, "split": {"source": {"type": "obs", "key": "condition"}}}}


def _open_three(page, served):
    page.set_viewport_size({"width": 1400, "height": 800})
    page.goto(_url(served, [GA, P, CC], _configs()))
    page.wait_for_selector(f"{A} .cgrp-panel .cgrp-status[data-state]", timeout=30000)
    _ready(page)
    page.wait_for_selector(f"{A} .cgrp-card[data-index='0']", timeout=30000)
    page.wait_for_selector(f"{TP} .cgene-panel[data-state]", timeout=30000)      # the neighbours are there and have started
    page.wait_for_selector(f"{SC} .js-plotly-plot", timeout=60000)


def _layout(page):
    """The boxes of the three tiles and every scroll position from the Grouping tile up to the page."""
    return page.evaluate("""([a, others]) => {
        const box = (s) => { const e = document.querySelector(s); const r = e.getBoundingClientRect();
            return [r.x, r.y, r.width, r.height].map(Math.round); };
        const scrolls = [];
        for (let e = document.querySelector(a + ' .cgrp-panel'); e; e = e.parentElement) scrolls.push([e.className || e.tagName, e.scrollTop, e.scrollHeight]);
        const doc = document.scrollingElement;
        return { tile: box(a), others: others.map(box), scrolls, page: [doc.scrollTop, doc.scrollHeight] };
    }""", [A, [TP, SC]])


def _open_editor(page, i=0, popover=POP):
    page.click(f"{A} .cgrp-card[data-index='{i}'] .cgrp-card__edit")
    page.wait_for_selector(popover, timeout=10000)


def _unmoved(page, before, what):
    """Check that nothing moved since ``before``: for ``waits.expect_stays`` (it raises, naming what moved)."""
    now = _layout(page)
    assert now["tile"] == before["tile"], f"{what}: the Grouping tile keeps its box"
    assert now["others"] == before["others"], f"{what}: the neighbouring tiles keep their boxes"
    assert now["scrolls"] == before["scrolls"], f"{what}: nothing from the Grouping panel up scrolled or grew"
    assert now["page"] == before["page"], f"{what}: the page did not scroll or grow"
    return True


def _tick_t_cell(page):
    page.uncheck(f"{POP} {TICK_T}")
    until(page, "() => window.PanelManager.getPanel('cell-grouping-A')._debugState().recipe.partitionings[0].levels", None)


def test_editing_a_factor_moves_nothing_in_three_tiles(page, served):
    _open_three(page, served)
    before = _layout(page)
    undo = _state(page)["undo"]
    _open_editor(page)
    _tick_t_cell(page)
    waits.expect_stays(lambda: _unmoved(page, before, "editing a factor"),
                       "an edit is drawn after the change event and the reply: a layout shift would come with them", page=page, seconds=1.0)
    assert _state(page)["undo"] == undo + 1, "one edit, one undo step"
    page.keyboard.press("Escape")
    page.wait_for_selector(POP, state="detached", timeout=5000)
    assert _unmoved(page, before, "closing the pop-over")


def test_settings_move_nothing_in_three_tiles(page, served):
    _open_three(page, served)
    before = _layout(page)
    for anchor, name in ((".cgrp-settings-btn", "settings"),):
        page.click(f"{A} {anchor}")
        page.wait_for_selector(f"[data-popover='{name}']", timeout=10000)
        waits.expect_stays(lambda: _unmoved(page, before, f"opening {name}"),
                           "the pop-over is placed after it is made: a layout shift would come with it", page=page, seconds=0.5)
        page.keyboard.press("Escape")
        page.wait_for_selector(f"[data-popover='{name}']", state="detached", timeout=5000)
        assert page.evaluate("(s) => document.activeElement === document.querySelector(s)", f"{A} {anchor}"), f"focus back on {name}"
    assert _unmoved(page, before, "closing them")


def test_keyboard_path_edit_tick_escape_focus_back(page, served):
    _open(page, served, {GA: _grouping(partitionings=[CELL_TYPE])})
    _ready(page)
    page.wait_for_selector(EDIT, timeout=30000)
    undo = _state(page)["undo"]
    page.focus(EDIT)
    page.keyboard.press("Enter")
    page.wait_for_selector(POP, timeout=10000)
    assert page.evaluate("(p) => document.querySelector(p).contains(document.activeElement)", POP), "focus moves into the pop-over"
    page.focus(f"{POP} {TICK_T}")
    page.keyboard.press("Space")
    until(page, "() => window.PanelManager.getPanel('cell-grouping-A')._debugState().recipe.partitionings[0].levels", None)
    assert _state(page)["undo"] == undo + 1
    assert page.locator(f"{POP} {TICK_T}").is_checked() is False, "the pop-over shows the edit"
    page.keyboard.press("Escape")
    page.wait_for_selector(POP, state="detached", timeout=5000)
    assert page.evaluate("(s) => document.activeElement === document.querySelector(s)", EDIT), "focus is back on Edit"
    assert page.get_attribute(EDIT, "aria-expanded") == "false"


def test_each_form_is_its_own_popover(page, served):
    _open(page, served, {GA: _grouping(partitionings=[CELL_TYPE, {"source": {"type": "obs", "key": "depth"}, "binning": {"method": "equal_count"}}])})
    _ready(page)
    _open_editor(page, 0)
    assert page.locator(f"{POP} .cgrp-levels").count() == 1
    assert page.locator(f"{A} .cgrp-card__body").count() == 0, "nothing expands in the panel"
    page.keyboard.press("Escape")
    page.wait_for_selector(POP, state="detached", timeout=5000)
    _open_editor(page, 1, "[data-popover='binning']")
    page.wait_for_selector("[data-popover='binning'] .pbc", timeout=10000)
    assert page.locator("[data-popover='binning'][role='dialog']").count() == 1
