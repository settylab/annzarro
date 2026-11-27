"""A plot whose input the open dataset lacks says so, not that it is "too large to compute here".

Reported (0.8.0): after switching datasets, a Cell Count Plot said "'Grouping 1' is too large to compute
here, so it was not run" although the dataset simply lacked the column it reads. A missing input is
refused by the page before anything is asked; its notice had no sentence of its own and fell back on the
refusal for size.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
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
    import playwright.sync_api as playwright  # noqa: E402  (required: fail, do not skip)
else:
    playwright = pytest.importorskip("playwright.sync_api")

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "..", "data")
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
COUNT = "cell-count-A"


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    data = tmp_path_factory.mktemp("data")
    shutil.copytree(os.path.join(DATA_DIR, "fixture_small.zarr"), data / "small.zarr")
    home = tmp_path_factory.mktemp("home")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", str(data), "--no-browser", "--auth-disabled"],
                            env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    root = f"http://127.0.0.1:{port}"
    for i in range(120):
        try:
            urllib.request.urlopen(root + "/api/v1/config", timeout=1)
            break
        except OSError:
            time.sleep(min(0.5, 0.1 * (i + 1)))
    else:
        proc.kill()
        pytest.fail("server did not start")
    yield root, str(data / "small.zarr")
    proc.terminate()
    proc.wait(10)


def _link(root, store, column):
    cfg = {"id": COUNT, "title": "Cell Count Plot 1", "version": 1, "mode": "histogram",
           "x": {"source": {"type": "obs", "key": column}}}
    view = {"v": 1, "constants": {}, "layout": {"v": 1,
            "hierarchy": [{"type": "tile", "id": COUNT, "controlsVisible": True}],
            "controlState": {COUNT: True}, "panelConfigs": {COUNT: cfg}}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={enc}"


def test_a_missing_column_is_not_a_size_refusal(server):
    root, store = server
    with playwright.sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        page.goto(_link(root, store, "no_such_column"))
        tile = page.locator(f'.tile[data-tile-id="{COUNT}"]')
        notice = tile.locator(".coverage-placeholder__headline").first
        notice.wait_for(timeout=60_000)
        text = tile.inner_text()
        browser.close()
    assert "not in this dataset" in text, text
    assert "too large" not in text, text


SIG, TABLE = "gene-signature-A", "cell-table-A"


def _offscreen_link(root, store):
    """A signature, then (below the fold) a cell table with a column scored by it: that score is not started."""
    sig = {"id": SIG, "title": "Signature 1", "genes": ["GENE000", "GENE001", "GENE002"], "down": [],
           "input": "X", "method": "zscore_mean", "clip": 10, "seed": None, "bins": 25, "controls": 50,
           "detect_above": 0, "version": 1}
    table = {"id": TABLE, "title": "Table 1", "searchBuilderEnabled": False, "_closed": False,
             "columns": [{"type": "obs", "key": "leiden", "column": ""},
                         {"type": "gene-score", "key": SIG, "column": "zscore_mean", "label": "Signature 1", "layer": "X"}]}
    view = {"v": 1, "constants": {}, "layout": {"v": 1, "hierarchy": [
        {"type": "tile", "id": SIG, "controlsVisible": True, "height": 3000},
        {"type": "tile", "id": TABLE, "controlsVisible": True, "height": 600}],
        "controlState": {SIG: False, TABLE: True}, "panelConfigs": {SIG: sig, TABLE: table}}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={enc}"


def test_cancel_on_a_score_that_has_not_started_ends_the_wait(server):
    root, store = server
    with playwright.sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": 1400, "height": 800})
        page.goto(_offscreen_link(root, store))
        tile = page.locator(f'.tile[data-tile-id="{TABLE}"]')
        cancel = tile.get_by_role("button", name="Cancel")
        cancel.first.wait_for(state="attached", timeout=60_000)
        page.wait_for_timeout(1500)            # nothing may start for a table nobody can see
        cancel.first.evaluate("el => el.click()")   # below the fold: clicked without scrolling to it
        page.wait_for_function(
            "id => /cancelled/i.test((document.querySelector(`.tile[data-tile-id=\"${id}\"]`) || {}).innerText || '')",
            arg=TABLE, timeout=15_000)
        text = tile.inner_text()
        browser.close()
    assert "cancelled" in text.lower(), text
