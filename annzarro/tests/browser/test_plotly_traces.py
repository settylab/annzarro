"""Every plot type AnnZarro draws is in the bundled Plotly build.

static/vendor/js/plotly-2.35.3-annzarro.min.js holds only the scatter, scattergl
and scatter3d traces (scripts/build-plotly-bundle.sh). A trace type missing from
it does not fail loudly: plotly.js warns "Unrecognized trace type" and draws
nothing, or falls back to a scatter. This opens each kind of plot the app makes

* a regular 2D cell plot coloured by a category (scattergl, legend),
* a 3D cell plot coloured by a number (scatter3d, colour bar),
* a gene plot (scattergl),
* a large-plot-mode cell plot (scattergl legend and colour-bar proxies),

and asserts that every trace Plotly drew is of the type requested (a module,
not a fallback), that the console holds no Plotly warning or error, and that
both image exports work (PNG for all, SVG for the 2D ones). The scatter trace
the colour-scale probe uses is checked directly.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1, where a missing Playwright is an error.
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

from annzarro.tests.server.rich_store import make_rich_store  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
UMAP = ({"type": "obsm", "key": "X_umap", "column": "0"}, {"type": "obsm", "key": "X_umap", "column": "1"})


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    data = tmp_path_factory.mktemp("data")
    store = make_rich_store(data / "rich.zarr")
    home = tmp_path_factory.mktemp("home")
    cfg = home / "large.yaml"
    cfg.write_text("ui:\n  defaults:\n    large_plot_points: 100\n")   # 200 cells are "large", a 50-cell subset is not
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--config", str(cfg),
                             "--host", "127.0.0.1", "--port", str(port), "--data-dir", str(data),
                             "--no-browser", "--auth-disabled"],
                            env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
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
    yield root, store
    proc.terminate()
    proc.wait(10)


def _link(root, store, tile, panel, subset):
    panel = dict(panel, id=tile)
    view = {"v": 1, "subset": subset, "constants": {"focusedCell": "cell_0000"},   # a gene plot plots one cell
            "layout": {"v": 1, "hierarchy": [{"type": "tile", "id": tile, "controlsVisible": True}],
                       "controlState": {tile: True}, "panelConfigs": {tile: panel}}}
    payload = base64.urlsafe_b64encode(json.dumps(view, separators=(",", ":")).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={payload}"


CASES = {
    "2d-categorical": ("cell-plot-T", {"x": UMAP[0], "y": UMAP[1], "z": None,
                                       "color": {"type": "obs", "key": "cell_type", "column": ""}},
                       {"n": 50, "seed": 1}, {"scattergl"}, True),
    "3d-numeric": ("cell-plot-T", {"x": UMAP[0], "y": UMAP[1], "z": {"type": "obs", "key": "total_counts", "column": ""},
                                   "color": {"type": "obs", "key": "total_counts", "column": ""}},
                   {"n": 50, "seed": 1}, {"scatter3d"}, False),
    "gene-plot": ("gene-plot-T", {"z": None, "x": {"type": "layer", "key": "counts", "column": "cell_0000"},
                                  "y": {"type": "layer", "key": "counts", "column": "cell_0001"},
                                  "color": {"type": "layer", "key": "counts", "column": "cell_0002"}},
                  {"n": 50, "seed": 1}, {"scattergl"}, True),
    "large-categorical": ("cell-plot-T", {"x": UMAP[0], "y": UMAP[1], "z": None,
                                          "color": {"type": "obs", "key": "cell_type", "column": ""}},
                          None, {"scattergl"}, True),
    "large-numeric": ("cell-plot-T", {"x": UMAP[0], "y": UMAP[1], "z": None,
                                      "color": {"type": "obs", "key": "total_counts", "column": ""}},
                      None, {"scattergl"}, True),
}

STATE = """(tile) => {
  const g = document.querySelector(`.tile[data-tile-id="${tile}"] .js-plotly-plot`);
  const busy = [...document.querySelectorAll('.loading-overlay, .spinner-border')]
      .filter(e => e.offsetParent !== null).length;
  if (!g || !g.data || !g.data.length || !g._fullData) return {busy: 1};
  return {busy,
          asked: [...new Set(g.data.map(t => t.type))].sort(),
          drawn: [...new Set(g._fullData.map(t => t.type))].sort(),
          modules: g._fullData.every(t => t._module && t._module.name === t.type),
          points: g.data.reduce((n, t) => n + (t.x ? t.x.length : 0), 0)};
}"""

EXPORT = """async ([tile, format]) => {
  const g = document.querySelector(`.tile[data-tile-id="${tile}"] .js-plotly-plot`);
  const m = await import('/static/js/utils/plot-export.js');
  const out = await m.exportImageData(g, 'full', {format, width: 600, height: 400, scale: 1});
  return [typeof out, String(out).slice(0, 40), String(out).length];
}"""

PROBE = """async () => {
  const div = document.createElement('div');
  document.body.appendChild(div);
  await Plotly.newPlot(div, [{type: 'scatter', x: [0, 1], y: [0, 1], marker: {color: [0, 1], colorscale: 'Viridis'}}]);
  const type = div._fullData[0].type, mod = !!div._fullData[0]._module;
  Plotly.purge(div); div.remove();
  return {type, mod};
}"""


def _settle(page, tile, timeout=60):
    end = time.time() + timeout
    s = None
    while time.time() < end:
        s = page.evaluate(STATE, tile)
        if not s["busy"]:
            page.wait_for_timeout(800)
            s2 = page.evaluate(STATE, tile)
            if not s2["busy"] and s2["points"] == s["points"]:
                return s2
        page.wait_for_timeout(200)
    pytest.fail(f"plot did not settle: {s}")


@pytest.mark.parametrize("case", sorted(CASES))
def test_every_trace_type_the_app_draws_is_in_the_bundle(server, case):
    root, store = server
    tile, panel, subset, want, svg = CASES[case]
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1250, "height": 900})
            problems = []
            page.on("pageerror", lambda e: problems.append(f"pageerror: {e}"))
            page.on("console", lambda m: problems.append(f"{m.type}: {m.text}")
                    if m.type in ("warning", "error") else None)
            page.goto(_link(root, store, tile, panel, subset))
            state = _settle(page, tile)
            assert set(state["asked"]) == want, state
            assert set(state["drawn"]) == want, f"Plotly drew {state['drawn']} for {state['asked']}"
            assert state["modules"], "a trace has no module of its type"
            assert state["points"] >= 1

            for fmt in ("png",) + (("svg",) if svg else ()):
                kind, head, size = page.evaluate(EXPORT, [tile, fmt])
                assert kind == "string" and size > 500, (fmt, head, size)
                assert head.startswith("data:image/png") if fmt == "png" else "<svg" in head, (fmt, head)

            probe = page.evaluate(PROBE)
            assert probe == {"type": "scatter", "mod": True}, probe

            bad = [m for m in problems if "Unrecognized" in m or "unrecognized" in m
                   or ("Plotly" in m and "warn" in m.lower())
                   or m.startswith(("pageerror", "error"))]
            # the browser's own noise (favicon, GPU stall notices in headless Chromium) is not ours
            bad = [m for m in bad if "favicon" not in m and "GPU stall" not in m]
            assert not bad, bad
        finally:
            browser.close()
