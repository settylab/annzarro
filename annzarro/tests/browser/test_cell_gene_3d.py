"""The Cell-Gene Plot in 3D, in a real browser against the real cell_groups route (WP-12, UX 6b).

The store is the grouping fixture (tests/core/grouping_store.py): cell_type with 6 levels, 40 genes, X signed,
``logged`` log-normalised and ``counts`` raw counts.

1.  The 3D toggle draws one mesh3d in a scene, shows Height and says in the strip what 3D leaves out; toggling back
    draws the 2D figure again. A Height on a new layer is one request for that layer's features.
2.  The camera turned by the user is stored without an undo step, survives a redraw and a reload of the link, and
    Reset camera clears it.
3.  Plot Options' Export greys SVG in 3D, with the reason; PNG stays.
4.  Over the bar cap (lowered for the test, `window.__azBars3dMax`) the 3D button is disabled with its reason, and a
    link stored in 3D is drawn in 2D with the strip saying why.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os
import re

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_cell_gene_panel import (  # noqa: E402,F401
    GENES, P, S1, TP, _config, _drawn, _features, _open, _plot, _sig, _state, _url, page, served)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

OBS = {"type": "obs", "key": "cell_type"}
PLOT = f"{TP} .cgene-plot"
TYPES = "(s) => [...document.querySelector(s).data].map(t => t.type)"


def _types(page):
    return page.evaluate(TYPES, PLOT)


def _tag(page, key):
    return page.evaluate("([s, k]) => { const t = document.querySelector(`${s} .ps-tag[data-tag=\"${k}\"]`);"
                         " return t ? {text: t.textContent, title: t.getAttribute('title') || ''} : null; }", [TP, key])


def _open3d(page, served, genes=4, **fields):
    _open(page, served, {P: _plot(cellAxis=OBS, sections=[{"source": S1}], **fields), S1: _sig(S1, "Markers", GENES[:genes])},
          open_ids=(P, S1))
    return _drawn(page)


def _reopen(page, served, configs):
    """A link opened afresh: a goto that changes only the hash would race the app's own reload."""
    page.goto("about:blank")
    page.goto(_url(served, [P, S1], configs))
    page.wait_for_selector(f"{TP} .cgene-panel[data-state]", timeout=30000)


def _mesh_drawn(page):
    until(page, "(s) => { const g = document.querySelector(s); return !!g && !!g._fullLayout && !!g._fullLayout.scene"
                " && g.data.length === 1 && g.data[0].type === 'mesh3d'; }", PLOT, timeout=30)


def test_the_3d_toggle_draws_a_scene_and_toggling_back_restores_the_2d_figure(page, served):
    st = _open3d(page, served)
    two_d = _types(page)
    assert "mesh3d" not in two_d and two_d, two_d
    assert page.locator(f"{TP} .cgene-field--height").is_hidden(), "Height is shown only in 3D"
    undo = st["undo"]
    calls = len(page.calls)
    page.click(f"{TP} .cgene-3d-btn")
    _mesh_drawn(page)
    assert page.get_attribute(f"{TP} .cgene-3d-btn", "aria-pressed") == "true"
    assert _config(page)["view"] == "3d"
    assert _state(page)["undo"] == undo + 1, "the toggle is one undoable step"
    assert len(page.calls) == calls, "Same as Color reads nothing more"
    tag = _tag(page, "cgene-3d")
    assert tag and tag["text"] == "3D" and "dendrograms, strips, section brackets, totals or printed values" in tag["title"], tag
    assert page.locator(f"{TP} .cgene-field--height").is_visible()
    assert page.input_value(f"{TP} .cgene-height") == "__same_as_color__"
    assert page.locator(f"{TP} .cgene-height-layer").is_hidden(), "Same as Color reads Color's layer"
    hover = page.evaluate("(s) => document.querySelector(s).data[0].hovertext[0]", PLOT)
    assert hover.split("<br>")[-1] == "Height: as Color", hover
    # a Height of its own on a new layer: one request, each gene once on that layer
    page.select_option(f"{TP} .cgene-height", "mean")
    until(page, "(id) => (window.PanelManager.getPanel(id).getConfig().height || {}).stat === 'mean'", P)
    assert _config(page)["height"] == {"stat": "mean", "layer": "logged"}, "an own height starts on Color's layer"
    assert len(page.calls) == calls, "on Color's layer it reads nothing more"
    # ... and the values held are read with the new plan: every bar drawn, each with its own height
    until(page, "(s) => { const g = document.querySelector(s); const t = g.data[0]; return t.type === 'mesh3d'"
                " && t.x.length > 0 && (t.hovertext[0] || '').includes('Height · Mean · logged'); }", PLOT, timeout=30)
    page.select_option(f"{TP} .cgene-height-layer", "counts")
    until(page, "(id) => (window.PanelManager.getPanel(id).getConfig().height || {}).layer === 'counts'", P)
    until(page, "(s) => { const g = document.querySelector(s); return g.data[0].type === 'mesh3d'"
                " && g.data[0].hovertext[0].includes('Height · Mean · counts'); }", PLOT, timeout=30)
    new = page.calls[calls:]
    counts = [f for f in _features(new) if f.get("layer") == "counts"]
    assert sorted(f["name"] for f in counts) == sorted(GENES[:4]), counts
    # back to 2D: the 2D figure again, the Height kept for the next 3D
    page.click(f"{TP} .cgene-3d-btn")
    until(page, "(s) => { const g = document.querySelector(s); return !g._fullLayout.scene && g.data.every(t => t.type !== 'mesh3d'); }", PLOT, timeout=30)
    assert _types(page) == two_d
    assert "view" not in _config(page)
    assert _config(page)["height"] == {"stat": "mean", "layer": "counts"}
    assert page.locator(f"{TP} .cgene-field--height").is_hidden()
    assert _tag(page, "cgene-3d") is None


CAMERA = {"eye": {"x": 0.3, "y": -2, "z": 0.5}, "center": {"x": 0, "y": 0, "z": 0}, "up": {"x": 0, "y": 0, "z": 1}}


def _eye(page):
    return page.evaluate("(s) => document.querySelector(s)._fullLayout.scene.camera.eye", PLOT)


def test_the_camera_is_stored_without_an_undo_step_survives_a_redraw_and_reset_clears_it(page, served):
    _open3d(page, served, view="3d")
    _mesh_drawn(page)
    undo = _state(page)["undo"]
    page.evaluate("([s, c]) => window.Plotly.relayout(document.querySelector(s), {'scene.camera': c})", [PLOT, CAMERA])
    until(page, "(id) => { const c = window.PanelManager.getPanel(id).getConfig().camera; return !!c && Math.abs(c.eye.x - 0.3) < 1e-6; }", P)
    assert _state(page)["undo"] == undo, "a turn is no undo step"
    # a redraw (another scaling) keeps the camera
    page.select_option(f"{TP} .cgene-scale", "var")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().scale === 'var'", P)
    _mesh_drawn(page)
    page.wait_for_function("(s) => { const g = document.querySelector(s); return g.data[0].hovertext[0].includes('scaled 0 to 1'); }", arg=PLOT)
    eye = _eye(page)
    assert abs(eye["x"] - 0.3) < 1e-3 and abs(eye["y"] + 2) < 1e-3, eye
    # the link reopens the same view
    cfg = _config(page)
    _reopen(page, served, {P: {**cfg, "id": P}, S1: _sig(S1, "Markers", GENES[:4])})
    _drawn(page)
    _mesh_drawn(page)
    eye = _eye(page)
    assert abs(eye["x"] - 0.3) < 1e-3, eye
    # Reset camera: the default view, and no camera stored
    page.click(f"{TP} .modebar-btn[data-title='Reset camera']")
    until(page, "(id) => !('camera' in window.PanelManager.getPanel(id).getConfig())", P)
    until(page, "(s) => Math.abs(document.querySelector(s)._fullLayout.scene.camera.eye.x - 1.6) < 1e-3", PLOT)


def test_svg_export_is_disabled_in_3d_with_the_reason(page, served):
    _open3d(page, served)
    page.click(f"{TP} .cgene-options-btn")
    svg = "[data-popover='plot-options'] .cgene-export-btn[data-format='svg']"
    png = "[data-popover='plot-options'] .cgene-export-btn[data-format='png']"
    page.wait_for_selector(svg, state="visible")
    assert page.is_enabled(svg) and page.is_enabled(png), "2D exports SVG"
    page.keyboard.press("Escape")
    page.click(f"{TP} .cgene-3d-btn")
    _mesh_drawn(page)
    page.click(f"{TP} .cgene-options-btn")
    page.wait_for_selector(svg, state="visible")
    assert page.is_disabled(svg)
    assert page.get_attribute(svg, "title") == "3D exports as an image only."
    for fmt in ("png", "jpeg", "webp"):
        assert page.is_enabled(f"[data-popover='plot-options'] .cgene-export-btn[data-format='{fmt}']"), fmt


def test_over_the_cap_the_3d_button_is_disabled_and_a_stored_3d_is_drawn_in_2d(page, served):
    page.add_init_script("window.__azBars3dMax = 10;")
    st = _open3d(page, served)
    bars = st["groups"] * st["rows"]
    assert bars > 10, bars
    until(page, "(s) => document.querySelector(s + ' .cgene-3d-btn').disabled", TP)
    title = page.get_attribute(f"{TP} .cgene-3d-btn", "title")
    assert title == f"3D draws at most 10 bars; this plot has {bars:,}. Use fewer genes or groups.", title
    # a link stored in 3D over the cap: drawn in 2D, the strip says why, and the button turns 3D off
    _reopen(page, served, {P: _plot(cellAxis=OBS, sections=[{"source": S1}], view="3d"), S1: _sig(S1, "Markers", GENES[:4])})
    _drawn(page)
    until(page, "(s) => { const t = document.querySelector(s + ' .ps-tag[data-tag=\"cgene-3d\"]'); return !!t; }", TP)
    assert "mesh3d" not in _types(page)
    tag = _tag(page, "cgene-3d")
    assert tag["text"] == "2D" and re.match(r"3D draws at most 10 bars", tag["title"]), tag
    assert page.is_enabled(f"{TP} .cgene-3d-btn")
    assert page.get_attribute(f"{TP} .cgene-3d-btn", "aria-pressed") == "true"
