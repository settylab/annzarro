"""An admin controls remote datasets in the browser (Admin > Data sources).

A hosted server (gunicorn, two workers, login on): remote datasets start off.
The admin opens /admin#data, sees the Remote datasets card with its source,
turns on "Any location" (the warning is shown), then "Only these locations"
(a bad location is refused in the editor, a good one is kept), then Off. An
ordinary user's page follows each change: /auth/me says whether the server
reads remote stores, and the Change dataset field says whether a remote store
URL may be typed. A second server whose YAML turns remote datasets off shows
the card locked, with the reason.

The dataset picker's Remote place is not part of this branch's base; the user
side is checked through /auth/me and the typed-path field.

Needs Playwright with Chromium and a gunicorn executable; skipped otherwise,
unless ANNZARRO_REQUIRE_BROWSER=1 (set in CI).
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

REQUIRED = os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1"
if REQUIRED:
    import playwright.sync_api as playwright  # noqa: E402
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


def _serve(tmp_path, extra_server=""):
    gunicorn = _gunicorn()
    data = tmp_path / "data"
    data.mkdir()
    shutil.copytree(FIXTURE, data / "home.zarr")
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
{extra_server}auth:
  user_file: "{tmp_path / 'users.json'}"
""")
    env = dict(os.environ, ANNZARRO_CONFIG=str(site), ANNZARRO_HOME=str(tmp_path / "home"),
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""), PYTHONUNBUFFERED="1")
    for key in ("ANNZARRO_REMOTE_STORES", "ANNZARRO_REMOTE_ALLOWLIST"):
        env.pop(key, None)
    for args in (("--username", "alice", "--password", "alice-pw"), ("--username", "root", "--password", "root-pw", "--admin")):
        subprocess.run([sys.executable, "-m", "annzarro.cli", "user", "add", *args], env=env, cwd=REPO, check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    log = open(tmp_path / "gunicorn.log", "w")
    proc = subprocess.Popen([gunicorn, "-c", "python:annzarro.server.gunicorn_config", "--bind", f"127.0.0.1:{port}",
                             "--workers", "2", "annzarro.server.wsgi:create_wsgi_app()"],
                            env=env, cwd=str(tmp_path), stdout=log, stderr=subprocess.STDOUT)
    url = f"http://127.0.0.1:{port}"
    for _ in range(160):
        try:
            urllib.request.urlopen(url + "/login", timeout=1)
            return url, proc, log
        except OSError:
            if proc.poll() is not None:
                pytest.fail("gunicorn exited: " + (tmp_path / "gunicorn.log").read_text()[-2000:])
            time.sleep(0.25)
    proc.terminate()
    pytest.fail("gunicorn did not start")


@pytest.fixture
def server(tmp_path):
    url, proc, log = _serve(tmp_path)
    try:
        yield url, tmp_path / "data"
    finally:
        proc.terminate()                           # this test's own master, by PID
        proc.wait(15)
        log.close()


@pytest.fixture
def denied_server(tmp_path):
    url, proc, log = _serve(tmp_path, "  remote_stores: deny\n")
    try:
        yield url
    finally:
        proc.terminate()
        proc.wait(15)
        log.close()


def _sign_in(browser, url, username, password, target, scheme="light"):
    context = browser.new_context(viewport={"width": 1400, "height": 1000}, color_scheme=scheme)
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


def _me_remote(page):
    return page.evaluate("async () => (await (await fetch('api/v1/auth/me')).json()).remote_stores")


def _no_data_link(url, data):
    """A link whose store is missing: the page opens its layout without data and offers Change dataset."""
    plot = {"id": "cell-plot-K",
            "x": {"type": "obsm", "key": "X_umap", "column": "0"},
            "y": {"type": "obsm", "key": "X_umap", "column": "1"}, "z": None,
            "color": {"type": "obs", "key": "cell_type", "column": ""}}
    view = {"v": 1, "layout": {"v": 1, "hierarchy": [{"type": "tile", "id": "cell-plot-K", "controlsVisible": True}],
                               "controlState": {"cell-plot-K": True}, "panelConfigs": {"cell-plot-K": plot}}}
    payload = base64.urlsafe_b64encode(json.dumps(view, separators=(",", ":")).encode()).decode().rstrip("=")
    return f"/?dataset_path={urllib.parse.quote(str(data / 'gone.zarr'), safe='/')}#view={payload}"


def _field_label(page, link):
    """What the Change dataset field says it accepts (it follows /auth/me)."""
    page.goto(link)
    page.reload()
    page.wait_for_selector("#btn-change-dataset", state="visible", timeout=60000)
    page.click("#btn-change-dataset")
    page.wait_for_function(
        "() => document.getElementById('change-dataset-path-label').textContent.trim().startsWith('Open')", timeout=30000)
    return page.inner_text("#change-dataset-path-label")


def test_the_admin_turns_remote_datasets_on_and_off_and_the_user_page_follows(server):
    url, data = server
    link = url + _no_data_link(url, data)
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            admin_ctx, admin, admin_errors = _sign_in(browser, url, "root", "root-pw", "/admin#data")
            admin.wait_for_selector("#remote-datasets #remote-save", timeout=30000)
            assert admin.inner_text("#admin-nav .nav-link.active") == "Data sources"
            assert admin.is_checked("#remote-mode-off") and "Default" in admin.inner_text("#remote-source")
            assert admin.locator("#remote-any-warning").count() == 0

            user_ctx, user, user_errors = _sign_in(browser, url, "alice", "alice-pw", "/")
            assert _me_remote(user) is False
            assert "remote store URL" not in _field_label(user, link)

            # Any location: the warning, then saved
            admin.check("#remote-mode-any")
            warning = admin.inner_text("#remote-any-warning")
            assert "internal network" in warning and "any URL" in warning
            admin.click("#remote-save")
            admin.wait_for_selector('#remote-datasets[data-source="admin"]', timeout=30000)
            assert admin.is_checked("#remote-mode-any") and "administrator" in admin.inner_text("#remote-source")
            assert _me_remote(user) is True
            assert "remote store URL" in _field_label(user, link)

            # Only these locations: a bad one is refused, a good one is normalised and kept
            admin.check("#remote-mode-allowlist")
            admin.fill("#remote-prefix", "ftp://elsewhere/x")
            admin.click("#remote-add")
            assert "Start with" in admin.inner_text("#remote-datasets")
            admin.fill("#remote-prefix", "https://user:pw@host/z/")
            admin.click("#remote-add")
            assert "credentials" in admin.inner_text("#remote-datasets")
            admin.fill("#remote-prefix", "S3://Lab/Atlases")
            admin.click("#remote-add")
            admin.wait_for_selector('#remote-allowlist [data-prefix="s3://lab/Atlases/"]')
            admin.click("#remote-save")
            admin.wait_for_function("() => document.querySelector('#remote-save').disabled")
            admin.reload()
            admin.wait_for_selector('#remote-allowlist [data-prefix="s3://lab/Atlases/"]', timeout=30000)
            assert admin.is_checked("#remote-mode-allowlist")
            assert _me_remote(user) is True

            # Off
            admin.check("#remote-mode-off")
            admin.click("#remote-save")
            admin.wait_for_function("() => document.querySelector('#remote-save').disabled")
            assert _me_remote(user) is False
            assert "remote store URL" not in _field_label(user, link)

            # the Settings page does not carry a second control for it, and says what its switch covers
            admin.goto(url + "/admin#settings")
            admin.wait_for_selector(".policy-master", timeout=30000)
            assert admin.locator('.policy-row[data-key="feature.remote_stores"]').count() == 0
            assert "Gene Set Analysis: no external services" in admin.inner_text(".policy-master")
            assert "remote datasets" in admin.inner_text(".policy-master")
            assert not admin_errors and not user_errors, (admin_errors, user_errors)
            admin_ctx.close()
            user_ctx.close()
        finally:
            browser.close()


def test_a_yaml_setting_that_turns_it_off_shows_the_card_locked_with_the_reason(denied_server):
    url = denied_server
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            ctx, admin, errors = _sign_in(browser, url, "root", "root-pw", "/admin#data", scheme="dark")
            admin.wait_for_selector("#remote-datasets #remote-locked", timeout=30000)
            assert admin.is_disabled("#remote-mode-any") and admin.is_disabled("#remote-mode-allowlist")
            assert admin.locator("#remote-save").count() == 0
            text = admin.inner_text("#remote-locked")
            assert "server.remote_stores" in text and "restart" in text
            assert "configuration file" in admin.inner_text("#remote-source")
            assert not errors, errors
            ctx.close()
        finally:
            browser.close()
