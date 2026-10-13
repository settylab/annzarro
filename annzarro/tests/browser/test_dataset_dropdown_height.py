"""The open dataset list is tall, follows the window, and has one scrollbar.

With 45 datasets of long names the list used to show a few entries: select2's
200px results list inside a 400px dropdown cap. It now takes up to
min(70vh, 640px), the dropdown fits inside the window at 1440x900 and
1280x700, and the gene and cell dropdowns keep their own rules.

Needs Playwright with Chromium; skipped without it, or failed when
ANNZARRO_REQUIRE_BROWSER=1. Starts the server on a free 127.0.0.1 port.
"""
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

import pytest

REQUIRE = os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1"
if REQUIRE:
    import playwright.sync_api as sync_api
else:
    sync_api = pytest.importorskip("playwright.sync_api")

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(os.path.dirname(HERE), "data", "fixture_small.zarr")
SHOTS = os.environ.get("DATASET_HEIGHT_SHOTS")
NAMES = [f"liver_met_batch{i:02d}_harmony_integrated_doublets_removed_sharded_csc_float32_v{i % 7}.zarr"
         for i in range(45)]
BOX = "#dataset-selector + .select2-container"
DROPDOWN = ".select2-dropdown.dataset-select-dropdown"


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("dropdown_height")
    data = tmp / "data"
    data.mkdir()
    for name in NAMES:
        shutil.copytree(FIXTURE, data / name)
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
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
    yield base
    proc.terminate()
    proc.wait(20)


def _open(browser, base, width, height, scheme="light"):
    page = browser.new_page(viewport={"width": width, "height": height}, color_scheme=scheme)
    page.goto(base + "/")
    page.wait_for_selector(BOX, timeout=60_000)
    page.wait_for_function("document.querySelectorAll('#dataset-selector option').length >= 40")
    page.click(BOX)
    page.wait_for_selector(DROPDOWN + " .select2-results__option")
    return page


@pytest.mark.parametrize("size", [(1440, 900), (1280, 700)])
@pytest.mark.parametrize("scheme", ["light", "dark"])
def test_the_list_is_tall_fits_the_window_and_has_one_scrollbar(server, size, scheme):
    width, height = size
    with sync_api.sync_playwright() as pw:
        browser = pw.chromium.launch()
        try:
            page = _open(browser, server, width, height, scheme)
            if SHOTS:
                page.wait_for_timeout(600)       # select2's fade-in
                os.makedirs(SHOTS, exist_ok=True)
                page.screenshot(path=os.path.join(SHOTS, f"{width}x{height}-{scheme}.png"))
            drop = page.locator(DROPDOWN).bounding_box()
            results = page.locator(DROPDOWN + " .select2-results__options").bounding_box()
            assert results["height"] >= 0.5 * height, f"list {results['height']}px of a {height}px window"
            assert results["height"] <= min(0.7 * height, 640) + 1
            assert drop["y"] >= 0 and drop["y"] + drop["height"] <= height, f"dropdown off screen: {drop}"
            assert page.evaluate("document.documentElement.scrollHeight <= window.innerHeight + 1"), "page scrolls"
            assert page.is_visible(DROPDOWN + " .select2-search__field"), "the search box stays visible"
            scrolls = page.eval_on_selector_all(
                DROPDOWN + ", " + DROPDOWN + " .select2-results, " + DROPDOWN + " .select2-results__options",
                "els => els.map(e => e.scrollHeight > e.clientHeight + 1 && ['auto','scroll'].includes(getComputedStyle(e).overflowY))")
            assert sum(scrolls) == 1, f"one scrollbar expected, found {scrolls}"
        finally:
            browser.close()


def test_a_short_window_with_the_box_low_flips_the_list_above(server):
    with sync_api.sync_playwright() as pw:
        browser = pw.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1280, "height": 700})
            page.goto(server + "/")
            page.wait_for_selector(BOX, timeout=60_000)
            page.wait_for_function("document.querySelectorAll('#dataset-selector option').length >= 40")
            # push the box to the bottom of a window that is tall enough to scroll
            page.evaluate("""() => { const b = document.querySelector('%s');
                b.style.position = 'fixed'; b.style.top = '600px'; b.style.left = '40px'; b.style.width = '420px'; }""" % BOX)
            page.click(BOX)
            page.wait_for_selector(DROPDOWN + " .select2-results__option")
            drop = page.locator(DROPDOWN).bounding_box()
            assert drop["y"] >= 0 and drop["y"] + drop["height"] <= 700, f"dropdown off screen: {drop}"
        finally:
            browser.close()
