"""Per-point colours drawn without Plotly's colour strings, and the opacity they are drawn at.

1. Colours (issue #82). A recolour at 1M points spent 0.78 s of its 1.13 s
   Plotly.react turning colour values into CSS strings and back. The
   scattergl calc is now wrapped (static/js/utils/scattergl-calc.js) and the
   scene gets colours computed outside Plotly. They must be Plotly's: the
   scene colours of a drawn panel are compared, point by point, with the
   ones Plotly makes for the same trace with the wrapper off.

2. Opacity. Plotly folds the marker opacity into its per-point colours and
   draws them at scene opacity 1, so an opacity set in the scene (the
   slider, gl-markers.js) came on top of the old one. The wrapped colours
   leave it to the scene: after the slider, the scene opacity is the new
   value and the colours carry none.

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
GENE = {"type": "layer", "key": "X", "column": "GENE003", "locked": False}

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


# Each per-point-coloured trace of the panel against the colours Plotly makes
# for the same trace with the wrapper off (on a detached graph).
COMPARE = """async () => {
  const G = await import('/static/js/utils/scattergl-calc.js');
  const g = %s;
  const sc = g._fullLayout._plots.xy._scene;
  const out = [];
  for (let i = 0; i < g._fullData.length; i++) {
    const t = g._fullData[i], o = sc.markerOptions[i];
    if (!t.marker || !Array.isArray(t.marker.color) && !ArrayBuffer.isView(t.marker.color)) continue;
    const m = t.marker;
    G._setGlColorsDisabled(true);
    const d = document.createElement('div');
    document.body.appendChild(d);
    let ref;
    try {
      await Plotly.newPlot(d, [{type: 'scattergl', mode: 'markers', x: Array.from(t.x), y: Array.from(t.y),
        marker: {color: Array.from(m.color), colorscale: m.colorscale, reversescale: m.reversescale,
                 cmin: m.cmin, cmax: m.cmax, opacity: m.opacity, size: 3}}]);
      ref = d._fullLayout._plots.xy._scene.markerOptions[0];
    } finally {
      G._setGlColorsDisabled(false);
    }
    let bad = 0, first = null;
    for (let k = 0; k < t._length; k++) {
      const p = ref.colors[k], q = o.colors && o.colors[k];
      const same = q && p[0] === q[0] && p[1] === q[1] && p[2] === q[2] && Math.abs(p[3] - q[3] * m.opacity) < 1e-12;
      if (!same) { bad++; if (!first) first = {k, value: m.color[k], plotly: Array.from(p), ours: q && Array.from(q)}; }
    }
    out.push({trace: i, n: t._length, bad, first, flagged: !!o._azOpacityInScene, sceneOpacity: o.opacity,
              opacity: m.opacity, plotlySceneOpacity: ref.opacity});
    Plotly.purge(d); d.remove();
  }
  return out;
}""" % GRAPH


@pytest.mark.parametrize("extra", [{}, {"colorScale": "Viridis", "colorReversed": True, "colorMin": 2000,
                                         "colorMax": 8000, "pointOpacity": 0.6}], ids=["auto", "set-range"])
@pytest.mark.parametrize("colour", [NUMERIC, GENE], ids=["obs", "gene"])
def test_colours_are_plotlys(server, page, colour, extra):
    root, large = server
    if large:
        pytest.skip("large-plot mode gives Plotly one colour per trace")
    page.goto(_link(root, colour, **extra))
    _wait(page, lambda s: True)
    traces = page.evaluate(COMPARE)
    assert traces, "no per-point coloured trace"
    for t in traces:
        assert t["bad"] == 0, t
        assert t["flagged"], t
        assert t["sceneOpacity"] == t["opacity"], t
        assert t["plotlySceneOpacity"] == 1, "Plotly folds the opacity into its colours instead"


def test_opacity_slider_is_not_applied_twice(server, page):
    root, large = server
    page.goto(_link(root, NUMERIC, pointOpacity=0.4))
    _wait(page, lambda s: True)
    box = page.locator(f"#point-opacity-input-{PID}")
    box.fill("0.8")
    box.dispatch_event("change")
    s = _wait(page, lambda s: s["sceneOpacities"] and all(abs(v - 0.8) < 1e-9 for v in s["sceneOpacities"]))
    alphas = page.evaluate("""() => { const g = %s; const sc = g._fullLayout._plots.xy._scene;
        return sc.markerOptions.flatMap((o, i) => (o && Array.isArray(o.colors) && g.data[i].meta !== 'az-colorbar')
            ? [...new Set(o.colors.map(c => c[3]))] : []); }""" % GRAPH)
    assert all(a == 1 for a in alphas), f"the colours carry an opacity: {alphas}"
    assert s["opacity"] == "0.8"
