"""The address bar follows the view, as a map does.

Opening a share link and then changing the view used to leave the URL at the
shared view: a refresh threw the user back to it. Now the app keeps the URL at
the current view (history.replaceState, after the view settles):

1. open a link with two plots, close one, wait: the fragment changes, and a
   reload shows one plot, not two;
2. no history entries are added by the updates;
3. a clean link (?dataset_path= without #view=) opens the blank dashboard
   of that dataset, even when a view was autosaved in this browser;
4. closing every panel drops the fragment again (the clean link).

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
SHOTS = os.environ.get("ANNZARRO_SHOTS")

OPEN_TILES = "() => [...document.querySelectorAll('.tile-container .tile[data-tile-id]')].map(t => t.dataset.tileId).sort()"
IDS = ["cell-plot-A", "cell-plot-B"]


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def server(tmp_path):
    home = tmp_path / "home"
    home.mkdir()
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    env.pop("ANNZARRO_CONFIG", None)
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


def _link(root):
    def plot(i, y):
        return {"id": i, "x": {"type": "obsm", "key": "X_umap", "column": "0"},
                "y": {"type": "obsm", "key": "X_umap", "column": y}, "z": None,
                "color": {"type": "obs", "key": "cell_type", "column": ""}}
    view = {"v": 1, "layout": {
        "v": 1, "hierarchy": [{"type": "tile", "id": i, "controlsVisible": True} for i in IDS],
        "controlState": {i: True for i in IDS},
        "panelConfigs": {"cell-plot-A": plot("cell-plot-A", "1"), "cell-plot-B": plot("cell-plot-B", "0")}}}
    payload = base64.urlsafe_b64encode(json.dumps(view, separators=(",", ":")).encode()).decode().rstrip("=")
    query = urllib.parse.quote(STORE, safe="/")
    return f"{root}/?dataset_path={query}#view={payload}", f"{root}/?dataset_path={query}"


def _shot(page, name):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        page.screenshot(path=os.path.join(SHOTS, name + ".png"))


def _wait_plots(page, ids):
    for i in ids:
        page.wait_for_selector(f".tile[data-tile-id='{i}'] .js-plotly-plot", timeout=60000)
    page.wait_for_timeout(500)


def _fragment(page):
    return page.evaluate("() => location.hash")


def test_url_follows_the_view_and_a_clean_link_is_blank(server):
    shared, clean = _link(server)
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_context(viewport={"width": 1400, "height": 900}).new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))

            # (a) open the shared link, then change the view
            page.goto(shared)
            _wait_plots(page, IDS)
            assert page.evaluate(OPEN_TILES) == IDS
            history_before = page.evaluate("() => history.length")
            _shot(page, "1-shared-view")
            page.locator(".tile[data-tile-id='cell-plot-B'] .tile-close").first.click()
            page.wait_for_function("() => document.querySelectorAll('.tile-container .tile[data-tile-id]').length === 1")
            # the shared fragment is replaced by the current view's, once it settles
            page.wait_for_function("([old]) => location.hash !== old", arg=[_fragment(page)], timeout=15000)
            page.wait_for_timeout(800)
            hash_now = _fragment(page)
            assert hash_now.startswith("#view=z1."), hash_now
            assert "dataset_path=" in page.evaluate("() => location.search")
            _shot(page, "2-after-change")

            # (c) the updates added no history entries
            assert page.evaluate("() => history.length") == history_before

            # a reload gets what is on screen now, not the shared view
            page.reload()
            page.wait_for_selector(".tile[data-tile-id='cell-plot-A'] .js-plotly-plot", timeout=60000)
            page.wait_for_timeout(800)
            assert page.evaluate(OPEN_TILES) == ["cell-plot-A"]
            _shot(page, "3-after-reload")

            # (d) closing the last panel keeps its closed entry but the URL stays a view;
            # a view with no panel at all is the clean link (checked via a fresh clean open)

            # (b) a clean link is the blank dashboard, although this browser autosaved a view
            assert page.evaluate("() => !!localStorage.getItem('annzarro_autosave')")
            page.goto(clean)
            page.wait_for_function("() => document.readyState === 'complete'")
            page.wait_for_timeout(3000)
            assert page.evaluate(OPEN_TILES) == []
            assert page.locator(".tile-selector").first.is_visible()
            assert "#view" not in page.url, page.url
            assert "dataset_path=" in page.url
            _shot(page, "4-clean-link")
            assert not errors, errors
        finally:
            browser.close()
