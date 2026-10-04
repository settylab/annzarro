"""A Cell Plot created while the dataset is still opening waits for the names.

memory-guard: a Cell Plot made within about a second of opening a large
dataset (before the cell-name list, ~22 MB at 1M cells, had arrived) said
"this dataset reported no cell names" and kept saying it. Headless Chromium
opens the committed 200-cell fixture with the cell- and gene-name responses
held back, creates a Cell Plot from the Welcome tile at once, and only then
lets the names through: the plot must draw its points, and the sentence for a
dataset without names must never appear. The same for a Gene Plot.

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
OTHER = os.path.join(DATA_DIR, "fixture_small_v3.zarr")


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


TABLE_TOTALS = """() => [...document.querySelectorAll('.tile .dataTables_info, .tile .dt-info')].map(e => e.textContent)"""

POINTS = """() => [...document.querySelectorAll('.tile .js-plotly-plot')]
    .map(g => (g.data || []).reduce((n, t) => n + ((t.x && t.x.length) || 0), 0))"""


@pytest.mark.parametrize("panel,no_names,points", [
    ("cell-plot", "reported no cell names", 200),
    ("gene-plot", "reported no gene names", 20),
])
def test_a_plot_made_before_the_names_arrive_waits_for_them(server, panel, no_names, points):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1400, "height": 900})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            held, released = [], []

            def hold(route):
                if released:
                    route.continue_()
                else:
                    held.append(route)

            # hold the name lists back until the plot exists
            page.route("**/data/cells?*", hold)
            page.route("**/data/genes?*", hold)
            page.route("**/data/names?*", hold)
            page.goto(f"{server}/?dataset_path={urllib.parse.quote(STORE, safe='/')}")
            option = f".panel-type-option[data-type='{panel}']"
            page.wait_for_selector(option, timeout=30000)
            for _ in range(100):
                if held:
                    break
                page.wait_for_timeout(100)
            assert held, "the names were never requested"
            page.locator(option).first.click()
            page.wait_for_timeout(1500)
            assert no_names not in page.inner_text("body")

            released.append(True)
            for route in held:
                route.continue_()
            page.wait_for_function(f"() => ({POINTS})().some(n => n >= {points})", timeout=30000)
            page.wait_for_timeout(500)
            assert no_names not in page.inner_text("body")
            assert not errors, errors
        finally:
            browser.close()


@pytest.mark.parametrize("panel,total", [("cell-table", 200), ("gene-table", 20)])
def test_a_table_made_before_the_names_arrive_lists_them_all(server, panel, total):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1400, "height": 900})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            held, released = [], []

            def hold(route):
                if released:
                    route.continue_()
                else:
                    held.append(route)

            for pattern in ("**/data/cells?*", "**/data/genes?*", "**/data/names?*"):
                page.route(pattern, hold)
            page.goto(f"{server}/?dataset_path={urllib.parse.quote(STORE, safe='/')}")
            option = f".panel-type-option[data-type='{panel}']"
            page.wait_for_selector(option, timeout=30000)
            for _ in range(100):
                if held:
                    break
                page.wait_for_timeout(100)
            assert held, "the names were never requested"
            page.locator(option).first.click()
            page.wait_for_timeout(1500)
            released.append(True)
            for route in held:
                route.continue_()
            page.wait_for_function(f"() => ({TABLE_TOTALS})().some(t => / of {total} entries/.test(t))",
                                   timeout=30000)
            page.wait_for_timeout(500)
            assert not errors, errors
        finally:
            browser.close()


DONE = {
    "cell-plot": "() => ({points})().some(n => n >= 200)",
    "gene-plot": "() => ({points})().some(n => n >= 20)",
    "cell-table": "() => ({totals})().some(t => / of 200 entries/.test(t))",
    "gene-table": "() => ({totals})().some(t => / of 20 entries/.test(t))",
}


@pytest.mark.parametrize("panel", list(DONE))
def test_a_panel_made_while_switching_datasets_shows_the_new_one(server, panel):
    """During the switch, the previous dataset's names (here a 50-cell subset)
    were still loaded until the new ones arrived. A panel made then must end
    up with the new dataset's 200 cells, not the 50 of the old one."""
    view = {"v": 1, "subset": {"n": 50, "seed": 0}}
    payload = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1400, "height": 900})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(f"{server}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={payload}")
            page.wait_for_function("() => /50/.test(document.getElementById('cell-count').textContent)",
                                   timeout=30000)
            option = f".panel-type-option[data-type='{panel}']"
            page.wait_for_selector(option, timeout=30000)
            held, released = [], []

            def hold(route):
                if released:
                    route.continue_()
                else:
                    held.append(route)

            for pattern in ("**/data/dataset_structure?*", "**/data/cells?*", "**/data/genes?*",
                            "**/data/names?*", "**/data/subset?*"):
                page.route(pattern, hold)
            target = page.evaluate("""(name) => [...document.querySelectorAll('#dataset-selector option')]
                .map(o => o.value).find(v => v && v.includes(name))""", os.path.basename(OTHER))
            assert target, "the other fixture is not listed"
            # what choosing it in the select2 dropdown sends
            page.evaluate("""(v) => jQuery('#dataset-selector').val(v)
                .trigger({type: 'select2:select', params: {data: {id: v}}})""", target)
            for _ in range(50):
                if held:
                    break
                page.wait_for_timeout(100)
            assert held, "the switch made no request"
            page.locator(option).first.click()
            page.wait_for_timeout(1500)
            released.append(True)
            for route in held:
                route.continue_()
            page.wait_for_function(DONE[panel].format(points=POINTS, totals=TABLE_TOTALS), timeout=30000)
            page.wait_for_timeout(1000)
            # and stays there: nothing redraws it with the old cells
            assert page.evaluate(DONE[panel].format(points=POINTS, totals=TABLE_TOTALS))
            assert "reported no" not in page.inner_text("body")
            assert not errors, errors
        finally:
            browser.close()
