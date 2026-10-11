"""A Cell Plot that leaves large-plot mode through a subset, and comes back.

The committed 200-cell fixture is served with ``ui.defaults.large_plot_points``
lowered to 100: all 200 cells draw large, a subset of 50 draws a regular plot.

1. Leaving large-plot mode takes its interaction with it. After the subset
   there is one hover (Plotly's own): no large-plot listener is left on the
   graph, the tooltip stays hidden, the cursor is not the hand, and the point
   index is gone. Going back to all cells puts the large-plot hover back, and
   only that one (not Plotly's beside it).
2. The large plot a subset replaces is freed, not kept. After large, subset,
   all cells again, the browser still gives the buffers for all cells, so the
   all-cells choice is accepted and draws, and the guard's estimate for all
   cells is what it was before. The browser's budget is simulated by the
   probe's allocator hook: it counts the bytes of its buffers that are still
   alive after a garbage collection and refuses beyond one large draw's peak.
   (At 95.6M points a plot cut to 100k held 3.8 GB of ArrayBuffers, 3.1 GB of
   them the large plot's WebGL scene, which a react into the drawn graph
   keeps; the guard then refused "95,624,334 cells: this browser cannot hold
   95,624,334 points. Pick a smaller size.")

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


def _link(root):
    plot = {"id": "cell-plot-a", "title": "A", "pointSize": 12, "pointOpacity": 1,
            "x": {"type": "obsm", "key": "X_umap", "column": "0"},
            "y": {"type": "obsm", "key": "X_umap", "column": "1"},
            "color": {"type": "obs", "key": "total_counts", "column": ""}}
    hierarchy = [{"type": "tile", "id": "cell-plot-a", "controlsVisible": True}]
    view = {"v": 1, "subset": None,
            "layout": {"v": 1, "hierarchy": hierarchy, "controlState": {"cell-plot-a": True},
                       "panelConfigs": {"cell-plot-a": plot}}}
    enc = base64.urlsafe_b64encode(json.dumps(view, separators=(",", ":")).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={enc}"


# Count the live listeners that belong to the large-plot interaction (their
# source mentions the large-plot state or Plotly's drag layer), and, for the budget test, hold the
# probe's buffers by weak reference.
INIT = """() => {
    const live = new Map();
    const mine = (fn) => typeof fn === 'function' && (fn.toString().includes('__largeState') || fn.toString().includes('.draglayer, .nsewdrag'));
    const add = EventTarget.prototype.addEventListener, del = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (type, fn, opts) {
        if (mine(fn)) live.set(fn, (live.get(fn) || 0) + 1);
        return add.call(this, type, fn, opts);
    };
    EventTarget.prototype.removeEventListener = function (type, fn, opts) {
        if (mine(fn) && live.has(fn)) live.delete(fn);
        return del.call(this, type, fn, opts);
    };
    window.__largeListeners = () => live.size;
    const T = {u8: Uint8Array, u16: Uint16Array, u32: Uint32Array, f32: Float32Array, f64: Float64Array};
    const held = [];
    window.__budget = Infinity;
    window.__peak = 0;
    window.__annzarroAllocator = (type, length) => {
        gc();
        const alive = held.map(r => r.deref()).filter(Boolean).reduce((s, a) => s + a.buffer.byteLength, 0);
        const need = length * T[type].BYTES_PER_ELEMENT;
        window.__peak = Math.max(window.__peak, alive + need);
        if (alive + need > window.__budget) throw new RangeError('Array buffer allocation failed');
        const a = new T[type](length);
        held.push(new WeakRef(a));
        return a;
    };
    window.__aliveBytes = () => { gc(); return held.map(r => r.deref()).filter(Boolean).reduce((s, a) => s + a.buffer.byteLength, 0); };
}"""


@pytest.fixture
def page(server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch(args=["--js-flags=--expose-gc"])
        try:
            page = browser.new_page(viewport={"width": 1400, "height": 900})
            page.errors = []
            page.on("pageerror", lambda e: page.errors.append(str(e)))
            page.add_init_script(f"({INIT})()")
            yield page
            assert not page.errors, page.errors
        finally:
            browser.close()


LARGE_READY = """() => { const g = document.querySelector('%s');
  return !!(g && g.__isLarge && g._fullLayout && g.__largeState && g.__largeState.index); }""" % GD
REGULAR_READY = """() => { const g = document.querySelector('%s');
  return !!(g && g._fullLayout && !g.__isLarge && g._pointCount === 50); }""" % GD


def _choose(page, preset):
    """Apply the subset dialog with the size chip `preset` ('all' or a number)."""
    page.click("#subset-button")
    page.wait_for_selector("#subset-presets button.subset-preset", state="visible")
    page.click("#subset-preset-all" if preset == "all" else f'#subset-presets button[data-n="{preset}"]')
    page.wait_for_function("() => !document.getElementById('subset-apply').disabled", timeout=15000)
    page.click("#subset-apply")
    page.wait_for_selector("#subset-modal", state="hidden")
    page.wait_for_selector(".modal-backdrop", state="detached")


# A point of the drawn plot with no other within 26 px: where a hover must find it
ISOLATED = """() => {
    const g = document.querySelector('%s');
    const xa = g._fullLayout.xaxis, ya = g._fullLayout.yaxis;
    const r = g.querySelector('.nsewdrag').getBoundingClientRect();
    const px = [];
    for (const t of g.data) for (let i = 0; i < t.x.length; i++) px.push([xa.l2p(t.x[i]), ya.l2p(t.y[i])]);
    for (let p = 0; p < px.length; p++) {
        if (px.every((q, k) => k === p || Math.hypot(q[0] - px[p][0], q[1] - px[p][1]) >= 26)) {
            return {x: r.left + px[p][0], y: r.top + px[p][1]};
        }
    }
    return null;
}""" % GD

HOVER_STATE = """() => {
    const area = document.querySelector('%s .nsewdrag');
    const tip = document.querySelector('.large-plot-tip');
    return {cursor: area.style.cursor,
            largeTip: !!tip && getComputedStyle(tip).display !== 'none',
            plotlyTips: document.querySelectorAll('%s .hoverlayer .hovertext').length};
}""" % (GD, GD)


def _hover(page):
    spot = page.evaluate(ISOLATED)
    assert spot, "no isolated point to hover"
    page.mouse.move(spot["x"] - 40, spot["y"] - 40)
    page.mouse.move(spot["x"], spot["y"], steps=6)
    page.wait_for_timeout(700)
    return page.evaluate(HOVER_STATE)


def test_leaving_large_mode_leaves_one_hover(page, server):
    page.goto(_link(server))
    page.wait_for_function(LARGE_READY, timeout=60000)
    assert page.evaluate("() => window.__largeListeners()") == 4

    _choose(page, 50)
    page.wait_for_function(REGULAR_READY, timeout=30000)
    state = page.evaluate("""() => { const g = document.querySelector('%s');
        return {state: !!g.__largeState, index: !!(g.__largeState && g.__largeState.index),
                listeners: window.__largeListeners()}; }""" % GD)
    assert state == {"state": False, "index": False, "listeners": 0}, state
    hover = _hover(page)
    assert hover["plotlyTips"] == 1, hover        # Plotly's own hover works
    assert not hover["largeTip"], hover           # and the large-plot tooltip is not beside it
    assert hover["cursor"] != "pointer" or hover["cursor"] == "", hover

    # and back: the large-plot hover only
    _choose(page, "all")
    page.wait_for_function(LARGE_READY, timeout=60000)
    assert page.evaluate("() => window.__largeListeners()") == 4
    hover = _hover(page)
    assert hover["largeTip"] and hover["cursor"] == "pointer", hover
    assert hover["plotlyTips"] == 0, hover


def test_all_cells_again_after_a_subset(page, server):
    page.goto(_link(server))
    page.wait_for_function(LARGE_READY, timeout=60000)
    estimate = """async () => {
        const g = await import('/static/js/utils/memory-guard-ui.js');
        return g.subsetCheck(200, 100).needBytes;
    }"""
    before = page.evaluate(estimate)
    # a browser that holds one large draw (its peak) and not a second beside it
    peak = page.evaluate("() => window.__peak")
    assert peak > 0
    page.evaluate("(peak) => { window.__budget = peak; }", peak)

    page.evaluate("""() => { const i = document.querySelector('%s').__largeState.index;
        window.__index = new WeakRef(i); window.__order = new WeakRef(i.order.buffer);
        // and the large plot's WebGL scene: Plotly keeps each trace's positions in the scene's marker options
        const gd = document.querySelector('%s');
        const scene = gd._fullLayout._plots.xy._scene;
        window.__scene = (scene.markerOptions || []).filter(o => o && o.positions).map(o => new WeakRef(o.positions.buffer));
        window.__sceneCount = window.__scene.length; }""" % (GD, GD))

    _choose(page, 50)
    page.wait_for_function(REGULAR_READY, timeout=30000)
    # what the large plot held is gone: the point index and nothing of its buffers is alive
    assert page.evaluate("() => { gc(); gc(); return [!!window.__index.deref(), !!window.__order.deref()]; }") == [False, False]
    assert page.evaluate("() => window.__sceneCount") > 0, "no scene buffers to follow"
    assert page.evaluate("() => { gc(); return window.__scene.filter(r => r.deref()).length; }") == 0, \
        "the regular plot still holds the large plot's WebGL buffers"
    alive = page.evaluate("() => window.__aliveBytes()")
    assert alive == 0, f"{alive} bytes of the released large plot's buffers are still held"

    page.click("#subset-button")
    page.wait_for_selector("#subset-presets button.subset-preset", state="visible")
    page.click("#subset-preset-all")
    page.wait_for_function("() => !document.getElementById('subset-apply').disabled", timeout=15000)
    page.click("#subset-apply")
    page.wait_for_selector("#subset-modal", state="hidden", timeout=15000)
    page.wait_for_selector(".modal-backdrop", state="detached")
    page.wait_for_function(LARGE_READY, timeout=60000)
    assert page.evaluate(estimate) == before
