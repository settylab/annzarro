"""A panel's own axis titles survive the first draw from a view link.

``xaxisTitle`` / ``yaxisTitle`` in a panel config were applied only by the
Plot Options code; the first draw (createLayout) always wrote
``type.key.column``, so a link restored "obsm.X_umap.0" instead of
"UMAP 1". One headless Chromium session opens the committed 200-cell fixture
with and without large-plot mode (threshold lowered to 100 points via a config
file) and reads the drawn axis titles.

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


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _start(home, threshold):
    port = _free_port()
    cfg = home / "config.yaml"
    cfg.write_text(f"ui:\n  defaults:\n    large_plot_points: {threshold}\n")
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    # this checkout's package, not whatever "annzarro" is installed
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--config", str(cfg),
                             "--host", "127.0.0.1", "--port", str(port), "--data-dir", DATA_DIR,
                             "--no-browser", "--auth-disabled"],
                            env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    root = f"http://127.0.0.1:{port}"
    for _ in range(120):
        try:
            urllib.request.urlopen(root + "/api/v1/config", timeout=1)
            return proc, root
        except OSError:
            time.sleep(0.25)
    proc.kill()
    pytest.fail("server did not start")


@pytest.fixture(scope="module", params=[5_000_000, 100], ids=["regular", "large-plot"])
def server(request, tmp_path_factory):
    proc, root = _start(tmp_path_factory.mktemp("home"), request.param)
    yield root
    proc.terminate()
    proc.wait(10)


def _link(root, color):
    plot = {"id": "cell-plot-a",
            "x": {"type": "obsm", "key": "X_umap", "column": "0"},
            "y": {"type": "obsm", "key": "X_umap", "column": "1"},
            "color": color, "xaxisTitle": "UMAP 1", "yaxisTitle": "UMAP 2"}
    view = {"v": 1, "layout": {"v": 1, "hierarchy": [{"type": "tile", "id": "cell-plot-a", "controlsVisible": False}],
                               "panelConfigs": {"cell-plot-a": plot}}}
    payload = base64.urlsafe_b64encode(json.dumps(view, separators=(",", ":")).encode()).decode().rstrip("=")
    store = os.path.join(DATA_DIR, "fixture_small.zarr")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={payload}"


@pytest.mark.parametrize("color", [{"type": "none"}, {"type": "obs", "key": "cell_type", "column": ""}],
                         ids=["no-colour", "category"])
def test_custom_axis_titles_after_restore(server, color):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1400, "height": 900})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(_link(server, color))
            page.wait_for_selector('.tile[data-tile-id="cell-plot-a"] .js-plotly-plot', timeout=30000)
            page.wait_for_timeout(1000)
            titles = page.evaluate(
                "(() => { const l = document.querySelector('.tile[data-tile-id=\"cell-plot-a\"] .js-plotly-plot').layout;"
                " return [l.xaxis.title.text, l.yaxis.title.text]; })()")
            assert titles == ["UMAP 1", "UMAP 2"], titles
            assert not errors, errors
        finally:
            browser.close()
