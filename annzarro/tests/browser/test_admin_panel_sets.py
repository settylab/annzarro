"""The Panel sets section of the admin page, in a real browser against a real server.

An admin signs in through the login form and opens /admin#panel-sets:

* the usage strip and the table show what the quota module counts;
* selecting two of alice's sets and choosing bob moves them (the table shows
  bob, the file on disk says bob, the audit log has the record) and the toast
  says so;
* filtering to one owner offers "reassign all" and moves their other sets too;
* delete needs a second click, then removes the sets from disk;
* a hostile panel-set name is shown as text, never run as markup;
* a regular user gets 403 on the page.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import json
import os
import socket
import threading

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

expect = playwright.expect  # noqa: E402
from werkzeug.serving import make_server  # noqa: E402

from annzarro.server import session_quota  # noqa: E402
from annzarro.server.admin import audit  # noqa: E402
from annzarro.server.auth import AuthManager  # noqa: E402
from annzarro.tests.server.admin_helpers import ADMIN, PASSWORD, USER, make_app  # noqa: E402


@pytest.fixture
def served(tmp_path):
    app = make_app(tmp_path, max_sessions_per_user=4, secret_key="browser-test")
    AuthManager(user_file=app.config["user_file"]).create_user("bob", PASSWORD)
    sessions = tmp_path / "data" / "sessions"
    sessions.mkdir(parents=True, exist_ok=True)
    for name, owner in (("alice one", USER), ("alice two", USER), ("alice three", USER), ("bob one", "bob"),
                        ('<img src=x onerror="window.pwned=1">', "bob")):
        (sessions / f"{name}.json").write_text(json.dumps(
            {"name": name, "owner": owner, "dataset": "d.zarr", "modified_at": "2026-10-10T10:00:00",
             "modified_by": owner}))
    # created_at-less legacy set: owner null
    (sessions / "legacy.json").write_text(json.dumps({"name": "legacy", "dataset": "d.zarr"}))
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    server = make_server("127.0.0.1", port, app, threaded=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield app, f"http://127.0.0.1:{port}", sessions
    server.shutdown()
    thread.join(10)


@pytest.fixture(scope="module")
def browser():
    with playwright.sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


def _sign_in(browser, base, username):
    context = browser.new_context(viewport={"width": 1400, "height": 1000})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.set_default_timeout(10000)
    page.goto(f"{base}/login")
    page.fill("input[name=username]", username)
    page.fill("input[name=password]", PASSWORD)
    page.click("button[type=submit], input[type=submit]")
    page.wait_for_url(lambda url: not url.endswith("/login"))
    return context, page, errors


def _owners(sessions):
    return {p.stem: json.loads(p.read_text()).get("owner") for p in sessions.glob("*.json")}


def _open(page, base):
    page.goto(f"{base}/admin#panel-sets")
    page.wait_for_selector("#ps-table")


def _tick(page, name):
    page.locator(f'tr[data-name="{name}"] input.ps-row').check()


def test_usage_reassign_filter_and_delete(browser, served):
    app, base, sessions = served
    context, page, errors = _sign_in(browser, base, ADMIN)
    try:
        _open(page, base)
        text = page.locator("#admin-main").inner_text()
        assert "Panel sets (6)" in text and "Server: 6 / 5,000 sets" in text
        held = session_quota.entries(str(sessions))
        by_owner = {u["owner"]: u["count"] for u in session_quota.usage_by_owner(app.config, held)}
        assert by_owner == {USER: 3, "bob": 2, None: 1}
        assert "3/4" in text and "2/4" in text     # alice and bob against the limit of 4
        assert page.evaluate("window.pwned") is None
        assert page.locator('tr[data-name=\'<img src=x onerror="window.pwned=1">\']').count() == 1
        assert page.locator("#admin-main img").count() == 0

        # nothing selected: the actions are off
        assert page.locator("#ps-reassign").is_disabled() and page.locator("#ps-delete").is_disabled()

        # reassign two of alice's sets to bob
        _tick(page, "alice one")
        _tick(page, "alice two")
        page.fill("#ps-target", "bob")
        page.click("#ps-reassign")
        page.wait_for_selector(".alert-success")        # bob holds 4 of 4: at the limit, not over
        assert "2 panel sets now belong to bob" in page.locator(".alert-success").inner_text()
        page.locator('tr[data-name="alice one"]').filter(has_text="bob").wait_for()
        assert _owners(sessions)["alice one"] == "bob" and _owners(sessions)["alice two"] == "bob"
        assert _owners(sessions)["alice three"] == USER
        record = audit.read(app.admin_dir, limit=1)[0]
        assert record["action"] == "admin.panel_sets.reassign" and record["target"] == "bob"

        # filter to bob and hand all of bob's sets (now 4) to alice
        page.select_option("#ps-owner", "bob")
        expect(page.locator("#ps-table tbody tr")).to_have_count(4)
        page.fill("#ps-target", USER)
        page.click("#ps-reassign-all")
        page.wait_for_selector(".alert-warning")        # alice now holds 5 of 4: an admin may, and is told
        assert "over the per-user limit" in page.locator(".alert-warning").inner_text()
        expect(page.locator("#ps-table tbody")).to_contain_text("No panel sets")
        owners = _owners(sessions)
        assert {k: v for k, v in owners.items() if v == "bob"} == {}
        assert sum(1 for v in owners.values() if v == USER) == 5

        # delete asks twice
        page.select_option("#ps-owner", "")
        page.wait_for_selector('tr[data-name="legacy"]')
        _tick(page, "legacy")
        page.click("#ps-delete")
        assert (sessions / "legacy.json").exists()
        assert "Delete 1 for good" in page.locator("#ps-actions").inner_text()
        page.click("#ps-delete-confirm")
        page.wait_for_selector('tr[data-name="legacy"]', state="detached")
        assert not (sessions / "legacy.json").exists()
        assert audit.read(app.admin_dir, limit=1)[0]["action"] == "admin.panel_sets.delete"
        assert not errors, errors
    finally:
        context.close()


def test_a_refused_reassignment_is_shown_and_changes_nothing(browser, served):
    app, base, sessions = served
    context, page, errors = _sign_in(browser, base, ADMIN)
    try:
        _open(page, base)
        before = _owners(sessions)
        _tick(page, "alice one")
        page.fill("#ps-target", "bob")
        (sessions / "alice one.json").unlink()          # deleted by someone else meanwhile
        page.click("#ps-reassign")
        page.wait_for_selector(".alert-danger")
        assert "do not exist" in page.locator(".alert-danger").inner_text()
        assert _owners(sessions) == {k: v for k, v in before.items() if k != "alice one"}
    finally:
        context.close()


def test_a_regular_user_cannot_open_the_page(browser, served):
    _, base, _ = served
    context, page, _ = _sign_in(browser, base, USER)
    try:
        response = page.goto(f"{base}/admin#panel-sets")
        assert response.status == 403
        assert page.locator("#ps-table").count() == 0
    finally:
        context.close()
