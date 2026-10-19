"""An admin adds a data directory in the browser, and an ordinary user sees it.

A hosted server (gunicorn, two workers, login on) whose YAML names one
parent for admin-added directories. The admin signs in, opens
/admin#data, browses the parent, picks a directory and adds it. An ordinary
user's dataset picker then shows that directory as a top-level folder, with
its stores; the same user can read a store from it. The admin removes the
directory, and the picker no longer offers it and the store is refused.

Needs Playwright with Chromium and a gunicorn executable (next to this
Python, or ANNZARRO_TEST_GUNICORN); skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where either missing is an error.
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
from annzarro.tests.ui_helpers import open_browser

REQUIRED = os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1"
if REQUIRED:
    import playwright.sync_api as playwright  # noqa: E402  (required: fail, do not skip)
else:
    playwright = pytest.importorskip("playwright.sync_api")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
FIXTURE = os.path.join(os.path.dirname(HERE), "data", "fixture_small.zarr")


def _gunicorn():
    exe = os.environ.get("ANNZARRO_TEST_GUNICORN") or os.path.join(os.path.dirname(sys.executable), "gunicorn")
    if os.path.exists(exe):
        return exe
    if REQUIRED:
        pytest.fail(f"gunicorn not found at {exe} (set ANNZARRO_TEST_GUNICORN)")
    pytest.skip("gunicorn not installed")


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def server(tmp_path):
    gunicorn = _gunicorn()
    data, parent = tmp_path / "data", tmp_path / "atlases"
    data.mkdir()
    shutil.copytree(FIXTURE, data / "home.zarr")
    (parent / "lab2").mkdir(parents=True)
    shutil.copytree(FIXTURE, parent / "lab2" / "cells.zarr")
    (parent / "lab3").mkdir()
    port = _free_port()
    site = tmp_path / "site.yaml"
    site.write_text(f"""server:
  host: 127.0.0.1
  port: {port}
  data_dir: "{data}"
  log_file: "{tmp_path / 'app.log'}"
  workers: 2
  threads: 2
  refresh_min_interval_s: 0
  admin_data_roots: ["{parent}"]
auth:
  user_file: "{tmp_path / 'users.json'}"
""")
    env = dict(os.environ, ANNZARRO_CONFIG=str(site), ANNZARRO_HOME=str(tmp_path / "home"),
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""), PYTHONUNBUFFERED="1")
    for args in (("--username", "alice", "--password", "alice-pw"), ("--username", "root", "--password", "root-pw", "--admin")):
        subprocess.run([sys.executable, "-m", "annzarro.cli", "user", "add", *args], env=env, cwd=REPO, check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    log = open(tmp_path / "gunicorn.log", "w")
    proc = subprocess.Popen([gunicorn, "-c", "python:annzarro.server.gunicorn_config", "--bind", f"127.0.0.1:{port}",
                             "--workers", "2", "annzarro.server.wsgi:create_wsgi_app()"],
                            env=env, cwd=str(tmp_path), stdout=log, stderr=subprocess.STDOUT)
    url = f"http://127.0.0.1:{port}"
    try:
        for _ in range(160):
            try:
                urllib.request.urlopen(url + "/login", timeout=1)
                break
            except OSError:
                if proc.poll() is not None:
                    pytest.fail("gunicorn exited: " + (tmp_path / "gunicorn.log").read_text()[-2000:])
                time.sleep(min(0.5, 0.1 * (_ + 1)))
        else:
            pytest.fail("gunicorn did not start")
        yield url, data, parent
    finally:
        proc.terminate()                           # this test's own master, by PID
        proc.wait(15)
        log.close()


def _no_data_link(url, data):
    """A link whose store is missing: the page opens its layout without data,
    and its dataset button offers to choose one (the browser)."""
    plot = {"id": "cell-plot-K",
            "x": {"type": "obsm", "key": "X_umap", "column": "0"},
            "y": {"type": "obsm", "key": "X_umap", "column": "1"}, "z": None,
            "color": {"type": "obs", "key": "cell_type", "column": ""}}
    view = {"v": 1, "layout": {"v": 1, "hierarchy": [{"type": "tile", "id": "cell-plot-K", "controlsVisible": True}],
                               "controlState": {"cell-plot-K": True}, "panelConfigs": {"cell-plot-K": plot}}}
    payload = base64.urlsafe_b64encode(json.dumps(view, separators=(",", ":")).encode()).decode().rstrip("=")
    return f"/?dataset_path={urllib.parse.quote(str(data / 'gone.zarr'), safe='/')}#view={payload}"


def _sign_in(browser, url, username, password, target):
    context = browser.new_context(viewport={"width": 1400, "height": 900})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(url + "/login")
    page.fill("#username", username)
    page.fill("#password", password)
    page.click("button[type=submit]")
    page.wait_for_url(lambda u: "/login" not in u, timeout=30000)
    page.goto(url + target)
    return context, page, errors


def _open_browser_root(page):
    """Open the dataset browser (from the button of a view without data); its places are listed."""
    page.wait_for_selector("#dataset-button[data-state='nodata']", timeout=60000)
    open_browser(page)
    page.wait_for_selector("#dsb-places [data-place='root']", timeout=30000)


def test_an_added_directory_reaches_the_browser_and_removal_takes_it_away(server):
    url, data, parent = server
    lab2 = str(parent / "lab2")
    store = urllib.parse.quote(os.path.join(lab2, "cells.zarr"), safe="/")
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            admin_ctx, admin, admin_errors = _sign_in(browser, url, "root", "root-pw", "/admin#data")
            admin.wait_for_selector("#data-root-add", timeout=30000)
            assert lab2 not in admin.inner_text("#admin-data")

            # browse: start over at the parents, descend, use lab2, add
            admin.click("#data-root-browse")
            admin.click('#data-root-add [data-action="open-dir"]')
            admin.wait_for_selector(f'#data-root-add [data-dir="{lab2}"]')
            names = admin.eval_on_selector_all('#data-root-add [data-dir]', "els => els.map(e => e.dataset.dir)")
            assert sorted(names) == sorted([lab2, str(parent / "lab3")])
            admin.click(f'#data-root-add [data-dir="{lab2}"] [data-action="use-dir"]')
            assert admin.input_value("#data-root-path") == lab2
            admin.click("#data-root-add-button")
            admin.wait_for_selector(f'button[data-action="remove"][data-path="{lab2}"]', timeout=30000)
            row = admin.locator("tr", has=admin.locator(f'button[data-action="remove"][data-path="{lab2}"]'))
            assert "admin" in row.inner_text() and "1" in row.inner_text()   # source and store count

            # the datasets of the new root, as text
            admin.click(f'button[data-action="datasets"][data-path="{lab2}"]')
            admin.wait_for_selector("#data-root-datasets")
            assert "cells.zarr" in admin.inner_text("#data-root-datasets")

            # an ordinary user sees it at once, as a place of the browser
            user_ctx, user, user_errors = _sign_in(browser, url, "alice", "alice-pw", _no_data_link(url, data))
            _open_browser_root(user)
            place = user.locator(f'#dsb-places [data-place="folder:{lab2}"]')
            assert place.count() == 1 and "lab2" in place.inner_text()
            place.click()
            user.wait_for_selector(f'#dsb-table tr.dsb-row[data-path="{lab2}/cells.zarr"]', timeout=30000)
            opened = user.evaluate("""async (path) => (await fetch('api/v1/data/info?dataset_path=' + path)).status""", store)
            assert opened == 200

            # the search finds the store inside the admin root (from the data directory, which searches the roots too)
            user.click("#dsb-places [data-place='root']")
            user.fill("#dsb-search", "cells")
            user.wait_for_selector(f'#dsb-table tr.dsb-row[data-path="{lab2}/cells.zarr"]', timeout=30000)
            user.fill("#dsb-search", "")

            admin.click(f'button[data-action="remove"][data-path="{lab2}"]')
            admin.click(f'button[data-action="confirm-remove"][data-path="{lab2}"]')
            admin.wait_for_selector(f'button[data-action="remove"][data-path="{lab2}"]', state="detached", timeout=30000)
            user.goto(url + _no_data_link(url, data))
            user.reload()
            _open_browser_root(user)
            assert user.locator(f'#dsb-places [data-place="folder:{lab2}"]').count() == 0
            refused = user.evaluate("""async (path) => (await fetch('api/v1/data/info?dataset_path=' + path)).status""", store)
            assert refused == 403
            assert not admin_errors and not user_errors, (admin_errors, user_errors)
            admin_ctx.close()
            user_ctx.close()
        finally:
            browser.close()
