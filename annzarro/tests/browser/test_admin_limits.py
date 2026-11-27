"""The Limits of the admin Settings page in a real browser: the cost limits an administrator changes at run time.

A server with login on, the real policy registry, and `limits: {groups: 1000}` in its config file. Signed in as the
admin through the login form, /admin#settings:

* the Limits area is in its headings, in order, the cost limits first and the server's resources last;
* a limit the config file sets says "config" and its default; raising it past the file is refused on the row;
* a change says "admin" and its default, is stored, and is served to a user by /api/v1/policy/effective;
* a change that breaks live update <= ask first <= refuse is refused on the row, naming the other limit, and
  nothing is stored;
* "Reset all" clears every limit the admin set in one change: each is back to its default, the file's value kept.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import json
import os
import socket
import subprocess
import sys
import threading
import urllib.request

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.server.admin_helpers import ADMIN, PASSWORD, USER  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
# make_server listens once built: "ready" on stdout says the port is open, so the test waits on a line, not a clock
SERVE = ("import sys; from pathlib import Path; from werkzeug.serving import make_server; "
         "from annzarro.tests.server.admin_helpers import make_app; "
         "app = make_app(Path(sys.argv[1]), limits={'groups': 1000}); "
         "server = make_server('127.0.0.1', int(sys.argv[2]), app, threaded=True); "
         "print('ready', flush=True); server.serve_forever()")


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    root = tmp_path_factory.mktemp("limits")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(root / "home"), PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    proc = subprocess.Popen([sys.executable, "-c", SERVE, str(root), str(port)], env=env, cwd=REPO,
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    url = f"http://127.0.0.1:{port}"
    line = proc.stdout.readline()                  # "ready", or "" when the process ended without listening
    if line.strip() != "ready":
        proc.kill()
        pytest.fail(f"server did not start: {line!r}")
    threading.Thread(target=proc.stdout.read, daemon=True).start()
    assert urllib.request.urlopen(url + "/login", timeout=10).status == 200
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
    page.wait_for_selector('.policy-row[data-key="limits.groups"]')
    yield page
    assert not errors, errors
    context.close()


def _row(page, name):
    return page.locator(f'.policy-row[data-key="{name}"]')


def _stored(admin_dir):
    path = admin_dir / "overlay.json"
    return json.loads(path.read_text()).get("policy", {}) if path.exists() else {}


def _set(page, name, value):
    box = _row(page, name).locator("input[type=number]")
    box.fill(str(value))
    box.dispatch_event("change")


def _served(browser, url, name):
    other = browser.new_context()
    _sign_in(other.new_page(), url, USER)
    value = other.request.get(url + "/api/v1/policy/effective").json()["values"][name]
    other.close()
    return value


def test_the_limits_are_under_their_headings_in_order(admin_page):
    limits = admin_page.locator('.policy-group[data-area="limits"]')
    headings = limits.locator(".policy-subgroup h3").all_inner_texts()
    assert headings == ["When to ask and refuse", "Groupings, matrices and grids", "Drawn and exported in the browser",
                        "Server resources"], headings
    time_rows = limits.locator('.policy-subgroup[data-subgroup="When to ask and refuse"] .policy-row')
    assert time_rows.evaluate_all("rs => rs.map(r => r.dataset.key)") == [
        "limits.ask_first_s", "limits.live_update_s", "limits.progress_bar_s", "limits.refresh_large_cells",
        "limits.refresh_min_interval_large_s", "limits.refuse_s", "limits.try_max_s"]
    assert _row(admin_page, "limits.compute_budget_mb").locator("input").count() == 0      # read at start
    assert _row(admin_page, "limits.dataset_folder_max_entries").locator("input[type=number]").count() == 1


def test_a_limit_of_the_config_file_shows_its_default_and_cannot_be_raised(admin_page, server):
    _, admin_dir = server
    row = _row(admin_page, "limits.groups")
    assert row.locator(".badge").inner_text() == "config"
    assert row.locator("input[type=number]").input_value() == "1000"
    assert row.locator(".policy-default").inner_text() == "default: 2,000"
    _set(admin_page, "limits.groups", 1500)
    admin_page.wait_for_selector('.policy-row[data-key="limits.groups"] [role=alert]:not([hidden])')
    assert "does not allow a wider value" in row.locator("[role=alert]").inner_text()
    assert "limits.groups" not in _stored(admin_dir)


def test_a_change_is_stored_and_served_and_reset_all_restores_the_defaults(admin_page, server, browser):
    url, admin_dir = server
    assert admin_page.locator(".policy-reset-all").count() == 0
    row = _row(admin_page, "limits.matrix_values")
    assert row.locator(".policy-default").count() == 0                          # at its default, nothing to say
    _set(admin_page, "limits.matrix_values", 1000)
    admin_page.wait_for_selector('.policy-row[data-key="limits.matrix_values"] .policy-default')
    row = _row(admin_page, "limits.matrix_values")
    assert row.locator(".badge").inner_text() == "admin"
    assert row.locator(".policy-default").inner_text() == "default: 400,000"
    assert _stored(admin_dir)["limits.matrix_values"] == 1000
    assert _served(browser, url, "limits.matrix_values") == 1000
    _set(admin_page, "limits.bars_3d_max", 500)
    admin_page.wait_for_selector('.policy-row[data-key="limits.bars_3d_max"] .policy-default')
    _set(admin_page, "limits.groups", 900)                                       # under the file's 1000: taken
    admin_page.wait_for_selector('.policy-row[data-key="limits.groups"] .badge:text-is("admin")')
    reset = admin_page.locator(".policy-reset-all")
    assert reset.inner_text() == "Reset all 3 limits"
    reset.click()
    admin_page.wait_for_selector(".policy-reset-all", state="detached")
    assert _stored(admin_dir) == {}
    for name, value, badge in (("limits.matrix_values", "400000", "default"), ("limits.bars_3d_max", "40000", "default"),
                               ("limits.groups", "1000", "config")):
        row = _row(admin_page, name)
        assert row.locator("input[type=number]").input_value() == value, name
        assert row.locator(".badge").inner_text() == badge, name
    assert _served(browser, url, "limits.groups") == 1000


def test_a_tier_out_of_order_is_refused_on_the_row_and_not_stored(admin_page, server):
    _, admin_dir = server
    _set(admin_page, "limits.refuse_s", 30)
    admin_page.wait_for_selector('.policy-row[data-key="limits.refuse_s"] [role=alert]:not([hidden])')
    said = _row(admin_page, "limits.refuse_s").locator("[role=alert]").inner_text()
    assert said == ("Refuse above (s) is 30, below ask_first_s (60); lower ask_first_s first "
                    "(live_update_s <= ask_first_s <= refuse_s)."), said
    assert "limits.refuse_s" not in _stored(admin_dir)
    assert _row(admin_page, "limits.refuse_s").locator("input[type=number]").input_value() == "600"
