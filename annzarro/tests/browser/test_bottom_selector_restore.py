"""A restored layout always ends with the bottom "Create New Panel" chooser.

restoreLayout rebuilt the chooser only when the hierarchy listed a
``{"type": "selector"}`` node. Layouts saved by the app do; a hand-written
share link or an older panel set may not, and the chooser then never came
back (splitting a tile only offered a temporary one). One headless Chromium
session opens the committed 200-cell fixture with and without that node and
counts the visible choosers: exactly one in both cases.

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


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    home = tmp_path_factory.mktemp("home")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    # this checkout's package, not whatever "annzarro" is installed
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1",
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
    yield root
    proc.terminate()
    proc.wait(10)


def _link(root, hierarchy):
    plot = {"id": "cell-plot-a",
            "x": {"type": "obsm", "key": "X_umap", "column": "0"},
            "y": {"type": "obsm", "key": "X_umap", "column": "1"},
            "color": {"type": "none"}}
    view = {"v": 1, "layout": {"v": 1, "hierarchy": hierarchy,
                               "panelConfigs": {"cell-plot-a": plot}}}
    payload = base64.urlsafe_b64encode(json.dumps(view, separators=(",", ":")).encode()).decode().rstrip("=")
    store = os.path.join(DATA_DIR, "fixture_small.zarr")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={payload}"


SPLIT = {"type": "split", "direction": "horizontal",
         "panes": [{"percentage": 50, "controlsVisible": False}, {"percentage": 50, "controlsVisible": False}],
         "children": [{"type": "tile", "id": "cell-plot-a", "controlsVisible": False},
                      {"type": "tile", "id": "cell-table-b", "controlsVisible": False}]}


@pytest.mark.parametrize("hierarchy", [[SPLIT], [SPLIT, {"type": "selector"}]],
                         ids=["without-selector-node", "with-selector-node"])
def test_one_bottom_chooser_after_restore(server, hierarchy):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1400, "height": 900})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(_link(server, hierarchy))
            page.wait_for_selector('.tile[data-tile-id="cell-plot-a"] .js-plotly-plot', timeout=30000)
            page.wait_for_timeout(500)
            choosers = page.evaluate(
                "[...document.querySelectorAll('.tile-selector')]"
                ".filter(e => e.offsetParent !== null)"
                ".map(e => (e.querySelector('h3') || {}).textContent)")
            assert choosers == ["Create New Panel"], choosers
            assert not errors, errors
        finally:
            browser.close()
