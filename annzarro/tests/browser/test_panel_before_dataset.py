"""A panel picked before the first dataset load begins still comes alive.

The welcome chooser is shown while the page is still starting: it reads the
policy, the dataset listing and the sessions (and, for ?dataset_path=, probes
the store) before it opens the dataset. A panel picked in that window was
built with no dataset current, so it showed "No dataset loaded" and hid and
disabled its controls, and nothing lifted them when the dataset came: the plot
drew behind the screen and the panel looked broken for good. Locally the
window is tens of milliseconds; on a slow server (a large data directory,
networked storage) a user can click in it.

Each case holds the dataset listing back, so the window stays open, picks a
panel type in it, then lets the page go on. Once the dataset is open the
screen must be gone and the controls shown, and as usable as those of the
same panel made after the dataset opened.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
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
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
FIXTURE = os.path.join(os.path.dirname(HERE), "data", "fixture_small.zarr")


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    home = tmp_path_factory.mktemp("home")
    data_dir = tmp_path_factory.mktemp("data")
    shutil.copytree(FIXTURE, data_dir / "fixture_small.zarr")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", str(data_dir), "--no-browser",
                             "--auth-disabled"],
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
    yield root, str(data_dir / "fixture_small.zarr")
    proc.terminate()
    proc.wait(10)


@pytest.fixture(scope="module")
def browser():
    with playwright.sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


# A panel as the user sees it: its no-dataset screen, its control bar, which
# of its controls are disabled and which selects still say "Loading..." (ids
# without the panel's own id, so two panels of a type compare).
STATE_JS = """(tile) => {
  const screen = tile.querySelector('.loading-screen');
  const controls = tile.querySelector('.plot-controls, .table-controls');
  const name = e => (e.id || e.className).split(tile.dataset.tileId).join('');
  const all = [...tile.querySelectorAll('.tile-content button, .tile-content input, .tile-content select')];
  return {screen: screen ? getComputedStyle(screen).display : null,
          controls: controls ? getComputedStyle(controls).display : null,
          disabled: all.filter(e => e.disabled).map(name).sort(),
          loading: all.filter(e => e.options && [...e.options].some(o => o.text === 'Loading...')).map(name).sort()};
}"""

DRAWN = {"cell-plot": ".js-plotly-plot .main-svg", "gene-plot": ".js-plotly-plot .main-svg",
         "cell-table": ".dataTables_scrollBody tbody tr"}


@pytest.mark.parametrize("panel", ["cell-plot", "gene-plot", "cell-table"])
def test_a_panel_picked_while_the_page_starts_comes_alive(server, browser, panel):
    server, store = server
    ctx = browser.new_context(viewport={"width": 1400, "height": 900})
    try:
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        held = []
        page.route("**/api/v1/datasets*", lambda route: held.append(route))
        page.goto(f"{server}/?dataset_path={urllib.parse.quote(store, safe='/')}")
        option = page.locator(f".tile-selector .panel-type-option[data-type='{panel}']").first
        option.wait_for(state="visible", timeout=30000)
        # the page waits for the listing, so no dataset is open yet
        assert held, "the dataset listing was not requested before the chooser showed"
        assert page.locator("#cell-count").text_content().strip() in ("-", "")
        option.click()
        page.wait_for_selector(f".tile[data-tile-id^='{panel}-'] .loading-screen", state="attached")
        tile = page.locator(f".tile[data-tile-id^='{panel}-']").first
        made = tile.evaluate(STATE_JS)
        assert made["screen"] != "none", made  # built without a dataset, as a user would hit it

        for route in held:
            route.continue_()
        held.clear()
        page.unroute("**/api/v1/datasets*")
        page.wait_for_function("() => /\\d/.test(document.getElementById('cell-count').textContent)",
                               timeout=30000)
        page.wait_for_selector(f".tile[data-tile-id^='{panel}-'] {DRAWN[panel]}", timeout=30000)
        page.wait_for_timeout(1000)

        state = tile.evaluate(STATE_JS)
        assert state["screen"] == "none", state
        assert state["controls"] == "flex", state
        # and its controls are as usable as those of the same panel made
        # with the dataset open (the screen had disabled them all)
        page.locator(".tile-container > .tile-selector .panel-type-option"
                     f"[data-type='{panel}']").first.click()
        fresh = page.locator(f".tile[data-tile-id^='{panel}-']").nth(1)
        fresh.locator(DRAWN[panel]).first.wait_for(timeout=30000)
        page.wait_for_timeout(1000)
        normal = fresh.evaluate(STATE_JS)
        assert state["disabled"] == normal["disabled"], (state, normal)
        assert state["loading"] == normal["loading"], (state, normal)
        assert not errors, errors
    finally:
        ctx.close()
