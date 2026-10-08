"""Hover, click, the focus highlight and table filters in large-plot mode.

The committed 200-cell fixture is served with ``ui.defaults.large_plot_points``
lowered to 100, so every cell is "large". One headless Chromium session per
test, on two Cell Plots (the second follows the focus) and a Cell Table:

1. hover over a point: a tooltip with the right cell's name, position and
   colour value (read from the server for that row only);
2. click it: the cell is focused (header, the other plot), the highlight is a
   layout shape at that cell and moves to the next click, with no new draw
   (the plot's calculated data is the same object, one draw in the console);
3. a table filter and 3D are still refused (a cell table cannot list this many
   cells; its rows are what a filter would use).

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI).
"""
import base64
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.parse
import urllib.request

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.dirname(HERE), "data")
STORE = os.path.join(DATA_DIR, "fixture_small.zarr")
P1 = '.tile[data-tile-id="cell-plot-L"]'
P2 = '.tile[data-tile-id="cell-plot-M"]'
T = '.tile[data-tile-id="cell-table-L"]'


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    home = tmp_path_factory.mktemp("home")
    cfg = home / "large.yaml"
    cfg.write_text("ui:\n  defaults:\n    large_plot_points: 100\n")
    port = _free_port()
    exe = shutil.which("annzarro", path=os.path.dirname(sys.executable)) or shutil.which("annzarro")
    if not exe:
        (pytest.fail if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1" else pytest.skip)(
            "annzarro console script not found")
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1")
    proc = subprocess.Popen([exe, "start", "--config", str(cfg), "--host", "127.0.0.1", "--port", str(port),
                             "--data-dir", DATA_DIR, "--no-browser", "--auth-disabled"],
                            env=env, cwd=home, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    root = f"http://127.0.0.1:{port}"
    for _ in range(120):
        try:
            urllib.request.urlopen(root + "/api/v1/config", timeout=1)
            break
        except OSError:
            time.sleep(0.25)
    else:
        proc.kill()
        pytest.fail("server did not start")
    yield root
    proc.terminate()
    proc.wait(10)


def _link(root, remove=True, table_filter=False, z=False):
    x = {"type": "obsm", "key": "X_umap", "column": "0"}
    y = {"type": "obsm", "key": "X_umap", "column": "1"}
    plot = {"x": x, "y": y, "z": {"type": "obsm", "key": "X_umap", "column": "2"} if z else None,
            "pointSize": 12, "pointOpacity": 1}
    cfgs = {
        "cell-plot-L": {"id": "cell-plot-L", "title": "L", **plot,
                        "color": {"type": "obs", "key": "total_counts", "column": ""},
                        "tableFilter": "cell-table-L" if table_filter else "none", "removeNonTableEntries": remove},
        "cell-plot-M": {"id": "cell-plot-M", "title": "M", **plot,
                        "color": {"type": "obs", "key": "cell_type", "column": ""}},
        "cell-table-L": {"id": "cell-table-L", "title": "Table 1",
                         "columns": [{"type": "obs", "key": "cell_type", "column": ""}]}}
    tiles = [{"type": "tile", "id": i, "controlsVisible": True} for i in cfgs]
    view = {"v": 1, "subset": None,
            "layout": {"v": 1, "hierarchy": [{"type": "split", "direction": "horizontal",
                                              "panes": [{"percentage": 40}, {"percentage": 60}],
                                              "children": [tiles[0], {"type": "split", "direction": "horizontal",
                                                           "panes": [{"percentage": 50}, {"percentage": 50}],
                                                           "children": tiles[1:]}]}],
                       "controlState": {t["id"]: True for t in tiles}, "panelConfigs": cfgs}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={enc}"


@pytest.fixture
def page(server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1700, "height": 900})
            page.errors = []
            page.draws = []
            page.on("pageerror", lambda e: page.errors.append(str(e)))
            page.on("console", lambda m: page.draws.append(m.text) if m.text.startswith("Large cell plot") else None)
            yield page
            assert not page.errors, page.errors
        finally:
            browser.close()


def _wait(page, js, arg=None, timeout=60):
    page.wait_for_function(js, arg=arg, timeout=timeout * 1000)


READY = """(tile) => { const g = document.querySelector(tile + ' .js-plotly-plot');
  return !!(g && g.__largeState && g.__largeState.index && g._fullLayout); }"""

# A drawn point with no other within 26 px, and where to put the pointer for it
ISOLATED = """(tile) => {
  const g = document.querySelector(tile + ' .js-plotly-plot'), idx = g.__largeState.index;
  const xa = g._fullLayout.xaxis, ya = g._fullLayout.yaxis;
  const r = g.querySelector('.nsewdrag').getBoundingClientRect();
  const px = Array.from(idx.X, (v, i) => [xa.l2p(v), ya.l2p(idx.Y[i])]);
  const out = [];
  for (let p = 0; p < px.length; p++) {
    let ok = true;
    for (let q = 0; q < px.length && ok; q++) if (q !== p && Math.hypot(px[q][0] - px[p][0], px[q][1] - px[p][1]) < 26) ok = false;
    if (ok) out.push({p, row: idx.rows[p], x: r.left + px[p][0], y: r.top + px[p][1], ux: idx.X[p], uy: idx.Y[p]});
  }
  return out;
}"""

TIP = """() => { const t = document.querySelector('.large-plot-tip');
  return t && t.style.display !== 'none' ? Array.from(t.children).map(c => c.textContent) : null; }"""

SHAPES = """(tile) => { const g = document.querySelector(tile + ' .js-plotly-plot');
  return (g.layout.shapes || []).map(s => ({name: s.name, x: s.xanchor, y: s.yanchor})); }"""


def _isolated(page, tile, k=0):
    pts = page.evaluate(ISOLATED, tile)
    assert len(pts) >= 2, f"only {len(pts)} isolated points; the fixture changed?"
    return pts[0] if k == 0 else pts[-1]


def test_hover_click_highlight(page, server):
    page.goto(_link(server))
    _wait(page, READY, P1)
    _wait(page, READY, P2)
    assert page.evaluate("t => document.querySelector(t + ' .js-plotly-plot')._fullLayout.hovermode", P1) is False
    a, b = _isolated(page, P1, 0), _isolated(page, P1, 1)

    # 1. hover: the right cell's name, its position and its colour value
    page.mouse.move(a["x"] - 60, a["y"] - 60)
    page.mouse.move(a["x"] + 2, a["y"] + 1, steps=4)
    _wait(page, "() => { const t = document.querySelector('.large-plot-tip'); return t && t.style.display !== 'none' "
                "&& /^cell_\\d+$/.test(t.firstChild.textContent); }")
    tip = page.evaluate(TIP)
    assert tip[0] == f"cell_{a['row']:04d}", tip
    assert any(l.startswith("x: ") for l in tip) and any(l.startswith("y: ") for l in tip), tip
    assert any("total_counts" in l or l.startswith("c:") or "counts" in l for l in tip[3:]), tip
    # away from every point the tooltip goes
    page.mouse.move(a["x"] + 25, a["y"] + 25, steps=3)
    _wait(page, "() => { const t = document.querySelector('.large-plot-tip'); return !t || t.style.display === 'none'; }")

    # 2. click: focus, header, the other plot, the highlight shape
    mark = page.evaluate("""t => { const g = document.querySelector(t + ' .js-plotly-plot');
                            g.calcdata.__mark = 'same calc'; return g.calcdata.length; }""", P1)
    page.mouse.click(a["x"], a["y"])
    _wait(page, "n => document.getElementById('focused-cell').value === n", f"cell_{a['row']:04d}")
    _wait(page, "t => (document.querySelector(t + ' .js-plotly-plot').layout.shapes || []).length === 1", P1)
    _wait(page, "t => (document.querySelector(t + ' .js-plotly-plot').layout.shapes || []).length === 1", P2)
    for tile in (P1, P2):
        s = page.evaluate(SHAPES, tile)
        assert s[0]["name"] == "Focused Cell" and abs(s[0]["x"] - a["ux"]) < 1e-4 and abs(s[0]["y"] - a["uy"]) < 1e-4, s

    # the highlight moves with the next click, without drawing the traces again
    page.mouse.click(b["x"], b["y"])
    _wait(page, "n => document.getElementById('focused-cell').value === n", f"cell_{b['row']:04d}")
    page.wait_for_function("""([t, x]) => { const s = (document.querySelector(t + ' .js-plotly-plot').layout.shapes || [])[0];
                            return s && Math.abs(s.xanchor - x) < 1e-4; }""", arg=[P1, b["ux"]], timeout=15000)
    same = page.evaluate("t => document.querySelector(t + ' .js-plotly-plot').calcdata.__mark", P1)
    assert same == "same calc", "the traces were calculated again"
    assert len(page.draws) == 2, page.draws          # one large draw per plot, none for the focus
    assert page.evaluate(SHAPES, P1)[0]["name"] == "Focused Cell" and len(page.evaluate(SHAPES, P1)) == 1

    # a focus from elsewhere (a name typed in the header) moves it too; turning the toggle off removes it
    page.evaluate("""async (n) => { (await import('/static/js/data-manager.js')).DataManager.setFocusedCell(n, false); }""",
                  f"cell_{a['row']:04d}")
    page.wait_for_function("""([t, x]) => { const s = (document.querySelector(t + ' .js-plotly-plot').layout.shapes || [])[0];
                            return s && Math.abs(s.xanchor - x) < 1e-4; }""", arg=[P1, a["ux"]], timeout=15000)
    page.click(f'{P1} button[id^="highlight-focused-cell-"]')
    _wait(page, "t => (document.querySelector(t + ' .js-plotly-plot').layout.shapes || []).length === 0", P1)
    assert len(page.draws) == 2, page.draws


def test_drag_zoom_works_with_the_highlight_and_the_marker_keeps_its_cell(page, server):
    page.goto(_link(server))
    _wait(page, READY, P1)
    a = _isolated(page, P1, 0)
    page.mouse.click(a["x"], a["y"])
    _wait(page, "t => (document.querySelector(t + ' .js-plotly-plot').layout.shapes || []).length === 1", P1)
    box = page.evaluate("t => { const r = document.querySelector(t + ' .nsewdrag').getBoundingClientRect(); return {x: r.left, y: r.top, w: r.width, h: r.height}; }", P1)
    before = page.evaluate("t => document.querySelector(t + ' .js-plotly-plot')._fullLayout.xaxis.range.slice()", P1)
    page.mouse.move(box["x"] + box["w"] * 0.2, box["y"] + box["h"] * 0.2)
    page.mouse.down()
    page.mouse.move(box["x"] + box["w"] * 0.6, box["y"] + box["h"] * 0.6, steps=8)
    page.mouse.up()
    page.wait_for_function("""([t, b]) => { const r = document.querySelector(t + ' .js-plotly-plot')._fullLayout.xaxis.range;
        return (r[1] - r[0]) < (b[1] - b[0]) * 0.7 && r[0] >= b[0] - 1e-9 && r[1] <= b[1] + 1e-9; }""",
                           arg=[P1, before], timeout=15000)
    assert len(page.evaluate(SHAPES, P1)) == 1
    assert len(page.draws) == 2, "a zoom is not a redraw"


def test_a_drag_or_a_long_press_that_starts_on_a_point_does_not_focus(page, server):
    """The click rule of the regular plot (<= 300 ms and <= 5 px, decided on release)."""
    page.goto(_link(server))
    _wait(page, READY, P1)
    a = _isolated(page, P1, 0)
    before = page.input_value("#focused-cell")
    assert before != f"cell_{a['row']:04d}"
    page.mouse.move(a["x"], a["y"])
    page.mouse.down()
    page.wait_for_timeout(450)                                # a long, still press
    page.mouse.up()
    page.wait_for_timeout(600)
    assert page.input_value("#focused-cell") == before
    page.mouse.move(a["x"], a["y"])
    page.mouse.down()
    page.mouse.move(a["x"] + 60, a["y"] + 40, steps=8)       # a pan or zoom drag
    page.mouse.up()
    page.wait_for_timeout(800)
    assert page.input_value("#focused-cell") == before


def test_table_filter_is_still_refused(page, server):
    """A cell table cannot list this many cells (their names stay on the server), so a
    table filter has nothing to filter by: refused, as before."""
    page.goto(_link(server, table_filter=True))
    page.wait_for_function("""t => { const p = document.querySelector(t + ' .coverage-placeholder');
        return p && /A table filter is not available for 200 points/.test(p.textContent); }""", arg=P1, timeout=60000)
    page.wait_for_function("""t => /not available in large-plot mode/.test(document.querySelector(t).innerText)""",
                           arg=T, timeout=30000)


def test_3d_is_still_refused(page, server):
    page.goto(_link(server, z=True))
    page.wait_for_function("""t => { const p = document.querySelector(t + ' .coverage-placeholder');
        return p && /3D is not available for 200 points/.test(p.textContent); }""", arg=P1, timeout=60000)
