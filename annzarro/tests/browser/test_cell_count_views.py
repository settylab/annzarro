"""The Count Plot's views follow the X axis type (operator, 0.8.0), in a real browser.

1.  With a categorical X the Mode select lists Histogram disabled, its title "Histogram needs a numeric axis."
2.  Choosing a number as X makes the plot a Histogram, said once beside Mode, one undoable step; Bar stays available.
3.  A Histogram's arrangements: Overlaid and 100% work and are undone; Side by side is disabled with its reason.
4.  A link stored as a Histogram of categories opens as a Bar, with the one-time note, and never draws a histogram.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import test_cell_count_panel as cc  # noqa: E402
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

served = cc.served
page = cc.page

CC, S = cc.CC, cc.S
_count, _open, _drawn, _config, _undo_label = cc._count, cc._open, cc._drawn, cc._config, cc._undo_label


def obs(key, **extra):
    return {"source": {"type": "obs", "key": key}, **extra}


CELL_TYPE, CONDITION, DEPTH = obs("cell_type"), obs("condition"), obs("depth")
NUMERIC_AXIS = "Histogram needs a numeric axis."
MODE = """(s) => { const o = [...document.querySelectorAll(s + ' .ccnt-mode option')].find(o => o.value === 'histogram');
    return { disabled: o.disabled, title: o.title, selected: document.querySelector(s + ' .ccnt-mode').value }; }"""
NOTE = "(s) => { const n = document.querySelector(s + ' .ccnt-view-note'); return n && !n.hidden ? n.textContent : ''; }"
ARRANGEMENTS = """(s) => [...document.querySelectorAll(s + ' .ccnt-arrangement__input')]
    .map(i => ({ value: i.value, checked: i.checked, disabled: i.disabled, title: i.closest('label').title || '' }))"""
LAYOUT = """(s) => { const p = document.querySelector(s + ' .ccnt-plot');
    return { barmode: p.layout.barmode, barnorm: p.layout.barnorm || null, opacity: p.data.map(t => t.opacity === undefined ? null : t.opacity) }; }"""


def _shot(page, name):
    folder = os.environ.get("ANNZARRO_SHOTS")
    if folder:
        os.makedirs(folder, exist_ok=True)
        page.locator(S).screenshot(path=os.path.join(folder, name))


def test_histogram_is_disabled_on_categories_and_the_default_once_x_is_a_number(page, served):
    _open(page, served, {CC: _count(mode="bar", x=CELL_TYPE, split=CONDITION)})
    _drawn(page, "bar")
    assert page.evaluate(MODE, S) == {"disabled": True, "title": NUMERIC_AXIS, "selected": "bar"}
    _shot(page, "count-views-histogram-disabled.png")
    # X becomes a number through its own select: the plot is a Histogram now, said once, one step
    page.select_option(f"{S} [data-row='x'] select.axis-key-select", "depth")
    _drawn(page, "histogram", "c.x && c.x.source.key === 'depth'")
    assert page.evaluate(MODE, S) == {"disabled": False, "title": "", "selected": "histogram"}
    assert "Histogram" in page.evaluate(NOTE, S)
    assert _undo_label(page).startswith("Undo:")
    # Bar stays available for a number, and is kept when chosen
    page.select_option(f"{S} .ccnt-mode", "bar")
    _drawn(page, "bar", "c.x.source.key === 'depth'")
    assert page.evaluate(NOTE, S) == "", "the note is said once"
    # back to categories: Histogram is disabled again
    page.select_option(f"{S} .ccnt-mode", "histogram")
    _drawn(page, "histogram")
    page.select_option(f"{S} [data-row='x'] select.axis-key-select", "cell_type")
    _drawn(page, "bar", "c.x.source.key === 'cell_type'")
    assert page.evaluate(NOTE, S) == "Histogram needs a numeric axis: shown as Bar."
    assert page.evaluate(MODE, S)["disabled"] is True


def test_a_histogram_overlaid_and_100_percent_with_undo_and_side_by_side_says_why(page, served):
    _open(page, served, {CC: _count(mode="histogram", x=DEPTH, split=CONDITION)})
    _drawn(page, "histogram")
    choices = page.evaluate(ARRANGEMENTS, S)
    assert [(c["value"], c["disabled"]) for c in choices] == [("stack", False), ("dodge", True), ("overlay", False), ("fill", False)]
    assert "bins" in choices[1]["title"].lower()
    page.click(f"{S} .ccnt-arrangement__opt:has(input[value='overlay'])")
    _drawn(page, "histogram", "c.arrangement === 'overlay'")
    drawn = page.evaluate(LAYOUT, S)
    assert drawn["barmode"] == "overlay" and all(o == 0.6 for o in drawn["opacity"])
    assert _undo_label(page) == "Undo: overlaid bars"
    page.click(f"{S} .ccnt-arrangement__opt:has(input[value='fill'])")
    _drawn(page, "histogram", "c.arrangement === 'fill'")
    drawn = page.evaluate(LAYOUT, S)
    assert (drawn["barmode"], drawn["barnorm"]) == ("stack", "percent")
    assert _undo_label(page) == "Undo: 100% bars"
    _shot(page, "count-views-histogram-100.png")
    page.click(f"{S} .ccnt-undo")
    _drawn(page, "histogram", "c.arrangement === 'overlay'")
    page.click(f"{S} .ccnt-undo")
    _drawn(page, "histogram", "!c.arrangement")
    assert page.evaluate(LAYOUT, S)["barmode"] == "stack"


def test_a_histogram_link_of_categories_opens_as_a_bar_with_the_note(page, served):
    _open(page, served, {CC: _count(mode="histogram", x=CELL_TYPE, split=CONDITION)})
    _drawn(page, "bar")
    assert _config(page)["mode"] == "bar"
    assert page.evaluate(NOTE, S) == "Histogram needs a numeric axis, so this plot is drawn as Bar."
    assert page.evaluate("(s) => { const b = document.querySelector(s + ' .ccnt-state'); return !b || b.hidden; }", S), "drawn, not refused"
    until(page, "(s) => document.querySelector(s + ' .ccnt-panel').dataset.drawn === 'bar'", S)


def test_bar_chosen_on_a_number_stays_through_every_edit_that_does_not_change_x(page, served):
    _open(page, served, {CC: _count(mode="histogram", x=DEPTH, split=CONDITION)})
    _drawn(page, "histogram")
    page.select_option(f"{S} .ccnt-mode", "bar")
    _drawn(page, "bar", "c.x.source.key === 'depth'")
    # an arrangement, the labels, Undo and Redo of them: X never changes, so the view never flips back
    page.click(f"{S} .ccnt-arrangement__opt:has(input[value='fill'])")
    _drawn(page, "bar", "c.arrangement === 'fill'")
    page.select_option(f"{S} .ccnt-labels", "count")
    _drawn(page, "bar", "c.labels === 'count'")
    page.click(f"{S} .ccnt-undo")
    _drawn(page, "bar", "!c.labels")
    # the Color by, from its own select
    page.select_option(f"{S} [data-row='split'] select.axis-key-select", "cell_type")
    _drawn(page, "bar", "c.split && c.split.source.key === 'cell_type'")
    # and the plot's link, opened again
    cfg = _config(page)
    _open(page, served, {CC: _count(**{k: v for k, v in cfg.items() if k not in ("title", "controlsVisible", "id")})})
    _drawn(page, "bar", "c.x.source.key === 'depth'")
    assert _config(page)["mode"] == "bar"
    # a Histogram's Sort by height is shown disabled, with why
    page.select_option(f"{S} .ccnt-mode", "histogram")
    _drawn(page, "histogram")
    sort = page.locator(f"{S} .ccnt-sort")
    assert sort.is_visible() and sort.is_disabled() and sort.get_attribute("title") == "Bins of a number keep the order of the number."
