"""``/?dataset_path=<name>`` selects the dropdown's entry for that dataset.

The data directory is given as a RELATIVE path and holds a SYMLINK to a store
elsewhere (the usual way to serve a dataset). The link used to open under an
absolute path as a second dropdown entry. Needs Playwright with Chromium;
skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

import pytest
from annzarro.tests.ui_helpers import BROWSER, browser_rows, open_browser

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
FIXTURE = os.path.join(os.path.dirname(HERE), "data", "fixture_small.zarr")
SHOT = os.environ.get("ANNZARRO_SHOT_DIR")


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    base = tmp_path_factory.mktemp("dspath")
    (base / "data").mkdir()
    (base / "elsewhere").mkdir()
    shutil.copytree(FIXTURE, base / "elsewhere" / "bm_aging.zarr")
    os.symlink(base / "elsewhere" / "bm_aging.zarr", base / "data" / "bm_aging.zarr")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(base / "home"), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    # a relative data directory, as in "annzarro start --data-dir ../data"
    cwd = base / "cwd"
    cwd.mkdir()
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", "../data", "--no-browser", "--auth-disabled"],
                            env=env, cwd=cwd, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    root = f"http://127.0.0.1:{port}"
    for _ in range(160):
        try:
            urllib.request.urlopen(root + "/api/v1/config", timeout=1)
            break
        except OSError:
            time.sleep(0.25)
    else:
        proc.kill()
        pytest.fail("server did not start")
    yield root, base
    proc.terminate()
    proc.wait(10)


def test_relative_link_names_the_dataset_once_and_relative(server):
    """A link by a path relative to the data directory opens that store: the dataset button names it by that
    relative path (the one name every part of the page uses), the browser lists it once and marks it open,
    and no absolute path is shown anywhere but the tooltip."""
    root, base = server
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"{root}/?dataset_path=bm_aging.zarr")
        page.wait_for_function("() => window.annzarro && window.annzarro.getDataset().status === 'open'", timeout=30000)
        page.wait_for_timeout(1000)
        shown = page.inner_text("#dataset-button-name")
        title = page.get_attribute("#dataset-button", "title")
        tab = page.title()
        if SHOT:
            page.screenshot(path=os.path.join(SHOT, "dataset-path-link.png"))
        open_browser(page)
        rows = browser_rows(page)
        open_marks = page.locator(f"{BROWSER} .dsb-badge-open").count()
        browser.close()
    listed = [r for r in rows if "bm_aging" in r]
    assert len(listed) == 1, rows                         # no second, absolute entry
    assert open_marks == 1                                # and it is the one marked open
    assert shown == "bm_aging.zarr", shown
    assert not os.path.isabs(shown) and str(base) not in shown, shown
    assert title.splitlines()[0].endswith("bm_aging.zarr"), title        # the whole path is the tooltip
    assert tab.startswith("bm_aging.zarr"), tab
    assert not errors, errors
