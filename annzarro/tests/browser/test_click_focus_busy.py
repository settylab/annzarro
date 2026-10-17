"""A click on a point focuses its cell, also when the page is busy or the plot just changed.

At 1M cells (a regular plot, the most a subset draws before large-plot mode)
the first click after the draw, and any click during the 0.5 to 1.5 s a focus
change takes there, did nothing: the 2D click was committed only when
Plotly's plotly_click came within 50 ms of the release's event time, so a
release handled late (the main thread busy) was dropped without a word.
Right after a resize Plotly may report no click at all (its hover data was
cleared by the redraw). Large-plot mode dropped a click made while the point
index was still being built (seconds at 95.6M points).

The committed 200-cell fixture, served twice: as is (regular plots) and with
``ui.defaults.large_plot_points`` lowered to 100 (every plot is large). The
busy main thread is simulated by a busy loop that runs while the click is
dispatched; the index build in progress by the test hook
``window.__annzarroHoldIndex`` (a promise the build waits for).

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
TILE = '.tile[data-tile-id="cell-plot-a"]'
GD = TILE + " .js-plotly-plot"


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _start(home, config):
    cfg = home / "site.yaml"
    cfg.write_text(config)
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
            return proc, root
        except OSError:
            time.sleep(0.25)
    proc.kill()
    pytest.fail("server did not start")


@pytest.fixture(scope="module", params=["regular", "large"])
def server(request, tmp_path_factory):
    home = tmp_path_factory.mktemp(request.param)
    proc, root = _start(home, "ui:\n  defaults:\n    large_plot_points: 100\n" if request.param == "large" else "{}\n")
    yield request.param, root
    proc.terminate()
    proc.wait(10)


def _link(root, **extra):
    plot = {"id": "cell-plot-a", "title": "A", "pointSize": 12, "pointOpacity": 1, **extra,
            "x": {"type": "obsm", "key": "X_umap", "column": "0"},
            "y": {"type": "obsm", "key": "X_umap", "column": "1"},
            "color": {"type": "obs", "key": "cell_type", "column": ""}}
    hierarchy = [{"type": "tile", "id": "cell-plot-a", "controlsVisible": True}]
    view = {"v": 1, "subset": None,
            "layout": {"v": 1, "hierarchy": hierarchy, "controlState": {"cell-plot-a": True},
                       "panelConfigs": {"cell-plot-a": plot}}}
    enc = base64.urlsafe_b64encode(json.dumps(view, separators=(",", ":")).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={enc}"


@pytest.fixture
def page(server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1400, "height": 900})
            page.errors = []
            page.on("pageerror", lambda e: page.errors.append(str(e)))
            yield page
            assert not page.errors, page.errors
        finally:
            browser.close()


DRAWN = """(gd) => { const g = document.querySelector(gd);
  if (!g || !g._fullLayout || !g.data || !g.data.length) return false;
  return g.__largeState ? !!g.__largeState.index : g.data.some(t => t && t.customdata && t.customdata.length); }"""

# Drawn points with no other within 30 px, and where they are on screen: {name, x, y}
# (large plots name a point by its row; the fixture's cells are cell_0000, cell_0001, ...)
ISOLATED = """(gd) => {
  const g = document.querySelector(gd), xa = g._fullLayout.xaxis, ya = g._fullLayout.yaxis;
  const r = g.querySelector('.nsewdrag').getBoundingClientRect();
  const pts = [];
  const st = g.__largeState;
  if (st && st.index) {
    const idx = st.index;
    for (let p = 0; p < idx.X.length; p++) pts.push({name: 'cell_' + String(idx.rows[p]).padStart(4, '0'), ux: idx.X[p], uy: idx.Y[p]});
  } else {
    for (const t of g.data) {
      if (!t || !t.customdata || (t.name || '').includes('Focused')) continue;
      for (let i = 0; i < t.x.length; i++) pts.push({name: t.customdata[i], ux: t.x[i], uy: t.y[i]});
    }
  }
  for (const p of pts) { p.x = r.left + xa.l2p(p.ux); p.y = r.top + ya.l2p(p.uy); }
  return pts.filter(p => p.x > r.left + 20 && p.x < r.right - 20 && p.y > r.top + 20 && p.y < r.bottom - 20
    && pts.every(q => q === p || Math.hypot(q.x - p.x, q.y - p.y) >= 30));
}"""

FOCUSED = "n => document.getElementById('focused-cell').value === n"


def _open(page, root):
    page.goto(_link(root))
    page.wait_for_function(DRAWN, arg=GD, timeout=60000)
    pts = page.evaluate(ISOLATED, GD)
    assert len(pts) >= 4, f"only {len(pts)} isolated points; the fixture changed?"
    return pts


def _busy_click(page, x, y, ms=250):
    """Click at (x, y) while the main thread is busy for `ms`: the release is handled late."""
    page.mouse.move(x, y)
    page.evaluate("ms => setTimeout(() => { const t = performance.now(); while (performance.now() - t < ms); }, 0)", ms)
    page.mouse.click(x, y)


def test_a_click_while_the_page_is_busy_focuses(page, server):
    mode, root = server
    pts = _open(page, root)
    for p in pts[:3]:
        _busy_click(page, p["x"], p["y"])
        page.wait_for_function(FOCUSED, arg=p["name"], timeout=10000)


def test_a_click_right_after_the_draw_and_after_a_resize_focuses(page, server):
    mode, root = server
    page.goto(_link(root))
    page.wait_for_function(DRAWN, arg=GD, timeout=60000)
    # at once, without a hover over the point first
    p = page.evaluate(ISOLATED, GD)[0]
    page.mouse.click(p["x"], p["y"])
    page.wait_for_function(FOCUSED, arg=p["name"], timeout=10000)
    for size in ({"width": 1100, "height": 800}, {"width": 1500, "height": 950}):
        width = page.evaluate("gd => document.querySelector(gd)._fullLayout.width", GD)
        page.set_viewport_size(size)
        page.wait_for_function("([gd, w]) => document.querySelector(gd)._fullLayout.width !== w", arg=[GD, width],
                               timeout=10000)
        p = next(q for q in page.evaluate(ISOLATED, GD) if q["name"] != page.input_value("#focused-cell"))
        page.mouse.click(p["x"], p["y"])
        page.wait_for_function(FOCUSED, arg=p["name"], timeout=10000)


def test_a_click_with_hover_information_off_focuses(page, server):
    """Hover information off is the tooltip off: Plotly then reports no click, the plot's own pick does."""
    mode, root = server
    page.goto(_link(root, showHoverInfo=False))
    page.wait_for_function(DRAWN, arg=GD, timeout=60000)
    for p in page.evaluate(ISOLATED, GD)[:2]:
        page.mouse.click(p["x"], p["y"])
        page.wait_for_function(FOCUSED, arg=p["name"], timeout=10000)


def test_a_click_before_the_point_index_is_ready_is_applied_once_it_is(page, server):
    """Large-plot mode: the click says it is waiting, then focuses the point under it."""
    mode, root = server
    if mode != "large":
        pytest.skip("the point index is large-plot mode's")
    page.add_init_script("""window.__annzarroHoldIndex = new Promise(r => { window.__releaseIndex = r; });""")
    page.goto(_link(root))
    page.wait_for_function("""(gd) => { const g = document.querySelector(gd);
        return !!(g && g._fullLayout && g.__largeState && g.data && g.data.length); }""", arg=GD, timeout=60000)
    assert page.evaluate("gd => document.querySelector(gd).__largeState.index", GD) is None
    # where a point is: the drawn traces hold the positions before the index does. One with no
    # other within 30 px, not the focused cell's (the shape is at that one)
    p = page.evaluate("""(gd) => { const g = document.querySelector(gd), xa = g._fullLayout.xaxis, ya = g._fullLayout.yaxis;
        const r = g.querySelector('.nsewdrag').getBoundingClientRect();
        const s = (g.layout.shapes || [])[0];
        const pts = [];
        for (const t of g.data) if (t.x && t.x.length > 1) for (let i = 0; i < t.x.length; i++)
          pts.push({ux: t.x[i], x: r.left + xa.l2p(t.x[i]), y: r.top + ya.l2p(t.y[i]), mine: !!s && s.xanchor === t.x[i]});
        return pts.find(p => !p.mine && p.x > r.left + 20 && p.x < r.right - 20 && p.y > r.top + 20 && p.y < r.bottom - 20
          && pts.every(q => q === p || Math.hypot(q.x - p.x, q.y - p.y) >= 30)); }""", GD)
    assert p, "no isolated point; the fixture changed?"
    before = page.input_value("#focused-cell")
    page.mouse.click(p["x"], p["y"])
    page.wait_for_function("""(tile) => /Preparing click selection/.test(document.querySelector(tile).innerText)""",
                           arg=TILE, timeout=5000)
    assert page.evaluate("gd => document.querySelector(gd + ' .nsewdrag').style.cursor", GD) == "progress"
    page.wait_for_timeout(300)
    assert page.input_value("#focused-cell") == before
    page.evaluate("window.__releaseIndex()")
    page.wait_for_function("""([gd, x]) => { const s = (document.querySelector(gd).layout.shapes || [])[0];
        return s && Math.abs(s.xanchor - x) < 1e-4; }""", arg=[GD, p["ux"]], timeout=10000)
    assert page.input_value("#focused-cell") != before
    page.wait_for_function("""(tile) => !/Preparing click selection/.test(document.querySelector(tile).innerText)""",
                           arg=TILE, timeout=5000)
    assert page.evaluate("gd => document.querySelector(gd + ' .nsewdrag').style.cursor", GD) != "progress"
