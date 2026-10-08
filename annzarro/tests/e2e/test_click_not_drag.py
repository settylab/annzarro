"""A plot click focuses a cell only when it is a click, not the start of a drag.

Plotly reports a 3D click when the button goes down, so rotating the plot used
to refocus whatever cell was under the pointer. Opens the committed fixture
(200 cells) as a 3D and as a 2D cell plot and checks that a quick click on a
point focuses it, while a press-and-drag (rotate, zoom box) and a long press
leave the focus alone.

Needs Playwright with Chromium (``pip install playwright; playwright install
chromium``); skipped without it, or failed when ANNZARRO_REQUIRE_BROWSER=1.
Starts the server on a free 127.0.0.1 port.
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

REQUIRE = os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1"


def _skip_or_fail(reason):
    if REQUIRE:
        pytest.fail(f"{reason} (ANNZARRO_REQUIRE_BROWSER=1)")
    pytest.skip(reason)


try:
    from playwright import sync_api
except ImportError:  # pragma: no cover - depends on the environment
    sync_api = None

HERE = os.path.dirname(os.path.abspath(__file__))
CLICK_MS = 300      # CLICK_MAX_MS in plot-make-helper.js
FIXTURE = os.path.join(os.path.dirname(HERE), "data", "fixture_small.zarr")


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    if sync_api is None:
        _skip_or_fail("Playwright is not installed")
    if not os.path.isdir(os.path.join(os.path.dirname(os.path.dirname(HERE)), "..", "static", "vendor")):
        _skip_or_fail("static/vendor is not provisioned")
    tmp = tmp_path_factory.mktemp("clicks")
    data = tmp / "data"
    data.mkdir()
    shutil.copytree(FIXTURE, data / "fixture_small.zarr")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(tmp / "home"), ANNZARRO_HEADLESS="1")
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", str(data), "--no-browser", "--auth-disabled"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env, cwd=tmp)
    base = f"http://127.0.0.1:{port}"
    for _ in range(300):
        try:
            urllib.request.urlopen(base + "/api/v1/config", timeout=1)
            break
        except OSError:
            time.sleep(0.1)
    else:
        proc.kill()
        pytest.fail("server did not start")
    yield base, str(data / "fixture_small.zarr")
    proc.terminate()
    proc.wait(20)


def _open(pw_page, base, dataset, three_d):
    x = {"type": "obsm", "key": "X_umap", "column": "0"}
    y = {"type": "obsm", "key": "X_umap", "column": "1"}
    z = {"type": "obs", "key": "total_counts", "column": ""} if three_d else None
    plot = {"id": "cell-plot-A", "title": "clicks", "x": x, "y": y, "z": z,
            "color": {"type": "obs", "key": "leiden", "column": ""}}
    layout = {"v": 1, "hierarchy": [{"type": "tile", "id": "cell-plot-A"}],
              "controlState": {"cell-plot-A": False}, "panelConfigs": {"cell-plot-A": plot}}
    view = {"v": 1, "layout": layout}
    pw_page.goto(f"{base}/?dataset_path={dataset}#view="
                 + base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("="))
    pw_page.wait_for_selector(".tile[data-tile-id='cell-plot-A'] .js-plotly-plot canvas", timeout=60_000)
    pw_page.wait_for_timeout(1500)
    pw_page.evaluate("""() => {
        window.__focus = [];
        document.addEventListener('focusedCellChanged', e => window.__focus.push(e.detail.cell));
        window.__hover = null;
        const g = document.querySelector('.tile[data-tile-id="cell-plot-A"] .js-plotly-plot');
        g.on('plotly_hover', e => { window.__hover = true; });
        window.__pclicks = 0;
        g.on('plotly_click', e => { window.__pclicks++; });
    }""")


def _focus_log(page):
    return page.evaluate("window.__focus")


def _find_point(page, three_d):
    """Screen position (x, y) of a data point, found by hovering a grid."""
    if not three_d:
        return page.evaluate("""() => {
            const g = document.querySelector('.tile[data-tile-id="cell-plot-A"] .js-plotly-plot');
            const a = g.querySelector('.nsewdrag').getBoundingClientRect(), d = g._fullData[0];
            return [a.left + g._fullLayout.xaxis.c2p(d.x[0]), a.top + g._fullLayout.yaxis.c2p(d.y[0])];
        }""")
    # gl3d emits plotly_click only for a pick within a few px while a button is
    # held (on every move, not only on the press). Hover finds the neighbourhood;
    # a motionless long press then finds the spot where a press counts.
    page.evaluate("window.__hover = null")
    left, top, w, h = page.evaluate("""() => { const r = document.querySelector(
        '.tile[data-tile-id="cell-plot-A"] .js-plotly-plot canvas').getBoundingClientRect();
        return [r.left, r.top, r.width, r.height]; }""")
    grid = [(gx, gy) for gx in range(6, int(w), 8) for gy in range(6, int(h), 8)]
    grid.sort(key=lambda p: (p[0] - w / 2) ** 2 + (p[1] - h / 2) ** 2)
    for gx, gy in grid:
        page.mouse.move(left + gx, top + gy)
        page.wait_for_timeout(40)
        if page.evaluate("window.__hover") is None:
            continue
        for dx in range(-8, 9, 2):
            for dy in range(-8, 9, 2):
                x, y = left + gx + dx, top + gy + dy
                page.mouse.move(x, y)
                page.wait_for_timeout(40)
                before = page.evaluate("window.__pclicks")
                page.mouse.down()
                page.wait_for_timeout(30)
                hit = page.evaluate("window.__pclicks") > before
                page.wait_for_timeout(CLICK_MS + 50)   # held too long to count as a click
                page.mouse.up()
                page.wait_for_timeout(100)
                if hit:
                    return [x, y]
        page.evaluate("window.__hover = null")
    pytest.fail("no data point found under the 3D scene")


@pytest.mark.parametrize("three_d", [True, False], ids=["3d", "2d"])
def test_only_a_quick_still_click_focuses(server, three_d):
    base, dataset = server
    with sync_api.sync_playwright() as pw:
        try:
            browser = pw.chromium.launch()
        except Exception as exc:  # no browser binary
            _skip_or_fail(f"Chromium cannot start: {exc}")
        try:
            page = browser.new_page(viewport={"width": 1200, "height": 800})
            _open(page, base, dataset, three_d)

            # a drag that starts on a point (3D rotation, 2D zoom box)
            x, y = _find_point(page, three_d)
            page.mouse.move(x, y)
            page.mouse.down()
            page.mouse.move(x + 60, y + 30, steps=8)
            page.mouse.up()
            page.wait_for_timeout(400)
            assert _focus_log(page) == [], "a drag from a point changed the focus"

            # a long press without movement (the drag moved the view: look again)
            x, y = _find_point(page, three_d)
            page.mouse.move(x, y)
            page.mouse.down()
            page.wait_for_timeout(700)
            page.mouse.up()
            page.wait_for_timeout(400)
            assert _focus_log(page) == [], "a long press changed the focus"

            # a quick click focuses, and only once the button is released
            x, y = _find_point(page, three_d)
            page.mouse.move(x, y)
            page.mouse.down()
            page.wait_for_timeout(50)
            if three_d:
                assert _focus_log(page) == [], "focus changed on button down"
            page.mouse.up()
            page.wait_for_timeout(400)
            log = _focus_log(page)
            assert len(log) == 1 and log[0], f"a quick click should focus one cell, got {log}"
        finally:
            browser.close()
