"""The set list of a Venn and an UpSet as rows, and the colours of the sets, in a real browser.

Each set is one compact line (swatch, letter, name, cells, share, Remove) that fits the panel with no sideways scroll; its
letter opens the pop-over with the definition; the name renames in place like a grouping's level and never changes a
height; a swatch colours the set in the list, the Venn and the UpSet; an UpSet's bars are one colour until Count is chosen.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: F401,E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_memory_guard import until  # noqa: E402
from annzarro.tests.browser.test_cell_count_panel import (  # noqa: E402,F401  (fixtures: served, page)
    CC, S, N, served, page, _count, _open, _config,
)
from annzarro.tests.browser.test_count_sets import (  # noqa: E402
    LEVELS_SET, COND_SET, BOOL_SET, _drawn, _rows, _undo_steps,
)

POP = "[data-popover='set-definition']"
ROW = f"{S} .ccnt-set[data-set-index='{{}}']"


def _grid_requests(page):
    return len([c for c in page.calls if c.get("shape") == "grid" and not c.get("estimate_only")])


def _heights(page):
    return page.evaluate("""(s) => { const l = document.querySelector(s + ' .ccnt-sets__list');
        const p = document.querySelector(s + ' .ccnt-panel');
        return { list: l.getBoundingClientRect().height, panel: p.getBoundingClientRect().height,
                 row: l.querySelector('.ccnt-set').getBoundingClientRect().height }; }""", S)


def _open_venn(page, served, sets=None, **extra):
    _open(page, served, {CC: _count(mode="venn", sets=sets or [LEVELS_SET, COND_SET, BOOL_SET], **extra)})
    _drawn(page, "venn")


def test_each_set_is_one_line_that_fits_the_panel_with_one_remove_and_no_more_button(page, served):
    long = {**COND_SET, "name": "a really quite long name for a set that must be cut short with an ellipsis, not widen the row"}
    _open_venn(page, served, [LEVELS_SET, long, BOOL_SET])
    fit = page.evaluate("""(s) => { const l = document.querySelector(s + ' .ccnt-sets__list');
        const rows = [...l.querySelectorAll('.ccnt-set')];
        return { scroll: l.scrollWidth, client: l.clientWidth, n: rows.length,
                 more: document.querySelectorAll(s + ' .ccnt-set__more, ' + s + ' .ccnt-set__edit').length,
                 removes: rows.map(r => r.querySelectorAll('[data-set-action=remove]').length),
                 swatches: rows.map(r => r.querySelectorAll('input[type=color]').length),
                 letters: rows.map(r => r.querySelector('.ccnt-set__letter').tagName),
                 shares: rows.map(r => r.querySelector('.ccnt-set__share').textContent),
                 overflow: rows.map(r => r.scrollWidth > r.clientWidth + 1),
                 titles: rows.map(r => r.querySelector('.ccnt-set__name').title) }; }""", S)
    assert fit["scroll"] <= fit["client"], "no sideways scroll"
    assert fit["n"] == 3 and fit["more"] == 0
    assert fit["removes"] == [1, 1, 1] and fit["swatches"] == [1, 1, 1]
    assert fit["letters"] == ["BUTTON"] * 3, "the letter opens the definition"
    assert all(s.endswith("%") for s in fit["shares"]), fit["shares"]
    assert not any(fit["overflow"]), "a long name is cut, not wide"
    assert "really quite long name" in fit["titles"][1]
    # every set is one line of equal height (a set with cells without a value has the muted second line besides)
    h = page.evaluate("(s) => [...document.querySelectorAll(s + ' .ccnt-set__line')].map(r => r.getBoundingClientRect().height)", S)
    assert max(h) - min(h) < 1, h


def _start_rename(page, i=0):
    page.dblclick(f"{ROW.format(i)} .ccnt-set__name")
    page.wait_for_selector(f"{ROW.format(i)} input.ccnt-set__name")


def test_renaming_in_place_never_changes_a_height_and_saves_or_cancels_like_the_grouping(page, served):
    _open_venn(page, served)
    before = _heights(page)
    requests = _grid_requests(page)
    steps = _undo_steps(page)

    _start_rename(page)
    during = _heights(page)
    assert during == before, "renaming changes no height"
    page.fill(f"{ROW.format(0)} input.ccnt-set__name", "Alpha")
    page.press(f"{ROW.format(0)} input.ccnt-set__name", "Enter")
    until(page, f"() => window.PanelManager.getPanel('{CC}').getConfig().sets[0].name === 'Alpha'")
    assert _heights(page) == before
    assert _undo_steps(page) == steps + 1
    assert _rows(page)[0]["name"] == "Alpha"

    # the pencil, then Escape, then the cross cancel
    page.click(f"{ROW.format(1)} .ccnt-set__rename")
    page.fill(f"{ROW.format(1)} input.ccnt-set__name", "Nope")
    page.press(f"{ROW.format(1)} input.ccnt-set__name", "Escape")
    page.wait_for_selector(f"{ROW.format(1)} .ccnt-set__rename")
    page.click(f"{ROW.format(1)} .ccnt-set__rename")
    page.fill(f"{ROW.format(1)} input.ccnt-set__name", "Nope")
    page.click(f"{ROW.format(1)} .ccnt-set__cancel")
    page.wait_for_selector(f"{ROW.format(1)} .ccnt-set__rename")
    assert "name" not in _config(page)["sets"][1]
    assert _undo_steps(page) == steps + 1

    # the tick saves
    page.click(f"{ROW.format(1)} .ccnt-set__rename")
    page.fill(f"{ROW.format(1)} input.ccnt-set__name", "Beta")
    page.click(f"{ROW.format(1)} .ccnt-set__ok")
    until(page, f"() => window.PanelManager.getPanel('{CC}').getConfig().sets[1].name === 'Beta'")
    assert _undo_steps(page) == steps + 2

    # a click elsewhere saves
    _start_rename(page, 2)
    page.fill(f"{ROW.format(2)} input.ccnt-set__name", "Gamma")
    page.click(f"{S} .ccnt-sets__universe")
    until(page, f"() => window.PanelManager.getPanel('{CC}').getConfig().sets[2].name === 'Gamma'")
    assert _undo_steps(page) == steps + 3
    assert _heights(page) == before
    assert _grid_requests(page) == requests, "a rename asks the server for nothing"


def test_a_set_colour_reaches_the_list_the_circles_and_is_one_undo_step_with_no_request(page, served):
    _open_venn(page, served, [LEVELS_SET, COND_SET, {**BOOL_SET, "name": "doublets"}])
    defaults = page.evaluate("(s) => [...document.querySelectorAll(s + ' .ccnt-set input[type=color]')].map(i => i.value)", S)
    assert defaults == ["#0072b2", "#e69f00", "#009e73"], "the default colours are the Okabe and Ito ones"
    requests = _grid_requests(page)
    steps = _undo_steps(page)
    page.fill(f"{ROW.format(0)} input[type=color]", "#ff0000")
    until(page, f"() => window.PanelManager.getPanel('{CC}').getConfig().sets[0].color === '#ff0000'")
    assert _undo_steps(page) == steps + 1
    assert "color" not in _config(page)["sets"][1], "only a picked colour is stored"
    shapes = page.evaluate("(s) => document.querySelector(s + ' .ccnt-plot').layout.shapes.map(x => x.fillcolor)", S)
    until(page, "(s) => document.querySelector(s + ' .ccnt-plot').layout.shapes[0].fillcolor === '#ff0000'", S)
    labels = page.evaluate("(s) => document.querySelector(s + ' .ccnt-plot').layout.annotations.map(a => a.text)", S)
    assert any(t.startswith("C · doublets") for t in labels), labels
    assert shapes[1] == "#E69F00"
    assert _grid_requests(page) == requests
    page.evaluate(f"() => window.PanelManager.getPanel('{CC}').undo()")
    until(page, f"() => !('color' in window.PanelManager.getPanel('{CC}').getConfig().sets[0])")


def test_the_letter_opens_the_definition_in_a_pop_over_that_stays_open_while_levels_are_ticked(page, served):
    _open_venn(page, served)
    page.click(f"{ROW.format(0)} .ccnt-set__letter")
    page.wait_for_selector(f"{POP} .ccnt-set__levels input[value='c:T cell']")
    steps = _undo_steps(page)
    page.click(f"{POP} .ccnt-set__levels input[value='c:B cell']")
    until(page, f"() => window.PanelManager.getPanel('{CC}').getConfig().sets[0].member.levels.length === 3")
    assert _undo_steps(page) == steps + 1
    page.wait_for_selector(f"{POP} .ccnt-set__levels input[value='c:B cell']:checked")
    page.keyboard.press("Escape")
    page.wait_for_selector(POP, state="detached")
    assert page.evaluate("(s) => document.activeElement.classList.contains('ccnt-set__letter')", S)


def test_upset_bars_are_one_colour_until_count_colours_them_by_count(page, served):
    sets = [LEVELS_SET, COND_SET, BOOL_SET]
    _open(page, served, {CC: _count(mode="upset", sets=sets)})
    _drawn(page, "upset")
    fig = page.evaluate("""(s) => { const t = document.querySelector(s + ' .ccnt-plot').data.find(d => d.name === 'intersections');
        const sizes = document.querySelector(s + ' .ccnt-plot').data.find(d => d.name === 'set sizes');
        return { color: t.marker.color, scale: !!t.marker.showscale, sizes: Array.from(sizes.marker.color) }; }""", S)
    assert isinstance(fig["color"], str) and not fig["scale"], "uniform by default"
    assert fig["sizes"] == ["#0072B2", "#E69F00", "#009E73"]
    choices = page.evaluate("(s) => [...document.querySelectorAll(s + ' .ccnt-value option')].map(o => o.textContent)", S)
    assert choices[:2] == ["None", "Count"]
    assert page.eval_on_selector(f"{S} .ccnt-value", "e => e.value") == "none"

    page.select_option(f"{S} .ccnt-value", "count")
    until(page, f"() => (window.PanelManager.getPanel('{CC}').getConfig().value || {{}}).kind === 'count'")
    until(page, """(s) => { const t = document.querySelector(s + ' .ccnt-plot').data.find(d => d.name === 'intersections');
        return t && Array.isArray(t.marker.color) && t.marker.showscale; }""", S)
    bars = page.evaluate("""(s) => { const p = document.querySelector(s + ' .ccnt-plot');
        const t = p.data.find(d => d.name === 'intersections'); return { color: Array.from(t.marker.color), y: Array.from(t.y) }; }""", S)
    assert bars["color"] == bars["y"], "each bar is coloured by its count"
    page.wait_for_selector(f"{S} .ccnt-plot .colorbar")

    page.select_option(f"{S} .ccnt-value", "none")
    until(page, f"() => !('value' in window.PanelManager.getPanel('{CC}').getConfig())")


def test_a_stored_link_keeps_its_names_and_stores_nothing_new(page, served):
    sets = [{**LEVELS_SET, "name": "T and NK"}, {**COND_SET, "name": "late"}]
    _open(page, served, {CC: _count(mode="upset", sets=sets)})
    _drawn(page, "upset")
    assert [r["name"] for r in _rows(page)] == ["T and NK", "late"]
    cfg = page.evaluate("() => window.sessionManager.captureView()")["layout"]["panelConfigs"][CC]
    assert "value" not in cfg and all("color" not in s for s in cfg["sets"])
    assert cfg["sets"][0]["name"] == "T and NK"
