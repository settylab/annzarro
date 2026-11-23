"""The Cell Count Plot on the pop-over pattern (WP-6a): Levels, Binning and Color open in pop-overs that never change the
panel, Log axis, Ring and the density row are in the control grid, Save as grouping and Color are on the toolbar, and there
is no Show as table.

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

CC, S, DATA = cc.CC, cc.S, cc.DATA
_count, _open, _drawn, _config = cc._count, cc._open, cc._drawn, cc._config


def obs(key, **extra):
    return {"source": {"type": "obs", "key": key}, **extra}

BOX = """(s) => { const q = (sel) => { const r = document.querySelector(s + ' ' + sel).getBoundingClientRect();
    return [r.left, r.top, r.width, r.height].map(Math.round); };
    return { plot: q('.ccnt-plot-area'), controls: q('.ccnt-controls'), tile: q('.ccnt-panel'),
             scroll: [document.querySelector(s + ' .tile-content').scrollTop, document.querySelector(s + ' .ccnt-controls').scrollTop] }; }"""

TOOLBAR = "(s) => [...document.querySelectorAll(s + ' .ccnt-toolbar > .btn')].filter(b => !b.hidden).map(b => b.textContent.trim())"


def _focus_is(page, selector):
    return page.evaluate("(sel) => document.activeElement === document.querySelector(sel)", selector)


@pytest.mark.parametrize("kind, config, button, popover", [
    ("levels", dict(mode="bar", x=cc.CELL_TYPE, split=cc.CONDITION), "[data-row='x'] .ccnt-choose", "levels"),
    ("binning", dict(mode="histogram", x=obs("depth")), "[data-row='x'] .ccnt-bins", "binning"),
])
def test_opening_levels_or_binning_leaves_the_panel_alone_and_escape_returns_focus(page, served, kind, config, button, popover):
    _open(page, served, {CC: _count(**config)})
    _drawn(page, config["mode"])
    before = page.evaluate(BOX, S)
    page.click(f"{S} {button}")
    page.wait_for_selector(f"[data-popover='{popover}']")
    assert page.evaluate(BOX, S) == before, "opening the editor moves nothing: not the plot box, not the scroll"
    assert page.is_visible(f"[data-popover='{popover}'] .az-popover-title")
    assert page.get_attribute(f"{S} {button}", "aria-expanded") == "true"
    # an edit applies live and the pop-over stays, over an unchanged panel
    if kind == "levels":
        page.click(f"[data-popover='levels'] .ccnt-level:first-child input[type=checkbox]")
        _drawn(page, "bar", "Array.isArray(c.x.levels)")
    else:
        page.fill("[data-popover='binning'] .pbc-bins", "20")
        page.press("[data-popover='binning'] .pbc-bins", "Enter")
        _drawn(page, "histogram", "c.x.binning && c.x.binning.bins === 20")
    assert page.is_visible(f"[data-popover='{popover}']")
    assert page.evaluate(BOX, S) == before
    page.keyboard.press("Escape")
    page.wait_for_selector(f"[data-popover='{popover}']", state="detached")
    assert _focus_is(page, f"{S} {button}"), "Escape returns focus to the button"
    assert page.evaluate(BOX, S) == before


def test_log_axis_ring_and_the_density_row_are_in_the_control_grid_and_there_is_no_plot_options_box(page, served):
    _open(page, served, {CC: _count(mode="bar", x=cc.CELL_TYPE)})
    _drawn(page, "bar")
    assert page.is_visible(f"{S} .ccnt-row--labels .ccnt-log") and not page.is_visible(f"{S} .ccnt-ring")
    assert page.query_selector(f"{S} .ccnt-options-btn") is None and page.query_selector(f"{S} .ccnt-options") is None
    page.click(f"{S} .ccnt-log")
    _drawn(page, "bar", "c.log === true")
    page.select_option(f"{S} .ccnt-mode", "pie")
    _drawn(page, "pie")
    assert page.is_visible(f"{S} .ccnt-row--labels .ccnt-ring") and not page.is_visible(f"{S} .ccnt-log")
    page.select_option(f"{S} .ccnt-mode", "density")
    page.evaluate(f"""() => window.PanelManager.getPanel('{CC}').updateConfig({{ x: {{ source: {{ type: 'obs', key: 'depth' }} }} }})""")
    _drawn(page, "density")
    assert page.is_visible(f"{S} .ccnt-row--density .ccnt-adjust")
    assert page.inner_text(f"{S} .ccnt-row--density .ctl-label") == "Smoothing"


def test_the_toolbar_is_save_as_grouping_color_then_undo_and_save_works_from_it(page, served):
    depth, score = obs("depth"), obs("score")
    _open(page, served, {CC: _count(mode="hist2d", x=depth, y=score)})
    _drawn(page, "hist2d")
    assert page.evaluate(TOOLBAR, S) == ["Save as grouping", "Color ▾", "Download CSV", "Undo"]
    assert page.query_selector(f"{S} .ccnt-table-btn") is None
    page.click(f"{S} .ccnt-toolbar .ccnt-save-btn")
    page.wait_for_selector(f"{S} .ccnt-save")
    assert page.inner_text(f"{S} .ccnt-save .ccnt-save__title") == "Save as grouping"


def test_color_shows_when_a_colour_scale_or_a_level_palette_applies_and_the_map_reaches_the_plot(page, served):
    _open(page, served, {CC: _count(mode="bar", x=cc.CELL_TYPE)})
    _drawn(page, "bar")
    assert "Color ▾" not in page.evaluate(TOOLBAR, S), "a plain bar has nothing to colour"
    page.select_option(f"{S} .ccnt-mode", "hist2d")
    page.evaluate(f"""() => window.PanelManager.getPanel('{CC}').updateConfig({{ x: {{ source: {{ type: 'obs', key: 'depth' }} }}, y: {{ source: {{ type: 'obs', key: 'score' }} }} }})""")
    _drawn(page, "hist2d")
    assert "Color ▾" in page.evaluate(TOOLBAR, S)
    before = page.evaluate(BOX, S)
    page.click(f"{S} .ccnt-color-btn")
    page.wait_for_selector("[data-popover='color']")
    assert page.evaluate(BOX, S) == before
    assert page.eval_on_selector("[data-popover='color'] .ccnt-color-map", "e => e.value") == "Viridis"
    page.select_option("[data-popover='color'] .ccnt-color-map", "Cividis")
    _drawn(page, "hist2d", "c.color && c.color.map === 'Cividis'")
    page.check("[data-popover='color'] .ccnt-color-reverse")
    page.fill("[data-popover='color'] .ccnt-color-min", "2")
    page.press("[data-popover='color'] .ccnt-color-min", "Enter")
    _drawn(page, "hist2d", "c.color.reverse === true && c.color.min === 2")
    trace = page.evaluate("(s) => { const t = document.querySelector(s + ' .ccnt-plot').data[0]; return { cs: t.colorscale, rev: t.reversescale, zmin: t.zmin }; }", S)
    assert trace["rev"] is True and trace["zmin"] == 2 and trace["cs"] != "Viridis", trace
    page.fill("[data-popover='color'] .ccnt-color-max", "x")
    page.press("[data-popover='color'] .ccnt-color-max", "Enter")
    assert page.inner_text("[data-popover='color'] .ccnt-color__problem") == "Enter a number, or leave it empty for automatic."
    assert "max" not in _config(page)["color"]
    page.click("[data-popover='color'] .ccnt-color-reset")
    _drawn(page, "hist2d", "c.color === undefined")
    page.keyboard.press("Escape")
    page.wait_for_selector("[data-popover='color']", state="detached")
    assert _focus_is(page, f"{S} .ccnt-color-btn")
    # a Color by makes it a level palette
    page.evaluate(f"""() => window.PanelManager.getPanel('{CC}').updateConfig({{ split: {{ source: {{ type: 'obs', key: 'condition' }} }} }})""")
    _drawn(page, "hist2d")
    page.click(f"{S} .ccnt-color-btn")
    page.wait_for_selector("[data-popover='color'] .ccnt-color-palette")
    assert page.query_selector("[data-popover='color'] .ccnt-color-map") is None
    page.select_option("[data-popover='color'] .ccnt-color-palette", "tab10")
    _drawn(page, "hist2d", "c.color && c.color.palette === 'tab10'")
    cols = page.evaluate("(s) => [...document.querySelector(s + ' .ccnt-plot').data].filter(t => t.type === 'scatter').map(t => t.marker.color)", S)
    assert cols[0] == "#1f77b4", cols


def test_screenshots_of_the_toolbar_and_each_popover(page, served):
    """Screenshots for a look, when ANNZARRO_WP6A_SHOTS names a folder (nothing is asserted beyond the pop-overs opening)."""
    folder = os.environ.get("ANNZARRO_WP6A_SHOTS")
    if not folder:
        pytest.skip("set ANNZARRO_WP6A_SHOTS to take the screenshots")
    shot = lambda name: page.screenshot(path=os.path.join(folder, f"{name}.png"))  # noqa: E731
    _open(page, served, {CC: _count(mode="hist2d", x=obs("depth"), y=obs("score"))})
    _drawn(page, "hist2d")
    page.locator(f"{S} .ccnt-controls").screenshot(path=os.path.join(folder, "toolbar.png"))
    for name, button, popover in [("binning", ".ccnt-bins", "binning"), ("color", ".ccnt-color-btn", "color")]:
        page.click(f"{S} {button}")
        page.wait_for_selector(f"[data-popover='{popover}']")
        shot(name)
        page.keyboard.press("Escape")
    _open(page, served, {CC: _count(mode="bar", x=cc.CELL_TYPE, split=cc.CONDITION)})
    _drawn(page, "bar")
    page.click(f"{S} .ccnt-choose")
    page.wait_for_selector("[data-popover='levels']")
    shot("levels")
