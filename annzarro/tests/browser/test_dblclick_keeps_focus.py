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
    DRAWN, FOCUSED, GD, ISOLATED, TILE, _link, _open, page, server)

SETTLE_MS = 900   # the window (300 ms) and the focus change after it


def _focused(page):
    return page.input_value("#focused-cell")


def _press(page, at, hold=40):
    """A click as a hand makes it: gl3d picks while the button is held, so a zero-length one reports nothing."""
    page.mouse.move(*at)
    page.mouse.down()
    page.wait_for_timeout(hold)
    page.mouse.up()


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
    known = "cell_0000"
    page.evaluate("""async (n) => { (await import('/static/js/data-manager.js')).DataManager.setFocusedCell(n, false); }""", known)
    page.wait_for_function(FOCUSED, arg=known, timeout=10000)
    box = page.evaluate("gd => { const r = document.querySelector(gd + ' canvas').getBoundingClientRect(); "
                        "return {x: r.left, y: r.top, w: r.width, h: r.height}; }", GD)
    # gl3d reports a click only for a pick within a few px while the button is held: hover finds
    # the neighbourhood, a long press (not a click) then finds the spot where a press counts
    page.evaluate("""(gd) => { const g = document.querySelector(gd); window.__hovered = null; window.__pclicks = [];
        g.on('plotly_hover', (e) => { window.__hovered = true; });
        g.on('plotly_click', (e) => { window.__pclicks.push(e.points[0].customdata); }); }""", GD)
    spot = None
    for j in range(4, 17):
        for i in range(4, 17):
            gx, gy = box["x"] + box["w"] * i / 20, box["y"] + box["h"] * j / 20
            page.mouse.move(gx, gy)
            page.wait_for_timeout(40)
            if not page.evaluate("() => window.__hovered"):
                continue
            for dx in range(-8, 9, 2):
                for dy in range(-8, 9, 2):
                    page.mouse.move(gx + dx, gy + dy)
                    page.wait_for_timeout(40)
                    page.evaluate("() => { window.__pclicks = []; }")
                    page.mouse.down()
                    page.wait_for_timeout(30)
                    hit = page.evaluate("() => window.__pclicks[0]")
                    page.wait_for_timeout(350)   # held too long to count as a click
                    page.mouse.up()
                    page.wait_for_timeout(100)
                    if hit and hit != known:
                        spot, name = (gx + dx, gy + dy), hit
                        break
                if spot:
                    break
            if spot:
                break
        if spot:
            break
    assert spot, "no point found under the pointer in 3D"
    assert _focused(page) == known
    _press(page, spot)
    page.wait_for_timeout(60)
    _press(page, spot)
    page.wait_for_timeout(SETTLE_MS)
    assert _focused(page) == known
    # and a single click on that point focuses it
    _press(page, spot)
    page.wait_for_function(FOCUSED, arg=name, timeout=10000)


def test_a_double_click_before_the_point_index_is_ready_focuses_nothing(page, server):
    """Large-plot mode: the click waiting for the index is dropped by a second press."""
    mode, root = server
    if mode != "large":
        pytest.skip("the point index is large-plot mode's")
    page.add_init_script("""window.__annzarroHoldIndex = new Promise(r => { window.__releaseIndex = r; });""")
    page.goto(_link(root))
    page.wait_for_function("""(gd) => { const g = document.querySelector(gd);
        return !!(g && g._fullLayout && g.__largeState && g.data && g.data.length); }""", arg=GD, timeout=60000)
    box = page.evaluate("gd => { const r = document.querySelector(gd + ' .nsewdrag').getBoundingClientRect(); "
                        "return {x: r.left + r.width / 2, y: r.top + r.height / 2}; }", GD)
    before = _focused(page)
    page.mouse.dblclick(box["x"], box["y"])
    page.wait_for_timeout(SETTLE_MS)
    page.evaluate("window.__releaseIndex()")
    page.wait_for_function("gd => !!document.querySelector(gd).__largeState.index", arg=GD, timeout=10000)
    page.wait_for_timeout(SETTLE_MS)
    assert _focused(page) == before
    assert "Preparing click selection" not in page.inner_text(TILE)
