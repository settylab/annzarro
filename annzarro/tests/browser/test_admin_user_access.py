"""The Access panel of /admin, in a browser against a real server.

An administrator opens the Access panel of ``bob`` (an external collaborator) on the Users tab:
restricts him, grants one store and one folder (typing a path, and browsing the data directories),
checks a path, lists the effective stores, and sees the summaries on the Users and Data directories
tabs. Meanwhile ``bob``, signed in from another browser context, sees exactly the granted datasets
and nothing else; after the administrator revokes the grants he reads nothing. No script error or
CSP violation anywhere.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os
import shutil
import socket
import threading

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from werkzeug.serving import make_server  # noqa: E402

from annzarro.server.auth import AuthManager  # noqa: E402
from annzarro.server.core import create_app  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(os.path.dirname(HERE), "data", "fixture_small.zarr")
PASSWORD = "pw-for-browser-tests"


@pytest.fixture
def served(tmp_path):
    data = tmp_path / "data"
    for rel in ("in.zarr", "out.zarr", "pub/p.zarr", "hidden/deep.zarr"):
        (data / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(FIXTURE, data / rel)
    manager = AuthManager(user_file=str(tmp_path / "users.json"))
    for name, admin in (("alice", True), ("bob", False)):
        manager.add_user(name, PASSWORD, is_admin=admin)
    app = create_app({"TESTING": True, "host": "127.0.0.1", "data_dir": str(data), "log_file": str(tmp_path / "t.log"),
                      "auth_enabled": True, "user_file": str(tmp_path / "users.json"), "secret_key": "browser-test"})
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    server = make_server("127.0.0.1", port, app, threaded=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{port}", str(data)
    server.shutdown()
    thread.join(10)


def sign_in(browser, base, username, to="/"):
    context = browser.new_context(viewport={"width": 1400, "height": 1000})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.set_default_timeout(20000)
    page.goto(f"{base}/login")
    page.fill("input[name=username]", username)
    page.fill("input[name=password]", PASSWORD)
    page.click("button[type=submit], input[type=submit]")
    page.wait_for_url(lambda url: not url.endswith("/login"))
    if to != "/":
        page.goto(base + to)
    return page, errors


def status(page, path):
    return page.evaluate("async (p) => (await fetch(p)).status", path)


def info_status(page, path):
    return page.evaluate("async (p) => (await fetch('/api/v1/data/info?dataset_path=' + encodeURIComponent(p))).status", path)


def dropdown(page):
    """The collaborator's own dataset dropdown listing, as one string."""
    return page.evaluate("async () => JSON.stringify(await (await fetch('/api/v1/datasets')).json())")


def user_row(page, name):
    return page.locator("#admin-main tbody tr").filter(has=page.locator("td", has_text=name)).first


def test_grant_a_collaborator_see_only_the_grants_then_revoke(served):
    base, data = served
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            admin, admin_errors = sign_in(browser, base, "alice", "/admin#users")
            bob, bob_errors = sign_in(browser, base, "bob")
            admin.wait_for_selector("#admin-main tbody tr")
            assert info_status(bob, os.path.join(data, "out.zarr")) == 200, "unrestricted by default"
            assert "all" in user_row(admin, "bob").inner_text()

            # open bob's panel
            user_row(admin, "bob").locator('button[data-action="access"]').click()
            admin.wait_for_selector("#user-access #access-restricted")
            assert "reads every dataset" in admin.inner_text("#access-note")
            assert admin.locator("#access-policy").count() == 1       # the settings block is part of the panel

            # restrict him: with no grant he reads nothing
            sent = []
            admin.on("request", lambda r: sent.append(r) if r.method == "PUT" else None)
            admin.click("#access-restricted")
            admin.wait_for_selector("#access-confirm-box")
            assert "bob will lose access to everything now" in admin.inner_text("#access-confirm-box")
            assert sent == [], "one click on the box must not send the change"
            assert not admin.is_checked("#access-restricted")
            assert info_status(bob, os.path.join(data, "out.zarr")) == 200, "nothing changed yet"
            admin.click('button[data-action="confirm-access"]')
            admin.wait_for_function("() => document.getElementById('access-note')?.innerText.includes('reads nothing')")
            assert len(sent) == 1
            assert info_status(bob, os.path.join(data, "in.zarr")) == 404
            assert "reads nothing" in user_row(admin, "bob").inner_text()

            # grant one store by typing its path
            admin.check("#access-mode-store")
            admin.fill("#access-grant-path", os.path.join(data, "in.zarr"))
            admin.click("#access-grant-button")
            admin.wait_for_selector('#access-grants tr:has-text("in.zarr")')

            # and a folder by browsing the data directories
            admin.check("#access-mode-dir")
            admin.click('#access-grant-form button[data-action="browse"]')
            admin.click("#access-browse button[data-action=open-dir]")
            admin.wait_for_selector('#access-browse [data-entry="pub"]')
            admin.locator('#access-browse [data-entry="pub"] button[data-action=use-entry]').click()
            assert admin.input_value("#access-grant-path") == os.path.join(os.path.realpath(data), "pub") \
                or admin.input_value("#access-grant-path").endswith("/pub")
            admin.click("#access-grant-button")
            admin.wait_for_selector('#access-grants tr:has-text("pub")')
            assert "restricted: 2 grants" in user_row(admin, "bob").inner_text()

            # what he now reads, and nothing else
            assert info_status(bob, os.path.join(data, "in.zarr")) == 200
            assert info_status(bob, os.path.join(data, "pub", "p.zarr")) == 200
            assert info_status(bob, os.path.join(data, "out.zarr")) == 404
            assert info_status(bob, os.path.join(data, "hidden", "deep.zarr")) == 404
            listed = dropdown(bob)
            assert "in.zarr" in listed and "p.zarr" in listed
            assert "out.zarr" not in listed and "deep.zarr" not in listed
            bob.goto(base + "/")
            bob.wait_for_selector("#dataset-selector", state="attached")
            assert "out.zarr" not in bob.inner_html("#dataset-selector") and "deep.zarr" not in bob.inner_html("#dataset-selector")

            # the effective stores, and the check tool
            admin.click('#user-access button[data-action="toggle-stores"]')
            admin.wait_for_selector('#user-access [data-store="p.zarr"]')
            assert admin.locator('#user-access [data-store="in.zarr"]').count() == 1
            assert admin.locator('#user-access [data-store="out.zarr"]').count() == 0
            admin.fill("#access-check-path", os.path.join(data, "pub", "p.zarr"))
            admin.click("#access-check-button")
            admin.wait_for_selector('#access-check-result[data-allowed="true"]')
            assert "Covered by the folder" in admin.inner_text("#access-check-result")
            admin.fill("#access-check-path", os.path.join(data, "out.zarr"))
            admin.click("#access-check-button")
            admin.wait_for_selector('#access-check-result[data-allowed="false"]')

            # a path outside every data directory cannot be granted: the server's sentence is shown
            admin.check("#access-mode-dir")
            admin.fill("#access-grant-path", "/etc")
            admin.click("#access-grant-button")
            admin.wait_for_selector("#access-error")
            assert "outside every data directory" in admin.inner_text("#access-error")

            # the Data directories tab says who is granted what
            admin.click('a[href="#data"]')
            admin.wait_for_selector('#admin-main th:has-text("Granted to")')
            row = admin.locator("#admin-main tbody tr").first
            assert "bob" in row.inner_text()

            # revoke both: he reads nothing again, at once
            admin.click('a[href="#users"]')
            admin.wait_for_selector("#admin-main tbody tr")
            user_row(admin, "bob").locator('button[data-action="access"]').click()
            admin.wait_for_selector("#access-grants button[data-action=revoke]")
            while admin.locator("#access-grants button[data-action=revoke]").count():
                before = admin.locator("#access-grants button[data-action=revoke]").count()
                admin.locator("#access-grants button[data-action=revoke]").first.click()
                admin.wait_for_function(
                    "n => document.querySelectorAll('#access-grants button[data-action=revoke]').length < n", arg=before)
            assert info_status(bob, os.path.join(data, "in.zarr")) == 404
            assert info_status(bob, os.path.join(data, "pub", "p.zarr")) == 404
            assert "reads nothing" in admin.inner_text("#access-note")

            # lift the restriction: everything again
            admin.click("#access-restricted")
            admin.wait_for_selector("#access-confirm-box")
            assert "bob will be able to read every dataset" in admin.inner_text("#access-confirm-box")
            assert info_status(bob, os.path.join(data, "in.zarr")) == 404, "one click must not lift the restriction"
            admin.click('button[data-action="confirm-access"]')
            admin.wait_for_function("() => document.getElementById('access-note')?.innerText.includes('reads every dataset')")
            assert info_status(bob, os.path.join(data, "out.zarr")) == 200
            assert "all" in user_row(admin, "bob").inner_text()

            # the audit log has the trail
            admin.click('a[href="#audit"]')
            admin.wait_for_selector("#admin-main tbody tr code")
            text = admin.inner_text("#admin-main")
            for action in ("access.restrict", "access.grant", "access.revoke", "access.unrestrict"):
                assert action in text, action
            assert "refused:outside_data_roots" in text
            # the only console error is the refused grant (403): no CSP violation, no script error
            assert [e for e in admin_errors if "403" not in e] == [], admin_errors
            assert [e for e in bob_errors if "404" not in e] == [], bob_errors
        finally:
            browser.close()


def test_an_administrator_has_no_restriction_to_switch_on(served):
    base, _ = served
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            admin, errors = sign_in(browser, base, "alice", "/admin#users")
            admin.wait_for_selector("#admin-main tbody tr")
            user_row(admin, "alice").locator('button[data-action="access"]').click()
            admin.wait_for_selector("#access-restricted")
            assert admin.is_disabled("#access-restricted")
            assert "cannot be restricted" in admin.inner_text("#access-note")
            assert admin.locator("#access-grants").count() == 0
            assert errors == [], errors
        finally:
            browser.close()
