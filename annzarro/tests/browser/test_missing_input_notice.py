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


def _open_offscreen(pw, root, store):
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={"width": 1400, "height": 800})
    page.goto(_offscreen_link(root, store))
    tile = page.locator(f'.tile[data-tile-id="{TABLE}"]')
    tile.locator(".filter-notice").first.wait_for(state="attached", timeout=60_000)
    page.wait_for_timeout(1500)
    return browser, page, tile


def _first_row(tile):
    return tile.locator("tbody tr").first.inner_text()


def test_a_score_off_screen_says_it_has_not_started_and_starts_when_scrolled_to(server):
    root, store = server
    with playwright.sync_playwright() as pw:
        browser, page, tile = _open_offscreen(pw, root, store)
        before = [e.inner_text() for e in tile.locator(".filter-notice").all()]
        assert before == ["'Signature 1' starts when it is on screen."], before
        assert "computing" in _first_row(tile)
        tile.scroll_into_view_if_needed()
        page.wait_for_function(
            "id => !document.querySelector(`.tile[data-tile-id=\"${id}\"] .filter-notice`)", arg=TABLE, timeout=30_000)
        row = _first_row(tile)
        browser.close()
    assert "computing" not in row, row


def test_a_score_starts_when_the_panel_above_it_closes(server):
    root, store = server
    with playwright.sync_playwright() as pw:
        browser, page, tile = _open_offscreen(pw, root, store)
        assert "computing" in _first_row(tile)
        page.evaluate("id => window.PanelManager.closePanel(id)", SIG)
        page.wait_for_function(
            "id => !document.querySelector(`.tile[data-tile-id=\"${id}\"] .filter-notice`)", arg=TABLE, timeout=30_000)
        row = _first_row(tile)
        browser.close()
    assert "computing" not in row, row
