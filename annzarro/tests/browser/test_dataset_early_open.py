"""A click on the dataset button, or Ctrl+O, before the app has started opens the browser once, after it has.

The button is in the page's HTML and main.js wires it partway through its start. js/early-open.js
records the request until then. The page is loaded with the CPU throttled 20x (Chrome DevTools
Protocol), so that the request comes in well before the start has finished. Needs Playwright with
Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
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
    base = tmp_path_factory.mktemp("early")
    (base / "data").mkdir()
    shutil.copytree(FIXTURE, base / "data" / "cells.zarr")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(base / "home"), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", str(base / "data"), "--no-browser", "--auth-disabled"],
                            env=env, cwd=base, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    root = f"http://127.0.0.1:{port}"
    for _ in range(160):
        try:
            urllib.request.urlopen(root + "/api/v1/config", timeout=1)
            break
        except OSError:
            time.sleep(0.25)
    else:
        proc.kill()
        pytest.fail("the server did not start")
    try:
        yield root
    finally:
        proc.terminate()
        proc.wait(15)


def _early_page(browser, root):
    page = browser.new_context(viewport={"width": 1400, "height": 900}).new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.context.new_cdp_session(page).send("Emulation.setCPUThrottlingRate", {"rate": 20})
    page.goto(root + "/", wait_until="commit")
    return page, errors


def _opens_once_after_start(page, ask):
    """``ask()`` as soon as the button records requests; the dialog then opens once, after the app has started."""
    page.wait_for_function("() => !!window.annzarroEarlyOpen", timeout=60000)   # the button is there and recording
    ask()
    page.wait_for_selector("#dataset-browser", state="visible", timeout=60000)
    assert page.evaluate("() => window.annzarro && !!window.annzarro.getDataset"), "opened only once the app was running"
    page.wait_for_timeout(1500)
    assert page.locator("#dataset-browser.show, #dataset-browser[open]").count() <= 1
    assert page.locator(".modal-backdrop").count() <= 1, "opened twice"
    assert page.get_attribute("#dataset-button", "aria-busy") is None


@pytest.mark.parametrize("how", ["click", "double-click", "ctrl-o"])
def test_a_request_before_the_app_started_opens_the_browser_once(server, how):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page, errors = _early_page(browser, server)
            if how == "click":
                ask = lambda: page.locator("#dataset-button").dispatch_event("click")   # noqa: E731
            elif how == "double-click":
                ask = lambda: (page.locator("#dataset-button").dispatch_event("click"),  # noqa: E731
                               page.locator("#dataset-button").dispatch_event("click"))
            else:
                ask = lambda: page.keyboard.press("Control+o")   # noqa: E731
            _opens_once_after_start(page, ask)
            assert not errors, errors
        finally:
            browser.close()
