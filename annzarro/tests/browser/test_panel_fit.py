"""A panel opened from a link fits the window: the plot's x axis is in view.

v0.3.0 started every panel without a saved height at 1000 px and no longer
capped it at the window. In a window under about 1110 px the panel ran past
the bottom: the x tick labels and the x-axis title opened below the fold
(the Fig. 7 shots on the tag lost them). A panel without a saved height now
starts as tall as the window shows (at most 1000 px); a saved or dragged
height is still kept as is (test_panel_height.py).

The committed 200-cell fixture is served with ``ui.defaults.large_plot_points``
at 100, so every cell is large-plot mode and a 50-cell subset is the regular
path. Each case opens a link in a 1300 x 900 window and checks that the x-axis
title, every x tick label and the status strip lie inside the panel and inside
the window.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import base64
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402  (required: fail, do not skip)
else:
    playwright = pytest.importorskip("playwright.sync_api")

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.dirname(HERE), "data")
STORE = os.path.join(DATA_DIR, "fixture_small.zarr")


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


def _link(root, subset, controls, colour):
    x = {"type": "obsm", "key": "X_umap", "column": "0"}
    y = {"type": "obsm", "key": "X_umap", "column": "1"}
    cfg = {"cell-plot-F": {"id": "cell-plot-F", "title": "fit", "x": x, "y": y, "z": None, "color": colour}}
    view = {"v": 1, "subset": subset,
            "layout": {"v": 1, "hierarchy": [{"type": "tile", "id": "cell-plot-F", "controlsVisible": controls}],
                       "controlState": {"cell-plot-F": controls}, "panelConfigs": cfg}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={STORE}#view={enc}"


GEOM = """() => {
  const t = document.querySelector('.tile[data-tile-id="cell-plot-F"]');
  const g = t && t.querySelector('.js-plotly-plot');
  if (!g || !g._fullLayout || !g.querySelector('.xtitle')) return null;
  const busy = [...document.querySelectorAll('.loading-overlay, .spinner-border')].filter(e => e.offsetParent !== null).length;
  const r = e => e.getBoundingClientRect();
  const strip = t.querySelector('.plot-status');
  return {busy, tileTop: r(t).top, tileBottom: r(t).bottom, window: window.innerHeight,
          xtitle: r(g.querySelector('.xtitle')).bottom,
          ticks: [...g.querySelectorAll('.xtick text')].map(e => r(e).bottom),
          strip: strip ? r(strip).bottom : null,
          large: !!t.querySelector('.ps-tag[data-tag="large"]')};
}"""

CASES = [
    ("regular", {"n": 50, "seed": 0}, False, {"type": "obs", "key": "cell_type", "column": ""}),
    ("regular, controls open", {"n": 50, "seed": 0}, True, {"type": "obs", "key": "cell_type", "column": ""}),
    ("large", None, False, {"type": "obs", "key": "cell_type", "column": ""}),
    ("large, controls open", None, True, {"type": "obs", "key": "cell_type", "column": ""}),
    ("regular, numeric colour", {"n": 50, "seed": 0}, False, {"type": "obs", "key": "total_counts", "column": ""}),
]


@pytest.mark.parametrize("name,subset,controls,colour", CASES, ids=[c[0] for c in CASES])
def test_x_axis_and_strip_are_in_the_panel_and_in_view(server, name, subset, controls, colour):
    with playwright.sync_playwright() as pw:
        browser = pw.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1300, "height": 900})
            page.goto(_link(server, subset, controls, colour))
            s = None
            t0 = time.time()
            while time.time() - t0 < 60:
                s = page.evaluate(GEOM)
                if s and not s["busy"] and s["ticks"]:
                    break
                time.sleep(0.25)
            time.sleep(1.0)                   # past the resize observer's debounce
            s = page.evaluate(GEOM)
            assert s and s["ticks"], f"no plot drawn: {s}"
            assert s["large"] == (subset is None), s
            bottom = min(s["tileBottom"], s["window"]) + 0.5
            assert s["xtitle"] <= bottom, f"x-axis title below the visible panel: {s}"
            assert max(s["ticks"]) <= bottom, f"x tick labels below the visible panel: {s}"
            if s["strip"] is not None:
                assert s["strip"] <= bottom, f"status strip below the visible panel: {s}"
        finally:
            browser.close()
