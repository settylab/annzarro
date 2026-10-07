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


def test_relative_link_selects_the_existing_entry(server):
    root, base = server
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"{root}/?dataset_path=bm_aging.zarr")
        page.wait_for_function("() => document.getElementById('dataset-path')"
                               " && document.getElementById('dataset-path').textContent.trim().length > 0"
                               " && !document.getElementById('dataset-path').textContent.includes('Loading')",
                               timeout=30000)
        page.wait_for_timeout(1500)
        options = page.eval_on_selector_all("#dataset-selector option", "os => os.map(o => [o.value, o.text, o.selected])")
        shown = page.inner_text("#dataset-path")
        if SHOT:
            page.screenshot(path=os.path.join(SHOT, "dataset-path-link.png"))
        browser.close()
    listed = [o for o in options if o[0] and "bm_aging" in o[0] + o[1]]
    assert len(listed) == 1, options                      # no second, absolute entry
    assert listed[0][2], options                          # and it is the selected one
    assert not any(o[0].startswith("/") for o in options), options
    assert not os.path.isabs(shown) and str(base) not in shown, shown
    assert not errors, errors
