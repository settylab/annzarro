"""C copies the hover label: in a regular 2D plot, a 3D plot and a large plot.

A headless Chromium with clipboard permission hovers a point, presses C and reads
the clipboard back: the name, x, y, the colour and the Hover column, one per line.
C typed in an input and Cmd+C leave the clipboard alone, and with no label showing
C does nothing (T toggles the panel's controls).

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI).
"""
import base64
import collections
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


Served = collections.namedtuple("Served", "root kind")


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module", params=[10**9, 100], ids=["regular", "large"])
def server(tmp_path_factory, request):
    home = tmp_path_factory.mktemp("home")
    cfg = home / "large.yaml"
    cfg.write_text("ui:\n  defaults:\n    large_plot_points: %d\n" % request.param)
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
            time.sleep(min(0.5, 0.1 * (_ + 1)))
    else:
        proc.kill()
        pytest.fail("server did not start")
    yield Served(root, "regular" if request.param > 1000 else "large")
    proc.terminate()
    proc.wait(10)



def _link(served, z=False):
    root = served.root
    x = {"type": "obsm", "key": "X_umap", "column": "0"}
    y = {"type": "obsm", "key": "X_umap", "column": "1"}
    plot = {"x": x, "y": y, "z": {"type": "obsm", "key": "X_umap", "column": "2"} if z else None,
            "pointSize": 12, "pointOpacity": 1}
    extra = {"hoverInfo": [{"type": "obs", "key": "cell_type"}]} if served.kind == "regular" else {}
    cfg = {"id": "cell-plot-L", "title": "L", **plot, "color": {"type": "obs", "key": "total_counts", "column": ""}, **extra}
    view = {"v": 1, "subset": None,
            "layout": {"v": 1, "hierarchy": [{"type": "tile", "id": "cell-plot-L", "controlsVisible": True}],
                       "controlState": {"cell-plot-L": True}, "panelConfigs": {"cell-plot-L": cfg}}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={enc}"


@pytest.fixture
def page(server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            ctx = browser.new_context(viewport={"width": 1300, "height": 800}, permissions=["clipboard-read", "clipboard-write"])
            page = ctx.new_page()
            page.errors = []
            page.on("pageerror", lambda e: page.errors.append(str(e)))
            yield page
            assert not page.errors, page.errors
        finally:
            browser.close()


GRAPH = ".tile[data-tile-id='cell-plot-L'] .js-plotly-plot"

SHOWING = """() => { const g = document.querySelector("%s");
  if (g.__largeState) { const t = document.querySelector('.large-plot-tip');
    return !!(g.__largeState.index && t && t.style.display !== 'none' && /^cell_\\d+$/.test(t.firstChild.textContent)
      && t.children.length >= 3); }
  const sc = g._fullLayout && g._fullLayout.scene && g._fullLayout.scene._scene;
  return !!((g._hoverdata && g._hoverdata.length) || (sc && sc.lastPickResult)); }""" % GRAPH


def _ready(page):
    page.wait_for_function("""g => { const e = document.querySelector(g);
      return !!(e && e._fullLayout && (e.__largeState ? e.__largeState.index : e.data && e.data.length)); }""",
                           arg=GRAPH, timeout=60000)


LARGE_POINT = """g => { const e = document.querySelector(g), idx = e.__largeState.index;
  const xa = e._fullLayout.xaxis, ya = e._fullLayout.yaxis, r = e.querySelector('.nsewdrag').getBoundingClientRect();
  const i = Math.floor(idx.X.length / 2);
  return [r.left + xa.l2p(idx.X[i]), r.top + ya.l2p(idx.Y[i])]; }"""


def _hover_a_point(page):
    """Put the pointer on a point and wait for its label; the pointer stays there."""
    if page.evaluate("g => !!document.querySelector(g).__largeState", GRAPH):
        x, y = page.evaluate(LARGE_POINT, GRAPH)
        page.mouse.move(x - 40, y - 40)
        page.mouse.move(x + 1, y + 1, steps=4)
        page.wait_for_function(SHOWING, timeout=15000)
        return
    box = page.evaluate("""g => { const r = (document.querySelector(g + ' .nsewdrag') || document.querySelector(g)).getBoundingClientRect();
                           return [r.left, r.top, r.width, r.height]; }""", GRAPH)
    for i in range(1, 24):
        for j in range(1, 24):
            page.mouse.move(box[0] + box[2] * i / 24, box[1] + box[3] * j / 24)
            page.wait_for_timeout(8)
            if page.evaluate(SHOWING):
                return
    page.wait_for_function(SHOWING, timeout=3000)


def _clipboard(page):
    return page.evaluate("navigator.clipboard.readText()")


def _arm(page):
    """A sentinel on the clipboard, and a record of whether a key was default-prevented."""
    page.evaluate("navigator.clipboard.writeText('sentinel')")
    page.evaluate("""() => { window.__prevented = []; window.addEventListener('keydown', (e) => {
        window.__prevented.push([e.key, e.defaultPrevented]); }); }""")


def test_c_copies_hover(page, server):
    kind = server.kind
    page.goto(_link(server))
    _ready(page)
    _hover_a_point(page)
    page.keyboard.press("c")
    page.wait_for_function("() => document.querySelector('.notification') && /Copied hover info/.test(document.querySelector('.notification').textContent)")
    if os.environ.get("HOVER_COPY_SHOT") and kind == "regular":
        page.wait_for_timeout(400)      # the toast fades in
        page.screenshot(path=os.environ["HOVER_COPY_SHOT"])
    lines = _clipboard(page).split("\n")
    assert lines[0].startswith("cell_"), lines
    assert any(l.startswith("x: ") for l in lines) and any(l.startswith("y: ") for l in lines), lines
    assert any("total_counts" in l or l.startswith("c:") for l in lines), lines
    if kind == "regular":
        assert any(l.startswith("cell_type: ") for l in lines), lines    # the Hover picker's column


def test_typing_and_chords_leave_the_clipboard(page, server):
    page.goto(_link(server))
    _ready(page)
    _arm(page)
    _hover_a_point(page)
    # Cmd+C and Ctrl+C: the key is not ours
    for chord in ("Meta+c", "Control+c", "Alt+c"):
        page.keyboard.press(chord)
    assert _clipboard(page) == "sentinel"
    assert all(not prevented for key, prevented in page.evaluate("window.__prevented") if key.lower() == "c")
    assert page.locator(".notification").count() == 0
    # C typed into a field, with the pointer still on the point
    page.focus("#focused-cell")
    page.keyboard.press("c")
    assert _clipboard(page) == "sentinel"
    assert page.input_value("#focused-cell") == "c"
    assert page.locator(".notification").count() == 0


def test_c_without_a_label_does_nothing_and_t_toggles(page, server):
    page.goto(_link(server))
    _ready(page)
    page.evaluate("""() => { window.__toggled = 0;
        document.querySelector(".tile[data-tile-id='cell-plot-L'] .tile-toggle-controls").addEventListener('click', () => window.__toggled++); }""")
    # with a label showing, C copies and does not toggle
    _hover_a_point(page)
    page.keyboard.press("c")
    page.wait_for_function("() => /Copied hover info/.test((document.querySelector('.notification') || {}).textContent || '')")
    assert page.evaluate("window.__toggled") == 0
    # with none, it does nothing, and T toggles the controls
    page.mouse.move(2, 2)
    page.wait_for_function(
        "() => { const t = document.querySelector('.large-plot-tip'); return !t || t.style.display === 'none'; }")
    _arm(page)
    page.keyboard.press("c")
    page.wait_for_timeout(300)
    assert page.evaluate("window.__toggled") == 0
    assert _clipboard(page) == "sentinel"
    page.keyboard.press("t")
    page.wait_for_function("() => window.__toggled === 1")
    assert _clipboard(page) == "sentinel"


def test_c_in_3d(page, server):
    if server.kind == "large":
        pytest.skip("3D is not drawn in large-plot mode")
    page.goto(_link(server, z=True))
    _ready(page)
    # WebGL picking is not reliable in headless Chromium: the plotly_hover a scene emits for a
    # point is emitted here, as test_keep_3d_camera.py does for its click, with the pointer on the plot
    box = page.evaluate("g => { const r = document.querySelector(g).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }", GRAPH)
    page.mouse.move(*box)
    page.evaluate("""g => { const e = document.querySelector(g);
        const n = e.data.findIndex(t => t.type === 'scatter3d' && t.name !== 'Focused Cell' && t.text);
        e.emit('plotly_hover', {points: [{curveNumber: n, pointNumber: 3, x: e.data[n].x[3], y: e.data[n].y[3], z: e.data[n].z[3]}]}); }""", GRAPH)
    page.keyboard.press("c")
    page.wait_for_function("() => /Copied hover info/.test((document.querySelector('.notification') || {}).textContent || '')")
    lines = _clipboard(page).split("\n")
    assert lines[0].startswith("cell_") and any(l.startswith("z: ") for l in lines), lines
    assert any("total_counts" in l or l.startswith("c:") for l in lines), lines
    # the label goes (plotly_unhover): C copies nothing
    page.evaluate("g => document.querySelector(g).emit('plotly_unhover', {})", GRAPH)
    page.evaluate("navigator.clipboard.writeText('sentinel')")
    page.keyboard.press("c")
    page.wait_for_timeout(300)
    assert _clipboard(page) == "sentinel"


def test_clipboard_refused_says_so(server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1300, "height": 800})     # no permission granted
            page.add_init_script("Object.defineProperty(navigator, 'clipboard', {value: {writeText: () => Promise.reject(new Error('denied'))}})")
            page.goto(_link(server))
            _ready(page)
            _hover_a_point(page)
            page.keyboard.press("c")
            page.wait_for_function("() => /Not copied/.test((document.querySelector('.notification') || {}).textContent || '')")
        finally:
            browser.close()
