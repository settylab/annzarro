"""A double click (Plotly's zoom reset) does not change the focused cell.

Each press of a double click is a click, so the first used to focus the point
under the pointer. A click now focuses once Plotly's double-click window has
passed without a second press near it. Regular and large-plot mode (the
committed 200-cell fixture served twice, as in test_click_focus_busy.py), 2D
and 3D.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI).
"""
import pytest

from .test_click_focus_busy import (  # noqa: F401  (fixtures)
    DRAWN, FOCUSED, GD, ISOLATED, _link, _open, page, server)

SETTLE_MS = 900   # the window (300 ms) and the focus change after it


def _focused(page):
    return page.input_value("#focused-cell")


def test_a_single_click_focuses_after_the_window(page, server):
    mode, root = server
    p = _open(page, root)[0]
    page.mouse.click(p["x"], p["y"])
    page.wait_for_function(FOCUSED, arg=p["name"], timeout=10000)


def test_a_double_click_resets_the_view_and_keeps_the_focus(page, server):
    mode, root = server
    pts = _open(page, root)
    page.mouse.click(pts[0]["x"], pts[0]["y"])
    page.wait_for_function(FOCUSED, arg=pts[0]["name"], timeout=10000)
    # zoom in a little, so there is a view to reset
    page.evaluate("""async (gd) => { const g = document.querySelector(gd), xa = g._fullLayout.xaxis, ya = g._fullLayout.yaxis;
        const d = (r) => (r[1] - r[0]) * 0.05;
        await Plotly.relayout(g, {'xaxis.range': [xa.range[0] + d(xa.range), xa.range[1] - d(xa.range)],
                                  'yaxis.range': [ya.range[0] + d(ya.range), ya.range[1] - d(ya.range)]}); }""", GD)
    p = next(q for q in page.evaluate(ISOLATED, GD) if q["name"] != pts[0]["name"])
    page.mouse.dblclick(p["x"], p["y"])
    page.wait_for_function("gd => document.querySelector(gd)._fullLayout.xaxis.autorange === true", arg=GD, timeout=10000)
    page.wait_for_timeout(SETTLE_MS)
    assert _focused(page) == pts[0]["name"]
    # and the plot still focuses on a click
    q = next(q for q in page.evaluate(ISOLATED, GD) if q["name"] != pts[0]["name"])
    page.mouse.click(q["x"], q["y"])
    page.wait_for_function(FOCUSED, arg=q["name"], timeout=10000)


def test_a_double_click_in_3d_keeps_the_focus(page, server):
    mode, root = server
    if mode == "large":
        pytest.skip("3D plots are never large-plot mode")
    page.goto(_link(root, z={"type": "obs", "key": "total_counts", "column": ""}))
    page.wait_for_function(DRAWN, arg=GD, timeout=60000)
    page.wait_for_timeout(1500)
    # a point under the pointer: sweep the canvas until Plotly reports a hover
    page.evaluate("""(gd) => { const g = document.querySelector(gd); window.__hovered = null;
        g.on('plotly_hover', (e) => { window.__hovered = e.points[0].customdata; }); }""", GD)
    box = page.evaluate("gd => { const r = document.querySelector(gd + ' canvas').getBoundingClientRect(); "
                        "return {x: r.left, y: r.top, w: r.width, h: r.height}; }", GD)
    spot = None
    for j in range(4, 17):
        for i in range(4, 17):
            x, y = box["x"] + box["w"] * i / 20, box["y"] + box["h"] * j / 20
            page.mouse.move(x, y)
            page.wait_for_timeout(30)
            if page.evaluate("() => window.__hovered"):
                spot = (x, y)
                break
        if spot:
            break
    assert spot, "no point found under the pointer in 3D"
    name = page.evaluate("() => window.__hovered")
    # a known focus other than the point under the pointer
    known = "cell_0000" if name != "cell_0000" else "cell_0001"
    page.evaluate("""async (n) => { (await import('/static/js/data-manager.js')).DataManager.setFocusedCell(n, false); }""", known)
    page.wait_for_function(FOCUSED, arg=known, timeout=10000)
    page.evaluate("""(gd) => Plotly.relayout(document.querySelector(gd),
        {'scene.camera': {eye: {x: 0.3, y: 0.3, z: 2.4}, up: {x: 0, y: 0, z: 1}, center: {x: 0, y: 0, z: 0}}})""", GD)
    page.wait_for_timeout(500)
    page.mouse.move(*spot)
    page.mouse.dblclick(*spot)
    page.wait_for_timeout(SETTLE_MS)
    assert _focused(page) == known
