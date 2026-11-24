"""The Count Plot in 3D, in a real browser against the real cell_groups route (WP-11, UX 6b).

The store is the grouping fixture (tests/core/grouping_store.py): 1,200 cells, cell_type with 6 levels, condition, depth
and score (numbers).

1.  The 3D toggle draws one mesh3d in a gl3d scene, is one undoable step, and Undo returns to the 2D figure. It is
    shown pressed, with the strip saying what 3D leaves out; the Height row appears only in 3D.
2.  A Height of its own (a share) changes the bars' height, not the colour, with no new request.
3.  The camera the user turns to is stored without an undo step, survives a redraw and a reload of the link, and Reset
    camera clears it.
4.  Plot Options: a 3D section only in 3D, its footprint reaches the mesh; Export greys SVG with the reason, PNG stays.
5.  Over the bar cap (lowered for the test, `window.__azBars3dMax`) the 3D button is disabled with the reason, and a link
    stored in 3D is drawn in 2D with the strip saying why. A mode 3D has no bars for is disabled with its reason.
6.  A bar plot with a Color by and a heatmap are drawn in 3D too.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os
import re

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
_count, _open, _drawn, _config, _url = cc._count, cc._open, cc._drawn, cc._config, cc._url


def obs(key, **extra):
    return {"source": {"type": "obs", "key": key}, **extra}


CELL_TYPE, CONDITION, DEPTH, SCORE = obs("cell_type"), obs("condition"), obs("depth"), obs("score")
HIST2D = {"mode": "hist2d", "x": DEPTH, "y": SCORE}
PLOT = f"{S} .ccnt-plot"
BTN = f"{S} .ccnt-3d-btn"
TYPES = "(s) => [...document.querySelector(s).data].map(t => t.type)"
CAMERA = {"eye": {"x": 0.3, "y": -2, "z": 0.5}, "center": {"x": 0, "y": 0, "z": 0}, "up": {"x": 0, "y": 0, "z": 1}}


def _shot(page, name):
    folder = os.environ.get("ANNZARRO_SHOTS")
    if folder:
        os.makedirs(folder, exist_ok=True)
        page.evaluate("() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))))")
        page.locator(S).screenshot(path=os.path.join(folder, name))


def _undo_steps(page):
    return page.evaluate("(id) => window.PanelManager.getPanel(id)._debugState().undo", CC)


def _tag(page):
    return page.evaluate("(s) => { const t = document.querySelector(`${s} .ps-tag[data-tag=\"ccnt-3d\"]`);"
                         " return t ? {text: t.textContent, title: t.getAttribute('title') || ''} : null; }", S)


def _mesh_drawn(page):
    until(page, "(s) => { const g = document.querySelector(s); return !!g && !!g._fullLayout && !!g._fullLayout.scene"
                " && g.data[0].type === 'mesh3d'; }", PLOT, timeout=30)


def _flat_drawn(page):
    until(page, "(s) => { const g = document.querySelector(s); return !!g && !!g._fullLayout && !g._fullLayout.scene"
                " && g.data.length > 0 && g.data[0].type !== 'mesh3d'; }", PLOT, timeout=30)


def _eye(page):
    return page.evaluate("(s) => document.querySelector(s)._fullLayout.scene.camera.eye", PLOT)


def _tops(page):
    """The height of each bar (z of its 5th vertex) and its intensity, in the mesh's order."""
    return page.evaluate("""(s) => { const t = document.querySelector(s).data[0]; const out = [];
        for (let b = 0; b < t.x.length / 8; b++) out.push([t.z[b * 8 + 4], t.intensity[b * 8]]); return out; }""", PLOT)


def test_the_3d_toggle_draws_a_scene_one_undo_step_and_undo_returns_to_2d(page, served):
    _open(page, served, {CC: _count(**HIST2D)})
    _drawn(page, "hist2d")
    _flat_drawn(page)
    assert page.get_attribute(BTN, "aria-pressed") == "false"
    assert page.locator(f"{S} .ccnt-row--height3d").is_hidden(), "the Height row is shown only in 3D"
    assert _tag(page) is None
    steps = _undo_steps(page)
    calls = len(page.calls)
    page.click(BTN)
    _mesh_drawn(page)
    _drawn(page, "hist2d", "c.view === '3d'")
    assert page.get_attribute(BTN, "aria-pressed") == "true"
    assert _undo_steps(page) == steps + 1, "the toggle is one undoable step"
    assert len(page.calls) == calls, "a view reads nothing more"
    assert page.evaluate("(s) => document.querySelector(s)._fullLayout.scene.xaxis._name", PLOT) == "xaxis"
    tag = _tag(page)
    assert tag and tag["text"] == "3D" and "printed values" in tag["title"], tag
    assert page.locator(f"{S} .ccnt-row--height3d").is_visible()
    assert page.input_value(f"{S} .ccnt-height3d") == "__same__"
    tops = _tops(page)
    assert tops and all(h == v for h, v in tops), "Same as Color: the height is the colour value"
    _shot(page, "count-3d-hist2d.png")
    page.click(f"{S} .ccnt-undo")
    _flat_drawn(page)
    _drawn(page, "hist2d", "!c.view")
    assert _tag(page) is None
    assert page.get_attribute(BTN, "aria-pressed") == "false"


def test_a_height_of_its_own_changes_the_bars_and_not_the_colour(page, served):
    _open(page, served, {CC: _count(view="3d", **HIST2D)})
    _drawn(page, "hist2d", "c.view === '3d'")
    _mesh_drawn(page)
    before = _tops(page)
    calls = len(page.calls)
    page.select_option(f"{S} .ccnt-height3d", "share:total")
    _drawn(page, "hist2d", "c.height === 'share:total'")
    until(page, "(s) => { const t = document.querySelector(s).data[0]; return t.type === 'mesh3d' && t.hovertext[0].includes('Height'); }", PLOT, timeout=30)
    after = _tops(page)
    assert len(after) == len(before)
    assert abs(sum(h for h, _ in after) - 1) < 1e-3, "the shares of all rectangles add up to 1"
    assert [v for _, v in after] == [v for _, v in before], "the colour is unchanged"
    assert all(h < v for h, v in after if v > 1), "the height is a share, not the count"
    assert len(page.calls) == calls, "a share is computed from the counts held"


def test_the_camera_is_stored_without_an_undo_step_survives_a_redraw_and_reset_clears_it(page, served):
    _open(page, served, {CC: _count(view="3d", **HIST2D)})
    _drawn(page, "hist2d", "c.view === '3d'")
    _mesh_drawn(page)
    steps = _undo_steps(page)
    page.evaluate("([s, c]) => window.Plotly.relayout(document.querySelector(s), {'scene.camera': c})", [PLOT, CAMERA])
    until(page, "(id) => { const c = window.PanelManager.getPanel(id).getConfig().camera; return !!c && Math.abs(c.eye.x - 0.3) < 1e-6; }", CC)
    assert _undo_steps(page) == steps, "a turn is no undo step"
    # a redraw (another colour map) keeps the camera
    page.evaluate("(id) => { const p = window.PanelManager.getPanel(id); p.updateConfig({...p.getConfig(), color: {map: 'Reds'}}); }", CC)
    _drawn(page, "hist2d", "c.color && c.color.map === 'Reds'")
    _mesh_drawn(page)
    eye = _eye(page)
    assert abs(eye["x"] - 0.3) < 1e-3 and abs(eye["y"] + 2) < 1e-3, eye
    # the link reopens the same view
    cfg = _config(page)
    page.goto("about:blank")
    page.goto(_url(served, [CC], {CC: {**cfg, "id": CC}}))
    page.wait_for_selector(f"{S} .ccnt-panel[data-state]", timeout=30000)
    _drawn(page, "hist2d", "c.view === '3d'")
    _mesh_drawn(page)
    eye = _eye(page)
    assert abs(eye["x"] - 0.3) < 1e-3 and abs(eye["y"] + 2) < 1e-3, eye
    # Reset camera: the default view, and no camera stored
    page.click(f"{S} .modebar-btn[data-title='Reset camera']")
    until(page, "(id) => !('camera' in window.PanelManager.getPanel(id).getConfig())", CC)
    until(page, "(s) => Math.abs(document.querySelector(s)._fullLayout.scene.camera.eye.x - 1.6) < 1e-3", PLOT)


def test_plot_options_has_a_3d_section_and_svg_is_greyed_in_3d(page, served):
    _open(page, served, {CC: _count(**HIST2D)})
    _drawn(page, "hist2d")
    page.click(f"{S} .ccnt-options-btn")
    section = "[data-popover='plot-options'] .po-section[data-section='panel:view3d']"
    svg = "[data-popover='plot-options'] .po-export-btn[data-format='svg']"
    page.wait_for_selector(svg, state="visible")
    assert page.locator(section).is_hidden(), "the 3D section is shown only in 3D"
    assert page.is_enabled(svg), "2D exports SVG"
    page.keyboard.press("Escape")
    page.click(BTN)
    _mesh_drawn(page)
    page.click(f"{S} .ccnt-options-btn")
    page.wait_for_selector(svg, state="visible")
    assert page.is_disabled(svg)
    assert page.get_attribute(svg, "title") == "3D exports as an image only."
    for fmt in ("png", "jpeg", "webp"):
        assert page.is_enabled(f"[data-popover='plot-options'] .po-export-btn[data-format='{fmt}']"), fmt
    assert page.locator(section).is_visible()
    # the footprint reaches the mesh: the bar's side is 0.5 of its cell
    page.evaluate("""() => { const s = document.querySelector("[data-popover='plot-options'] .po-section[data-section='panel:view3d']");
        s.open = true; }""")
    box = "[data-popover='plot-options'] [data-option='footprint3dNumber']"
    page.fill(box, "0.5")
    page.press(box, "Enter")
    until(page, "(s) => { const t = document.querySelector(s).data[0]; return t.type === 'mesh3d' && Math.abs((t.x[1] - t.x[0]) - 0.5) < 1e-3; }", PLOT, timeout=30)


def test_over_the_cap_the_3d_button_is_disabled_and_a_stored_3d_is_drawn_in_2d(page, served):
    page.add_init_script("window.__azBars3dMax = 10;")
    _open(page, served, {CC: _count(**HIST2D)})
    _drawn(page, "hist2d")
    until(page, "(s) => document.querySelector(s).disabled", BTN)
    title = page.get_attribute(BTN, "title")
    assert re.fullmatch(r"3D draws at most 10 bars; this plot has [\d,]+\. Use fewer bins\.", title), title
    # a link stored in 3D over the cap: drawn in 2D, the strip says why
    page.goto("about:blank")
    page.goto(_url(served, [CC], {CC: _count(view="3d", **HIST2D)}))
    page.wait_for_selector(f"{S} .ccnt-panel[data-state]", timeout=30000)
    _drawn(page, "hist2d")
    until(page, "(s) => !!document.querySelector(s + ' .ps-tag[data-tag=\"ccnt-3d\"]')", S)
    _flat_drawn(page)
    tag = _tag(page)
    assert tag["text"] == "2D" and re.match(r"3D draws at most 10 bars", tag["title"]), tag
    assert page.is_enabled(BTN) and page.get_attribute(BTN, "aria-pressed") == "true", "a stored 3D can always be turned off"


def test_3d_is_disabled_with_its_reason_where_it_has_no_bars(page, served):
    _open(page, served, {CC: _count(mode="bar", x=CELL_TYPE)})
    _drawn(page, "bar")
    assert page.is_disabled(BTN)
    assert "Color by" in page.get_attribute(BTN, "title")
    page.select_option(f"{S} .ccnt-mode", "pie")
    _drawn(page, "pie")
    assert page.is_disabled(BTN)
    assert page.get_attribute(BTN, "title").startswith("3D is for")


def test_a_bar_plot_with_a_color_by_and_a_heatmap_draw_in_3d(page, served):
    _open(page, served, {CC: _count(mode="bar", x=CELL_TYPE, split=CONDITION)})
    _drawn(page, "bar")
    assert page.is_enabled(BTN)
    page.click(BTN)
    _mesh_drawn(page)
    n = page.evaluate("(s) => document.querySelector(s).data[0].x.length / 8", PLOT)
    assert n > 6, n
    page.evaluate("""([id, y]) => { const p = window.PanelManager.getPanel(id); p.updateConfig({...p.getConfig(), mode: 'heatmap', y}); }""", [CC, CONDITION])
    _drawn(page, "heatmap", "c.view === '3d'")
    _mesh_drawn(page)
    _shot(page, "count-3d-heatmap.png")
