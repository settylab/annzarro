"""The Cell-Gene Plot's clicks in a real browser (X7; CXG-15: "Clicking a gene focuses it. Clicking a group label offers
Open grouping.").

The store is the grouping fixture (tests/core/grouping_store.py): 1,200 cells, cell_type with 6 levels, 40 genes.

1.  A click on a dot, a heatmap cell or a gene's label focuses that gene the way every panel does (DataManager's focused
    gene, which the cell plots and the count plot follow), and the gene's label is marked.
2.  A one-row section's row is no gene: a click on its dot or its label focuses nothing.
3.  A click on a group's label, with a Cell Grouping as the groups, offers Open grouping; choosing it shows the grouping
    panel. Escape closes the offer.
4.  With an obs column as the groups there is no grouping to open: a click on a group's label offers nothing.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_cell_gene_panel import (  # noqa: E402,F401 (the fixtures)
    served, page, _open, _plot, _sig, _drawn, P, TP, S1, GA, GENES)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402
from annzarro.tests.browser import waits  # noqa: E402

GROUPING = {"id": GA, "title": "Grouping 1", "version": 1, "partitionings": [{"source": {"type": "obs", "key": "cell_type"}}]}
MENU = f"{TP} .cgene-group-menu"
OTHER = GENES[-1]
FOCUSED = "() => import('/static/js/data-manager.js').then(m => m.DataManager.getFocusedGene())"


def _focused(page):
    return page.evaluate(FOCUSED)


def _until_focused(page, gene):
    until(page, f"() => ({FOCUSED})().then(g => g === {gene!r})", timeout=30)


def _focus_first(page, gene=OTHER):
    """Focus a gene the plot does not draw, so a click's focus is told from the one the dataset opened with."""
    page.evaluate("(g) => import('/static/js/data-manager.js').then(m => m.DataManager.setFocusedGene(g))", gene)
    _until_focused(page, gene)


def _at(page, x, y):
    """The page coordinates of (x, y) in the matrix's data coordinates."""
    return page.evaluate("""([s, x, y]) => {
        const p = document.querySelector(s + ' .cgene-plot');
        const L = p._fullLayout;
        const svg = p.querySelector('.main-svg').getBoundingClientRect();
        return [svg.left + L.xaxis._offset + L.xaxis.l2p(x), svg.top + L.yaxis._offset + L.yaxis.l2p(y)];
    }""", [TP, x, y])


def _tick(page, axis, text=None, index=0):
    """The page coordinates of the centre of a tick label of the main x or y axis: the one reading `text`, or the
    `index`-th one."""
    return page.evaluate("""([s, cls, text, index]) => {
        const ticks = [...document.querySelectorAll(s + ' .cgene-plot g.' + cls)];
        const g = text === null ? ticks[index] : ticks.find(e => e.textContent === text);
        if (!g) return null;
        const b = g.getBoundingClientRect();
        return [b.left + b.width / 2, b.top + b.height / 2];
    }""", [TP, f"{axis}tick", text, index])


def _gene_position(page, gene):
    """Where a gene's row is on the x axis (its tick value), as drawn."""
    return page.evaluate("([s, g]) => { const a = document.querySelector(s + ' .cgene-plot').layout.xaxis; return a.tickvals[a.ticktext.indexOf(g)]; }",
                         [TP, gene])


def _weight(page, text):
    return page.evaluate("""([s, t]) => {
        const g = [...document.querySelectorAll(s + ' .cgene-plot g.xtick')].find(e => e.textContent === t);
        const el = g && g.querySelector('text');
        return el ? getComputedStyle(el).fontWeight : null;
    }""", [TP, text])


def _menu_shown(page):
    return page.evaluate("(s) => { const m = document.querySelector(s); return !!m && !m.hidden; }", MENU)


def _until_drawn_again(page, check):
    until(page, "([s, f]) => { const p = document.querySelector(s + ' .cgene-plot'); return !!p && !!p.data && (new Function('p', 'return (' + f + ')(p)'))(p); }",
          [TP, check], timeout=30)


# ------------------------------------------------------------------ 1. a gene

def test_a_click_on_a_dot_or_a_heatmap_cell_focuses_its_gene_and_marks_its_label(page, served):
    genes = GENES[:4]
    _open(page, served, {P: _plot(cellAxis={"type": "obs", "key": "cell_type"}, sections=[{"source": S1, "rows": "genes"}]),
                         S1: _sig(S1, "Markers", genes)}, open_ids=(P, S1))
    _drawn(page)
    _focus_first(page)
    page.mouse.click(*_at(page, _gene_position(page, genes[1]), 0))
    _until_focused(page, genes[1])
    until(page, "([s, t]) => { const g = [...document.querySelectorAll(s + ' .cgene-plot g.xtick')].find(e => e.textContent === t); "
                "return !!g && ['bold', '700'].includes(getComputedStyle(g.querySelector('text')).fontWeight); }", [TP, genes[1]])
    assert _weight(page, genes[0]) not in ("bold", "700"), "only the focused gene is marked"

    # a heatmap cell, the mark following the focus
    page.click(f"{TP} .cgene-mode input[value='heatmap']")
    _until_drawn_again(page, "(p) => p.data[0].type === 'heatmap'")
    page.mouse.click(*_at(page, _gene_position(page, genes[2]), 3))
    _until_focused(page, genes[2])
    until(page, "([s, t]) => { const g = [...document.querySelectorAll(s + ' .cgene-plot g.xtick')].find(e => e.textContent === t); "
                "return !!g && ['bold', '700'].includes(getComputedStyle(g.querySelector('text')).fontWeight); }", [TP, genes[2]])
    assert _weight(page, genes[1]) not in ("bold", "700")


def test_a_click_on_a_gene_label_focuses_it(page, served):
    genes = GENES[:4]
    _open(page, served, {P: _plot(cellAxis={"type": "obs", "key": "cell_type"}, sections=[{"source": S1, "rows": "genes"}]),
                         S1: _sig(S1, "Markers", genes)}, open_ids=(P, S1))
    _drawn(page)
    _focus_first(page)
    page.mouse.click(*_tick(page, "x", genes[3]))
    _until_focused(page, genes[3])
    assert not _menu_shown(page), "a gene's label offers nothing: it focuses"


# ------------------------------------------------------------------ 2. a one-row section

def test_a_one_row_section_is_no_gene_and_a_click_on_it_does_nothing(page, served):
    _open(page, served, {P: _plot(cellAxis={"type": "cell-group", "key": GA}, sections=[{"source": S1, "rows": "set"}]),
                         S1: _sig(S1, "Markers", GENES[:4]), GA: GROUPING}, open_ids=(P, S1))
    _drawn(page)
    _focus_first(page)
    page.mouse.click(*_at(page, 0, 0))
    page.mouse.click(*_tick(page, "x", "Markers"))
    waits.expect_stays(lambda: _focused(page) == OTHER and not _menu_shown(page),
                       "a click on a one-row section must do nothing; there is no change to wait for", page=page, seconds=1.0)


# ------------------------------------------------------------------ 3. a group, with a grouping

def test_a_group_label_offers_open_grouping_which_shows_the_grouping(page, served):
    _open(page, served, {P: _plot(cellAxis={"type": "cell-group", "key": GA}, sections=[{"source": S1, "rows": "genes"}]),
                         S1: _sig(S1, "Markers", GENES[:4]), GA: GROUPING}, open_ids=(P, S1))
    _drawn(page)
    grouping_tile = f'.tile[data-tile-id="{GA}"]'
    assert page.locator(grouping_tile).count() == 0, "the grouping starts closed"
    _focus_first(page)

    # Escape takes the offer back
    page.mouse.click(*_tick(page, "y", index=1))
    page.wait_for_selector(f"{MENU}:not([hidden])")
    page.keyboard.press("Escape")
    page.wait_for_selector(MENU, state="hidden")

    page.mouse.click(*_tick(page, "y", index=1))
    page.wait_for_selector(f"{MENU}:not([hidden])")
    item = page.locator(f"{MENU} [role='menuitem']")
    assert item.count() == 1
    assert item.inner_text() == "Open grouping"
    assert _focused(page) == OTHER, "a group's label focuses no gene"
    item.click()
    page.wait_for_selector(grouping_tile, timeout=30000)
    page.wait_for_selector(MENU, state="hidden")


# ------------------------------------------------------------------ 4. a group, with an obs column

def test_with_an_obs_column_a_group_label_offers_nothing(page, served):
    _open(page, served, {P: _plot(cellAxis={"type": "obs", "key": "cell_type"}, sections=[{"source": S1, "rows": "genes"}]),
                         S1: _sig(S1, "Markers", GENES[:4])}, open_ids=(P, S1))
    _drawn(page)
    _focus_first(page)
    page.mouse.click(*_tick(page, "y", index=1))
    waits.expect_stays(lambda: not _menu_shown(page) and _focused(page) == OTHER,
                       "an obs column has no grouping to open, so the click must offer nothing; nothing to wait for",
                       page=page, seconds=1.0)
