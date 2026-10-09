"""The running version is visible in the header without taking space.

The app title carries a native tooltip "AnnZarro <version>" and, with login
on, the signed-in badge's tooltip ends with the same line. The version is the
one the server reports in /api/v1/config.

Needs Playwright with Chromium; skipped without it, or failed when
ANNZARRO_REQUIRE_BROWSER=1.
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
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


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _start(tmp, extra):
    if sync_api is None:
        _skip_or_fail("Playwright is not installed")
    if not os.path.isdir(os.path.join(os.path.dirname(os.path.dirname(HERE)), "..", "static", "vendor")):
        _skip_or_fail("static/vendor is not provisioned")
    data = tmp / "data"
    data.mkdir()
    shutil.copytree(FIXTURE, data / "fixture_small.zarr")
    # run this checkout's package, whatever else is installed in the environment
    repo = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
    env = dict(os.environ, ANNZARRO_HOME=str(tmp / "home"), ANNZARRO_HEADLESS="1", PYTHONPATH=repo)
    port = _free_port()
    if "--auth-disabled" not in extra:
        subprocess.run([sys.executable, "-m", "annzarro.cli", "user", "add", "--username", "ada",
                        "--password", "correct-horse-battery"], env=env, cwd=tmp, check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--port", str(port),
                             "--data-dir", str(data), "--no-browser", *extra],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env, cwd=tmp)
    base = f"http://127.0.0.1:{port}"
    for _ in range(300):
        try:
            urllib.request.urlopen(base + "/api/v1/config", timeout=1)
            break
        except urllib.error.HTTPError:  # 401: the server is up and wants a login
            break
        except OSError:
            time.sleep(0.1)
    else:
        proc.kill()
        pytest.fail("server did not start")
    return proc, base


@pytest.fixture(scope="module")
def plain_server(tmp_path_factory):
    proc, base = _start(tmp_path_factory.mktemp("ver"), ["--host", "127.0.0.1", "--auth-disabled"])
    with urllib.request.urlopen(base + "/api/v1/config") as r:
        version = json.load(r)["annzarro_version"]
    yield base, version
    proc.terminate()
    proc.wait(20)


@pytest.fixture(scope="module")
def auth_server(tmp_path_factory):
    # a non-loopback bind turns login on; the browser still reaches it on 127.0.0.1
    proc, base = _start(tmp_path_factory.mktemp("verauth"), ["--host", "0.0.0.0"])
    yield base
    proc.terminate()
    proc.wait(20)


def _browser(pw):
    try:
        return pw.chromium.launch()
    except Exception as exc:  # no browser binary
        _skip_or_fail(f"Chromium cannot start: {exc}")


def test_title_tooltip_has_the_servers_version(plain_server):
    base, version = plain_server
    assert version
    with sync_api.sync_playwright() as pw:
        browser = _browser(pw)
        try:
            page = browser.new_page()
            page.goto(base)
            page.wait_for_function("document.querySelector('.app-title').title !== ''", timeout=60_000)
            assert page.get_attribute(".app-title", "title") == f"AnnZarro {version}"
        finally:
            browser.close()


def test_account_badge_shows_the_version_when_login_is_on(auth_server):
    base = auth_server
    with sync_api.sync_playwright() as pw:
        browser = _browser(pw)
        try:
            page = browser.new_page()
            page.goto(base)
            page.fill("#username", "ada")
            page.fill("#password", "correct-horse-battery")
            page.click("button[type=submit]")
            page.wait_for_selector("#auth-indicator:not([hidden])", timeout=60_000)
            version = page.evaluate("fetch('/api/v1/config').then(r => r.json()).then(c => c.annzarro_version)")
            assert version
            page.wait_for_function("document.querySelector('#auth-indicator').title.includes('AnnZarro')",
                                   timeout=30_000)
            title = page.get_attribute("#auth-indicator", "title")
            assert title.endswith(f"AnnZarro {version}") and "Signed in as ada" in title
            assert page.get_attribute(".app-title", "title") == f"AnnZarro {version}"
        finally:
            browser.close()
