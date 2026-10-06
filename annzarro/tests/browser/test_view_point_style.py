"""Automatic point size and opacity follow the points in view (issue #85).

At 95.6M cells the automatic 0.78 px at opacity 0.16 left a zoomed view almost
blank: the values followed every point drawn, not the few on screen. In a
zoomed or panned 2D view they now follow the points inside it; back at the
full view (autorange), every point drawn.

The 200-cell fixture is too small for the curve to move, so the panel's point
count is set to 5M first: at the full view the values are those for 5M
points, zoomed in those for the points in view. A value the user set stays as
set. Regular plots and large-plot mode, numeric and categorical colour.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import base64
import json
import os
import socket
import subprocess
import sys
import time
import urllib.parse
import urllib.request

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402  (required: fail, do not skip)
else:
    playwright = pytest.importorskip("playwright.sync_api")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
DATA_DIR = os.path.join(os.path.dirname(HERE), "data")
STORE = os.path.join(DATA_DIR, "fixture_small.zarr")
PID = "cell-plot-P"


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module", params=[5_000_000, 10], ids=["regular", "large-plot"])
def server(request, tmp_path_factory):
    home = tmp_path_factory.mktemp("home")
    cfg = home / "large.yaml"
    cfg.write_text(f"ui:\n  defaults:\n    large_plot_points: {request.param}\n")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    # this checkout's package, not whatever "annzarro" is installed
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--config", str(cfg), "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", DATA_DIR, "--no-browser", "--auth-disabled"],
                            env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
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
    yield root, request.param < 50
    proc.terminate()
    proc.wait(10)


def _link(root, colour, **extra):
    plot = {"id": PID,
            "x": {"type": "obsm", "key": "X_umap", "column": "0"},
            "y": {"type": "obsm", "key": "X_umap", "column": "1"},
            "z": None, "color": colour, **extra}
    view = {"v": 1, "subset": None,
            "layout": {"v": 1, "hierarchy": [{"type": "tile", "id": PID, "controlsVisible": True}],
                       "controlState": {PID: True}, "panelConfigs": {PID: plot}}}
    payload = base64.urlsafe_b64encode(json.dumps(view, separators=(",", ":")).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={payload}"


NUMERIC = {"type": "obs", "key": "total_counts", "column": ""}

GRAPH = f"document.querySelector('.tile[data-tile-id=\"{PID}\"] .js-plotly-plot')"

STATE = """() => {
  const g = %s;
  const busy = [...document.querySelectorAll('.loading-overlay, .spinner-border')]
      .filter(e => e.offsetParent !== null).length;
  if (!g || !g._fullData || !g._fullLayout) return {drawn: false, busy};
  const sc = g._fullLayout._plots && g._fullLayout._plots.xy && g._fullLayout._plots.xy._scene;
  const points = (t) => t.meta !== 'az-legend' && t.meta !== 'az-colorbar' && !/^focused/i.test(t.name || '');
  return {
    drawn: !!sc && g._fullData.reduce((s, t) => s + ((t.x && t.x.length > 1) ? t.x.length : 0), 0) >= 150,
    busy,
    size: document.getElementById('point-size-input-%s').value,
    opacity: document.getElementById('point-opacity-input-%s').value,
    // the point traces: not legend entries, the colour bar's point or the focus highlight
    sceneSizes: sc ? sc.markerOptions.map((o, i) => (points(g.data[i]) && o ? o.size : null)).filter(v => v !== null) : [],
    sceneOpacities: sc ? sc.markerOptions.map((o, i) => (points(g.data[i]) && o ? o.opacity : null)).filter(v => v !== null) : []
  };
}""" % (GRAPH, PID, PID)


def _wait(page, pred, timeout=60):
    end = time.time() + timeout
    s = None
    while time.time() < end:
        s = page.evaluate(STATE)
        if s.get("drawn") and not s.get("busy") and pred(s):
            return s
        time.sleep(0.2)
    pytest.fail(f"timed out; last state {s}")


@pytest.fixture
def page(server):
    with playwright.sync_playwright() as pw:
        browser = pw.chromium.launch()
        try:
            pg = browser.new_page(viewport={"width": 1300, "height": 900})
            errors = []
            pg.on("pageerror", lambda e: errors.append(str(e)))
            yield pg
            assert not errors, errors
        finally:
            browser.close()


def _auto(page, n):
    return page.evaluate("""async (n) => (await import('/static/js/utils/point-style.js'))
        .autoPointStyle(n, (await import('/static/js/panels/plot-utilities/plot-make.js')).pointStyleBase())""", n)


ZOOM = """async (frac) => {
  const g = %s;
  const xs = g._fullLayout.xaxis.range, ys = g._fullLayout.yaxis.range;
  const cx = (xs[0] + xs[1]) / 2, cy = (ys[0] + ys[1]) / 2, hx = (xs[1] - xs[0]) * frac / 2, hy = (ys[1] - ys[0]) * frac / 2;
  await Plotly.relayout(g, {'xaxis.range': [cx - hx, cx + hx], 'yaxis.range': [cy - hy, cy + hy]});
  let n = 0;
  for (const t of g.data) {
    if (t.meta === 'az-legend' || t.meta === 'az-colorbar' || t.visible === 'legendonly' || !t.x) continue;
    for (let i = 0; i < t.x.length; i++) {
      if (t.x[i] >= cx - hx && t.x[i] <= cx + hx && t.y[i] >= cy - hy && t.y[i] <= cy + hy) n++;
    }
  }
  return n;
}""" % GRAPH


@pytest.mark.parametrize("colour", [NUMERIC, {"type": "obs", "key": "cell_type", "column": ""}], ids=["numeric", "category"])
def test_automatic_style_follows_the_view(server, page, colour):
    root, large = server
    page.goto(_link(root, colour))
    _wait(page, lambda s: True)
    page.evaluate(f"() => {{ {GRAPH}._pointCount = 5000000; }}")
    page.evaluate(f"async () => Plotly.relayout({GRAPH}, {{'xaxis.autorange': true, 'yaxis.autorange': true}})")
    full = _auto(page, 5_000_000)
    s = _wait(page, lambda s: float(s["size"]) == full["size"] and float(s["opacity"]) == full["opacity"])
    assert all(abs(v - full["size"]) < 1e-9 for v in s["sceneSizes"]), s

    inside = page.evaluate(ZOOM, 0.3)
    assert 0 < inside < 150, inside
    near = _auto(page, inside)
    assert near["size"] > full["size"] and near["opacity"] > full["opacity"]
    s = _wait(page, lambda s: float(s["size"]) == near["size"] and float(s["opacity"]) == near["opacity"])
    assert all(abs(v - near["size"]) < 1e-9 for v in s["sceneSizes"]), s
    assert all(abs(v - near["opacity"]) < 1e-9 for v in s["sceneOpacities"]), s

    # a size the user sets stays; the opacity is still automatic
    box = page.locator(f"#point-size-input-{PID}")
    box.fill("3")
    box.dispatch_event("change")
    _wait(page, lambda s: s["size"] in ("3", "3.14"))
    set_size = page.evaluate(STATE)["size"]
    page.evaluate(f"async () => Plotly.relayout({GRAPH}, {{'xaxis.autorange': true, 'yaxis.autorange': true}})")
    s = _wait(page, lambda s: float(s["opacity"]) == full["opacity"])
    time.sleep(0.5)
    s = page.evaluate(STATE)
    assert s["size"] == set_size, s
