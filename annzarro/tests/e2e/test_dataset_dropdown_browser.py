"""The dataset dropdown in a real (headless) browser.

With long dataset names the open list is wider than the closed box, stays
inside the viewport (also at a narrow width), and every entry and the closed
box carry the full name and path as a ``title``.

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


def _skip_or_fail(reason):
    if REQUIRE:
        pytest.fail(f"{reason} (ANNZARRO_REQUIRE_BROWSER=1)")
    pytest.skip(reason)


try:
    from playwright import sync_api
except ImportError:  # pragma: no cover - depends on the environment
    sync_api = None

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(os.path.dirname(HERE), "data", "fixture_small.zarr")
NAMES = ["short.zarr", "a_rather_long_dataset_name_" + "x" * 60 + "_final_v12.zarr",
         "BR_2453_v3layout_PILOT_not_for_annotation.zarr"]


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
    tmp = tmp_path_factory.mktemp("dropdown")
    data = tmp / "data"
    data.mkdir()
    for name in NAMES:
        shutil.copytree(FIXTURE, data / name)
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
    yield base, str(data)
    proc.terminate()
    proc.wait(20)


@pytest.mark.parametrize("width", [1280, 480])
def test_open_list_is_wider_than_the_box_inside_the_viewport_with_titles(server, width):
    base, data = server
    with sync_api.sync_playwright() as pw:
        try:
            browser = pw.chromium.launch()
        except Exception as exc:  # no browser binary
            _skip_or_fail(f"Chromium cannot start: {exc}")
        try:
            page = browser.new_page(viewport={"width": width, "height": 800})
            page.goto(base + "/")
            box_sel = "#dataset-selector + .select2-container"
            page.wait_for_selector(box_sel, timeout=60_000)
            page.wait_for_function("document.querySelectorAll('#dataset-selector option').length >= 2")
            box = page.locator(box_sel).bounding_box()
            page.click(box_sel)
            page.wait_for_selector(".dataset-select-dropdown .select2-results__option")
            drop = page.locator(".select2-dropdown.dataset-select-dropdown").bounding_box()
            assert drop["width"] >= box["width"]
            assert drop["x"] >= 0 and drop["x"] + drop["width"] <= width + 0.5, "inside the viewport"
            if width >= 1000:
                assert drop["width"] > box["width"] + 20, "wider than the closed box"
            titles = page.eval_on_selector_all(".dataset-select-dropdown .select2-results__option",
                                               "els => els.map(e => e.title)")
            assert sorted(titles) == sorted(f"{n}\n{os.path.join(data, n)}" for n in NAMES), titles
            page.click(".dataset-select-dropdown .select2-results__option")
            page.wait_for_selector(".select2-dropdown", state="detached", timeout=10_000)
            selected = page.get_attribute(box_sel + " .select2-selection__rendered", "title")
            assert selected in titles, "the closed box shows the same title"
        finally:
            browser.close()


@pytest.mark.parametrize("width", [1280, 1440, 1600, 1920])
@pytest.mark.parametrize("badge", [False, True])
def test_refresh_button_stays_beside_the_box_with_long_names(server, width, badge):
    """Refresh sits level with the dataset box (not wrapped under it), however long the
    selected name, with the auth badge shown; the open list is still wider than the box."""
    base, _ = server
    with sync_api.sync_playwright() as pw:
        try:
            browser = pw.chromium.launch()
        except Exception as exc:  # no browser binary
            _skip_or_fail(f"Chromium cannot start: {exc}")
        try:
            page = browser.new_page(viewport={"width": width, "height": 1000})
            page.goto(base + "/")
            box_sel = "#dataset-selector + .select2-container"
            page.wait_for_selector(box_sel, timeout=60_000)
            page.wait_for_function("document.querySelectorAll('#dataset-selector option').length >= 3")
            page.select_option("#dataset-selector", index=1)  # the long name
            page.wait_for_timeout(1000)
            if badge:
                page.evaluate("""() => { const a = document.getElementById('auth-indicator');
                    a.textContent = 'Signed in: a.long.username@example.org'; a.hidden = false; }""")
            box = page.locator(box_sel).bounding_box()
            btn = page.locator("#refresh-dataset").bounding_box()
            assert abs(btn["y"] - box["y"]) < 6, f"Refresh wrapped: box {box}, button {btn}"
            assert btn["x"] >= box["x"] + box["width"] - 1, "button beside the box, not over it"
            hdr = page.locator("#app-header").bounding_box()
            assert hdr["height"] < 100, hdr
            page.click(box_sel)
            page.wait_for_selector(".dataset-select-dropdown .select2-results__option")
            drop = page.locator(".select2-dropdown.dataset-select-dropdown").bounding_box()
            assert drop["width"] > box["width"] + 20
        finally:
            browser.close()
