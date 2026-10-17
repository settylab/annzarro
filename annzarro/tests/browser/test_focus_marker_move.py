"""The focused-cell marker of a 2D plot moves without a restyle, and is drawn where it is.

A restyle of the marker's x and y reran Plotly's calc and the WebGL scene of
every trace: 66 to 90 ms at 1M cells on a GPU, 400 ms in software GL, on
every focus change. The marker now moves in the regl scene (utils/gl-markers.js
setGlPoint). This checks what that must keep: the marker on screen at the new
cell and gone from the old one, after a zoom too, in an export
(Plotly.toImage, drawn from the graph's data), and a ring for a cell outside
the subset that moves to the next such cell. The calculated data is the same
object throughout (no calc).

The committed 200-cell fixture, clicked on points not drawn red themselves; the 50-cell store of test_focus_rows.py, subset to 12, for the ring.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI).
"""
import base64
import io
import json
import os
import urllib.parse

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")
from PIL import Image  # noqa: E402

from annzarro.tests.browser.test_click_focus_busy import ISOLATED, FOCUSED, _start  # noqa: E402
from annzarro.tests.browser.test_focus_outside_subset import _serve, _part_rows  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
STORE = os.path.join(os.path.dirname(HERE), "data", "fixture_small.zarr")
TILE = '.tile[data-tile-id="cell-plot-a"]'
GD = TILE + " .js-plotly-plot"


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    proc, root = _start(tmp_path_factory.mktemp("home"), "{}\n")
    yield root
    proc.terminate()
    proc.wait(10)


@pytest.fixture(scope="module")
def ring_server(tmp_path_factory):
    proc, root, store = _serve(tmp_path_factory)
    yield root, store
    proc.terminate()
    proc.wait(10)


def _link(root, store, subset=None, focused=None):
    plot = {"id": "cell-plot-a", "title": "A", "pointSize": 8, "pointOpacity": 1,
            "x": {"type": "obsm", "key": "X_umap", "column": "0"},
            "y": {"type": "obsm", "key": "X_umap", "column": "1"},
            "color": {"type": "obs", "key": "leiden", "column": ""}}
    view = {"v": 1, "subset": subset,
            "layout": {"v": 1, "hierarchy": [{"type": "tile", "id": "cell-plot-a", "controlsVisible": True}],
                       "controlState": {"cell-plot-a": True}, "panelConfigs": {"cell-plot-a": plot}}}
    if focused:
        view["constants"] = {"focusedCell": focused}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={enc}"


@pytest.fixture
def page():
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1200, "height": 850})
            page.errors = []
            page.on("pageerror", lambda e: page.errors.append(str(e)))
            yield page
            assert not page.errors, page.errors
        finally:
            browser.close()


MARKER = """(gd) => { const g = document.querySelector(gd);
  if (!g || !Array.isArray(g.data) || !g.calcdata) return null;
  const i = g.data.findIndex(t => t && t.name === 'Focused Cell');
  return i < 0 ? null : {i, x: g.data[i].x[0], y: g.data[i].y[0], ring: g.data[i].marker.symbol === 'circle-open',
    n: g.data.filter(t => t && t.name === 'Focused Cell').length, calc: g.calcdata.__mark || null}; }"""

# the marker's (and any value's) place on screen and in the plot area
WHERE = """([gd, x, y]) => { const g = document.querySelector(gd), fl = g._fullLayout;
  const r = g.querySelector('.nsewdrag').getBoundingClientRect();
  return {cx: r.left + fl.xaxis.l2p(x), cy: r.top + fl.yaxis.l2p(y), px: fl._size.l + fl.xaxis.l2p(x),
          py: fl._size.t + fl.yaxis.l2p(y), w: fl.width, h: fl.height}; }"""


# whether the drawn point at (x, y) is red itself
OWN_RED = """([gd, x, y]) => { const g = document.querySelector(gd);
  const t = g.data.find(t => t && t.name !== 'Focused Cell' && t.x && Array.from(t.x).some((v, i) => v === x && t.y[i] === y));
  const c = document.createElement('canvas').getContext('2d');
  c.fillStyle = (t && t.marker && typeof t.marker.color === 'string') ? t.marker.color : '#000';
  const f = c.fillStyle;
  const v = f[0] === '#' ? f.slice(1).match(/../g).map(h => parseInt(h, 16)) : f.match(/[0-9.]+/g).map(Number);
  return v[0] > 160 && v[1] < 120 && v[2] < 120; }"""


def _red(img, x, y, r=3):
    """Whether the marker's red is at (x, y) of `img` (a few pixels around)."""
    for dx in range(-r, r + 1):
        for dy in range(-r, r + 1):
            p = img.getpixel((int(x + dx), int(y + dy)))
            if p[0] > 200 and p[1] < 80 and p[2] < 80:
                return True
    return False


def _screen(page):
    return Image.open(io.BytesIO(page.screenshot())).convert("RGB")


def test_the_marker_moves_without_a_calc_and_is_drawn_there_after_a_zoom_and_in_an_export(page, server):
    page.goto(_link(server, STORE))
    page.wait_for_function(MARKER, arg=GD, timeout=60000)
    # not points drawn red themselves (the colour falls back to a category)
    pts = [p for p in page.evaluate(ISOLATED, GD) if not page.evaluate(OWN_RED, [GD, p["ux"], p["uy"]])]
    assert len(pts) >= 2, "too few isolated points that are not red; the fixture changed?"
    a, b = pts[0], pts[-1]
    page.mouse.click(a["x"], a["y"])
    page.wait_for_function(FOCUSED, arg=a["name"], timeout=10000)
    page.wait_for_function("([gd, x]) => { const g = document.querySelector(gd);"
                           " const t = g.data.find(t => t.name === 'Focused Cell'); return t && t.x[0] === x; }",
                           arg=[GD, a["ux"]], timeout=10000)
    page.evaluate("gd => { document.querySelector(gd).calcdata.__mark = 'same calc'; }", GD)

    page.mouse.click(b["x"], b["y"])
    page.wait_for_function(FOCUSED, arg=b["name"], timeout=10000)
    page.wait_for_function("([gd, x]) => document.querySelector(gd).data.find(t => t.name === 'Focused Cell').x[0] === x",
                           arg=[GD, b["ux"]], timeout=10000)
    m = page.evaluate(MARKER, GD)
    assert m["calc"] == "same calc", "the marker move ran Plotly's calc"
    assert m["n"] == 1 and (m["x"], m["y"]) == (b["ux"], b["uy"]), m
    page.mouse.move(5, 5)                          # no hover label over the points
    page.wait_for_timeout(300)
    img = _screen(page)
    assert _red(img, b["x"], b["y"]), "the marker is not drawn at the new cell"
    assert not _red(img, a["x"], a["y"]), "the marker is still drawn at the old cell"

    # a zoom draws the scene again from Plotly's state: the marker stays at the new cell
    page.evaluate("""([gd, x, y]) => { const g = document.querySelector(gd), xr = g._fullLayout.xaxis.range, yr = g._fullLayout.yaxis.range;
        const w = (xr[1] - xr[0]) / 3, h = (yr[1] - yr[0]) / 3;
        return Plotly.relayout(g, {'xaxis.range': [x - w, x + w], 'yaxis.range': [y - h, y + h]}); }""", [GD, b["ux"], b["uy"]])
    page.wait_for_timeout(300)
    assert page.evaluate(MARKER, GD)["calc"] == "same calc"
    at = page.evaluate(WHERE, [GD, b["ux"], b["uy"]])
    assert _red(_screen(page), at["cx"], at["cy"]), "after a zoom the marker is not at the new cell"

    # an export is drawn from the graph's data: the marker is at the new cell there too
    png = page.evaluate("""gd => { const g = document.querySelector(gd);
        return Plotly.toImage(g, {format: 'png', scale: 1, width: g._fullLayout.width, height: g._fullLayout.height}); }""", GD)
    img = Image.open(io.BytesIO(base64.b64decode(png.split(",", 1)[1]))).convert("RGB")
    assert img.size == (round(at["w"]), round(at["h"])), img.size
    assert _red(img, at["px"], at["py"]), "the exported image has no marker at the new cell"


def test_a_ring_for_a_cell_outside_the_subset_moves_to_the_next_one(page, ring_server):
    root, store = ring_server
    shown = set(_part_rows(root, store, 0))
    outside = [f"c{r}" for r in range(50) if r not in shown][:2]
    page.goto(_link(root, store, subset={"n": 12, "seed": 4}, focused=outside[0]))
    page.wait_for_function("gd => { const g = document.querySelector(gd);"
                           " return !!(g && g.data && g.data.some(t => t.name === 'Focused Cell' && t.marker.symbol === 'circle-open')); }",
                           arg=GD, timeout=60000)
    first = page.evaluate(MARKER, GD)
    page.evaluate("gd => { document.querySelector(gd).calcdata.__mark = 'same calc'; }", GD)
    page.evaluate("async (n) => (await import('/static/js/data-manager.js')).DataManager.setFocusedCell(n, false)", outside[1])
    page.wait_for_function("([gd, x]) => { const t = document.querySelector(gd).data.find(t => t.name === 'Focused Cell');"
                           " return t && t.x[0] !== x; }", arg=[GD, first["x"]], timeout=15000)
    m = page.evaluate(MARKER, GD)
    assert m["ring"] and m["n"] == 1 and m["calc"] == "same calc", m
    page.mouse.move(5, 5)
    page.wait_for_timeout(300)
    img = _screen(page)
    now = page.evaluate(WHERE, [GD, m["x"], m["y"]])
    was = page.evaluate(WHERE, [GD, first["x"], first["y"]])
    assert _red(img, now["cx"] + 0, now["cy"] + 0, r=12), "the ring is not drawn at the new cell"
    if abs(now["cx"] - was["cx"]) + abs(now["cy"] - was["cy"]) > 40:
        assert not _red(img, was["cx"], was["cy"], r=2), "the ring is still drawn at the old cell"
