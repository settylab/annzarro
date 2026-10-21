"""T, W, H and V act on the panel under the pointer, and C only copies.

Two plots side by side. With the pointer on the second, T toggles the controls of
the second only and W closes the second only; before, the keys always hit the
first panel of a row. C with no hover label showing does nothing.

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
FIRST = '.tile[data-tile-id="cell-plot-A"]'
SECOND = '.tile[data-tile-id="cell-plot-B"]'


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def root(tmp_path_factory):
    home = tmp_path_factory.mktemp("home")
    port = _free_port()
    exe = shutil.which("annzarro", path=os.path.dirname(sys.executable)) or shutil.which("annzarro")
    if not exe:
        (pytest.fail if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1" else pytest.skip)(
            "annzarro console script not found")
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1")
    proc = subprocess.Popen([exe, "start", "--host", "127.0.0.1", "--port", str(port),
                             "--data-dir", DATA_DIR, "--no-browser", "--auth-disabled"],
                            env=env, cwd=home, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    url = f"http://127.0.0.1:{port}"
    for i in range(120):
        try:
            urllib.request.urlopen(url + "/api/v1/config", timeout=1)
            break
        except OSError:
            time.sleep(min(0.5, 0.1 * (i + 1)))
    else:
        proc.kill()
        pytest.fail("server did not start")
    yield url
    proc.terminate()
    proc.wait(10)


def _link(root):
    x = {"type": "obsm", "key": "X_umap", "column": "0"}
    y = {"type": "obsm", "key": "X_umap", "column": "1"}
    cfgs = {pid: {"id": pid, "title": pid, "x": x, "y": y, "z": None, "pointSize": 12,
                  "color": {"type": "obs", "key": "total_counts", "column": ""}}
            for pid in ("cell-plot-A", "cell-plot-B")}
    tiles = [{"type": "tile", "id": pid, "controlsVisible": True} for pid in cfgs]
    view = {"v": 1, "subset": None,
            "layout": {"v": 1, "hierarchy": [{"type": "split", "direction": "horizontal",
                                              "panes": [{"percentage": 50}, {"percentage": 50}], "children": tiles}],
                       "controlState": {pid: True for pid in cfgs}, "panelConfigs": cfgs}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={enc}"


@pytest.fixture
def page(root):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            ctx = browser.new_context(viewport={"width": 1300, "height": 800}, permissions=["clipboard-read", "clipboard-write"])
            page = ctx.new_page()
            page.errors = []
            page.on("pageerror", lambda e: page.errors.append(str(e)))
            page.goto(_link(root))
            for tile in (FIRST, SECOND):
                page.wait_for_function(
                    "t => { const g = document.querySelector(t + ' .js-plotly-plot'); return !!(g && g.data && g.data.length); }",
                    arg=tile, timeout=60000)
            yield page
            assert not page.errors, page.errors
        finally:
            browser.close()


def _hidden(page, tile):
    """Whether the tile's controls are hidden (the chevron points down)."""
    return page.evaluate("t => !!document.querySelector(t + ' .tile-toggle-controls .fa-chevron-down')", tile)


def _over_header(page, tile):
    """The pointer on the tile's header, clear of any plot point."""
    box = page.locator(f"{tile} .tile-header").bounding_box()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)


def test_t_toggles_the_panel_under_the_pointer(page):
    _over_header(page, SECOND)
    page.keyboard.press("t")
    page.wait_for_function("t => !!document.querySelector(t + ' .tile-toggle-controls .fa-chevron-down')", arg=SECOND)
    assert not _hidden(page, FIRST)
    _over_header(page, FIRST)
    page.keyboard.press("t")
    page.wait_for_function("t => !!document.querySelector(t + ' .tile-toggle-controls .fa-chevron-down')", arg=FIRST)
    assert _hidden(page, SECOND)


def test_w_closes_the_panel_under_the_pointer(page):
    _over_header(page, SECOND)
    page.keyboard.press("w")
    page.wait_for_function("t => !document.querySelector(t)", arg=SECOND)
    assert page.locator(FIRST).count() == 1


def test_c_without_a_label_does_nothing(page):
    _over_header(page, SECOND)
    page.evaluate("navigator.clipboard.writeText('sentinel')")
    page.keyboard.press("c")
    page.wait_for_timeout(300)
    assert not _hidden(page, FIRST) and not _hidden(page, SECOND)
    assert page.evaluate("navigator.clipboard.readText()") == "sentinel"
    assert page.locator(".notification").count() == 0
