"""The Count Plot's Histogram view folded into Bar (operator, 0.8.0), in a real browser.

1.  The Mode select has no Histogram; Bar's arrangement has Overlaid, chosen and undone as one step.
2.  A Bar of a number is drawn as the histogram was: each bar at its bin, nearly touching. Side by side is disabled there,
    with the reason as its title; Sort by height too.
3.  A link stored as a histogram, overlaid, opens as a Bar overlaid, drawn the same, with no notice.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import test_cell_count_panel as cc  # noqa: E402

served = cc.served
page = cc.page

CC, S = cc.CC, cc.S
_count, _open, _drawn, _config, _undo_label = cc._count, cc._open, cc._drawn, cc._config, cc._undo_label


def obs(key, **extra):
    return {"source": {"type": "obs", "key": key}, **extra}


CELL_TYPE, CONDITION, DEPTH = obs("cell_type"), obs("condition"), obs("depth")
ARRANGEMENTS = """(s) => [...document.querySelectorAll(s + ' .ccnt-arrangement__input')]
    .map(i => ({ value: i.value, checked: i.checked, disabled: i.disabled, title: i.closest('label').title || '', text: i.closest('label').textContent.trim() }))"""
LAYOUT = """(s) => { const p = document.querySelector(s + ' .ccnt-plot');
    return { barmode: p.layout.barmode, bargap: p.layout.bargap, opacity: p.data.map(t => t.opacity === undefined ? null : t.opacity),
             widths: p.data.map(t => (t.width ? Array.from(t.width) : null)), ticktext: (p.layout.xaxis || {}).ticktext || null }; }"""


def _shot(page, name):
    folder = os.environ.get("ANNZARRO_SHOTS")
    if folder:
        os.makedirs(folder, exist_ok=True)
        page.locator(S).screenshot(path=os.path.join(folder, name))


def test_no_histogram_in_the_mode_select_and_overlaid_bars_with_undo(page, served):
    _open(page, served, {CC: _count(mode="bar", x=CELL_TYPE, split=CONDITION)})
    _drawn(page, "bar")
    modes = page.evaluate("(s) => [...document.querySelectorAll(s + ' .ccnt-mode option')].map(o => o.value)", S)
    assert "histogram" not in modes, modes
    assert modes[:2] == ["bar", "pie"], modes
    choices = page.evaluate(ARRANGEMENTS, S)
    assert [(c["value"], c["text"], c["disabled"]) for c in choices] == [
        ("stack", "Stacked", False), ("dodge", "Side by side", False), ("overlay", "Overlaid", False), ("fill", "100%", False)]
    page.click(f"{S} .ccnt-arrangement__opt:has(input[value='overlay'])")
    _drawn(page, "bar", "c.arrangement === 'overlay'")
    drawn = page.evaluate(LAYOUT, S)
    assert drawn["barmode"] == "overlay"
    assert all(o is not None and 0 < o < 1 for o in drawn["opacity"]), drawn["opacity"]
    assert drawn["bargap"] == 0.15, "categories keep the bar plot's gap"
    assert _undo_label(page) == "Undo: overlaid bars"
    _shot(page, "count-bar-overlaid.png")
    page.click(f"{S} .ccnt-undo")
    _drawn(page, "bar", "!c.arrangement")
    assert page.evaluate(LAYOUT, S)["barmode"] == "stack"
    assert page.is_checked(f"{S} .ccnt-arrangement__input[value='stack']")


def test_a_bar_of_a_number_is_a_histogram_and_side_by_side_says_why_it_does_not_apply(page, served):
    _open(page, served, {CC: _count(mode="bar", x=DEPTH, split=CONDITION)})
    _drawn(page, "bar")
    drawn = page.evaluate(LAYOUT, S)
    assert drawn["bargap"] == 0.02 and drawn["ticktext"] is None, "a number's axis, the bars nearly touching"
    assert all(w and all(x > 0 for x in w) for w in drawn["widths"]), "each bar has its bin's width, on the number's axis"
    dodge = next(c for c in page.evaluate(ARRANGEMENTS, S) if c["value"] == "dodge")
    assert dodge["disabled"] and "bins" in dodge["title"], dodge
    sort = page.locator(f"{S} .ccnt-sort")
    assert sort.is_disabled() and "order of the number" in sort.get_attribute("title")
    _shot(page, "count-bar-of-a-number.png")


def test_a_histogram_link_overlaid_opens_as_a_bar_overlaid_with_no_notice(page, served):
    _open(page, served, {CC: _count(mode="histogram", x=DEPTH, split=CONDITION, arrangement="dodge")})
    _drawn(page, "bar", "c.arrangement === 'overlay'")
    assert page.input_value(f"{S} .ccnt-mode") == "bar"
    assert page.is_checked(f"{S} .ccnt-arrangement__input[value='overlay']")
    drawn = page.evaluate(LAYOUT, S)
    assert drawn["barmode"] == "overlay" and all(o == 0.6 for o in drawn["opacity"]) and drawn["bargap"] == 0.02
    assert page.evaluate("(s) => { const b = document.querySelector(s + ' .ccnt-state'); return !b || b.hidden; }", S), "no notice"
