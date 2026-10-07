"""Panels grow past the window; the chooser under them never scrolls inside.

The top-level panel wrapper was capped at the visible tile area less 5rem
(``max-height``), so dragging its height handle past the window height did
nothing: users could not enlarge a plot. The bottom "Create New Panel"
chooser was a 320 px box that scrolled inside, hard to scroll past. One
headless Chromium session opens the committed 200-cell fixture, drags the
panel handle 700 px down and checks the panel took the height, the page
scrolls to the chooser, and the chooser shows all its content.

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



ONE = [{"type": "tile", "id": "cell-plot-a", "controlsVisible": False}, {"type": "selector"}]

GEOM = """() => {
  const w = document.querySelector('.tile-container > .panel-wrapper');
  const s = document.querySelector('.tile-container > .tile-selector');
  const c = document.querySelector('.tile-container');
  return {wrap: w.getBoundingClientRect().height, style: parseFloat(w.style.getPropertyValue('--panel-height')),
          selClient: s.clientHeight, selScroll: s.scrollHeight,
          page: c.clientHeight, pageScroll: c.scrollHeight};
}"""


def test_panel_grows_past_the_window_and_chooser_does_not_scroll(server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1400, "height": 900})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(_link(server, ONE))
            page.wait_for_selector('.tile[data-tile-id="cell-plot-a"] .js-plotly-plot', timeout=30000)
            page.wait_for_timeout(500)
            before = page.evaluate(GEOM)
            assert before["selScroll"] <= before["selClient"] + 1, before
            handle = page.locator(".tile-container > .split-handle[data-panel-handle='true']").first
            handle.scroll_into_view_if_needed()
            box = handle.bounding_box()
            x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
            page.mouse.move(x, y)
            page.mouse.down()
            page.mouse.move(x, y + 700, steps=10)
            page.mouse.up()
            page.wait_for_timeout(300)
            after = page.evaluate(GEOM)
            assert after["wrap"] >= before["wrap"] + 650, (before, after)
            assert abs(after["wrap"] - after["style"]) <= 1, after   # nothing clips the dragged height
            assert after["wrap"] > after["page"], after              # taller than the visible area
            assert after["pageScroll"] > after["page"], after        # the page scrolls to the chooser
            assert after["selScroll"] <= after["selClient"] + 1, after
            assert not errors, errors
        finally:
            browser.close()
