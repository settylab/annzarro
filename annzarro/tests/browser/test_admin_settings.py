"""The Settings tab in a real browser (admin slice S).

A server with login on and a small policy registry (tests/server/settings_helpers.py:
the real registry has no writable key until the panel keys land). Signs in as
the admin through the login form, opens /admin#settings, then:

* changes a number: the row says "admin" and what it inherits, and the value
  is served by /api/v1/policy/effective to another user;
* resets it: back to the default, no stored value left;
* a key the config file locks shows its lock and no input; a read-only limit
  shows its value; a change the config file's ceiling refuses is shown on the
  row, the switch snaps back and nothing is stored;
* an unknown stored key is listed, flagged, and removed with its button.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import json
import os
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

from annzarro.tests.server.admin_helpers import ADMIN, PASSWORD, USER  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
SERVER = os.path.join(os.path.dirname(HERE), "server", "settings_helpers.py")


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    root = tmp_path_factory.mktemp("settings")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(root / "home"), PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    proc = subprocess.Popen([sys.executable, SERVER, str(root), str(port)], env=env, cwd=REPO,
                            stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    url = f"http://127.0.0.1:{port}"
    for _ in range(120):
        try:
            urllib.request.urlopen(url + "/login", timeout=1)
            break
        except OSError:
            time.sleep(0.25)
    else:
        proc.kill()
        pytest.fail("server did not start")
    yield url, root / "users" / "annzarro_admin"
    proc.terminate()
    proc.wait(10)


@pytest.fixture(scope="module")
def browser():
    with playwright.sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


def _sign_in(page, url, user):
    page.goto(url + "/login")
    page.fill("input[name=username]", user)
    page.fill("input[name=password]", PASSWORD)
    page.click("button[type=submit], input[type=submit]")
    page.wait_for_load_state("networkidle")


@pytest.fixture
def admin_page(browser, server):
    url, _ = server
    context = browser.new_context(viewport={"width": 1300, "height": 1000})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    _sign_in(page, url, ADMIN)
    page.goto(url + "/admin#settings")
    page.wait_for_selector('.policy-row[data-key="t.limit"]')
    yield page
    assert not errors, errors
    context.close()


def _row(page, name):
    return page.locator(f'.policy-row[data-key="{name}"]')


def _stored(admin_dir):
    path = admin_dir / "overlay.json"
    return json.loads(path.read_text()) if path.exists() else {}


def test_change_a_value_then_reset_it(admin_page, server):
    url, admin_dir = server
    row = _row(admin_page, "t.limit")
    assert row.locator(".badge").inner_text() == "default"
    assert row.locator("button", has_text="reset").count() == 0
    box = row.locator("input[type=number]")
    box.fill("3")
    box.dispatch_event("change")
    admin_page.wait_for_selector('.policy-row[data-key="t.limit"] .policy-inherited')
    row = _row(admin_page, "t.limit")
    assert row.locator(".badge").inner_text() == "admin"
    assert row.locator(".policy-inherited").inner_text() == "inherited: 5"
    assert row.locator("input[type=number]").input_value() == "3"
    assert _stored(admin_dir)["policy"] == {"t.limit": 3}
    # served to another user on their next request
    reply = admin_page.context.browser.new_context().request.get(url + "/api/v1/policy/effective")
    assert reply.status == 401
    other = admin_page.context.browser.new_context()
    _sign_in(other.new_page(), url, USER)
    assert other.request.get(url + "/api/v1/policy/effective").json()["values"]["t.limit"] == 3
    other.close()
    row.locator("button", has_text="reset").click()
    admin_page.wait_for_function("() => !document.querySelector('.policy-row[data-key=\"t.limit\"] .policy-inherited')")
    row = _row(admin_page, "t.limit")
    assert row.locator(".badge").inner_text() == "default"
    assert row.locator("input[type=number]").input_value() == "5"
    assert "policy" not in _stored(admin_dir)


def test_a_locked_key_and_a_read_only_limit(admin_page):
    locked = _row(admin_page, "t.mode")
    assert locked.locator(".badge").inner_text() == "locked"
    assert locked.locator('[aria-label="locked"]').count() == 1
    assert locked.locator("select").count() == 0
    assert locked.locator(".policy-readonly-value").inner_text() == "ask"
    assert locked.locator("button", has_text="reset").count() == 0
    limit = _row(admin_page, "t.fixed")
    assert limit.locator("input").count() == 0
    assert limit.locator(".policy-readonly-value").inner_text() == "9"
    assert "config file" in limit.inner_text()


def test_a_refused_change_is_shown_and_not_applied(admin_page, server):
    _, admin_dir = server
    # the config file sets t.switch off, and an admin may narrow a restrict key but not widen it
    row = _row(admin_page, "t.switch")
    assert row.locator(".badge").inner_text() == "config"
    switch = row.locator("input[type=checkbox]")
    assert not switch.is_checked()
    switch.click()
    admin_page.wait_for_selector('.policy-row[data-key="t.switch"] [role=alert]:not([hidden])')
    assert "does not allow a wider value" in row.locator("[role=alert]").inner_text()
    assert not switch.is_checked(), "the switch snaps back"
    assert "policy" not in _stored(admin_dir)


def test_an_unknown_stored_key_is_flagged_and_can_be_removed(admin_page, server):
    url, admin_dir = server
    path = admin_dir / "overlay.json"
    data = _stored(admin_dir) or {"version": 1}
    data["policy"] = {"t.gone": True}
    path.write_text(json.dumps(data))
    admin_page.reload()
    admin_page.wait_for_selector(".policy-unknown")
    box = admin_page.locator(".policy-unknown")
    assert "t.gone" in box.inner_text() and "not a setting" in box.inner_text()
    box.locator("button", has_text="remove").click()
    admin_page.wait_for_selector(".policy-unknown", state="detached")
    assert "policy" not in _stored(admin_dir)
