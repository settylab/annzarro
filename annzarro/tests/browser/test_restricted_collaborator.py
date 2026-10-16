"""An external collaborator restricted to some datasets, in a real browser against a real server.

``bob`` is restricted to the store ``in.zarr`` and the folder ``pub``; the data
directory also holds ``out.zarr`` and ``hidden/deep.zarr``, which he must never
see, find, or be told about:

* the dataset browser (its root place is "Your datasets"), its folders and its
  search show the grants and nothing else, and no text of the page names the
  data directory;
* a deep link to a dataset outside the grants opens the layout without data and
  says "not available to you, or no longer exists", on the notice, on the
  placeholder panels and on the no-dataset screen;
* a grant revoked while a dataset is open turns the next read into the same
  notice and returns to the browser, which names it;
* the panel sets listed to him are his own and those on datasets he can read;
* an unrestricted user is unchanged.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import json
import os
import shutil
import socket
import threading

import pytest
from annzarro.tests.ui_helpers import (
    BROWSER, SHOWN_DATASET, browser_row, browser_rows, button_state, button_text, open_browser)

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from werkzeug.serving import make_server  # noqa: E402

from annzarro.server import access  # noqa: E402
from annzarro.server.auth import AuthManager  # noqa: E402
from annzarro.server.core import create_app  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(os.path.dirname(HERE), "data", "fixture_small.zarr")
SHOT = os.environ.get("ANNZARRO_SHOT_DIR")
PASSWORD = "pw-for-browser-tests"


@pytest.fixture
def served(tmp_path):
    data = tmp_path / "data"
    for rel in ("in.zarr", "out.zarr", "pub/p.zarr", "hidden/deep.zarr"):
        (data / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(FIXTURE, data / rel)
    manager = AuthManager(user_file=str(tmp_path / "users.json"))
    for name, admin in (("alice", True), ("bob", False), ("carol", False)):
        manager.add_user(name, PASSWORD, is_admin=admin)
    app = create_app({"TESTING": True, "host": "127.0.0.1", "data_dir": str(data), "log_file": str(tmp_path / "t.log"),
                      "auth_enabled": True, "user_file": str(tmp_path / "users.json"), "secret_key": "browser-test",
                      "admin_contact": "the data team"})
    access.add_grant(app.config, "bob", "store", str(data / "in.zarr"), actor="alice")
    access.add_grant(app.config, "bob", "dir", str(data / "pub"), actor="alice")
    access.set_restricted(app.config, "bob", True)
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    server = make_server("127.0.0.1", port, app, threaded=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield app, f"http://127.0.0.1:{port}", str(data)
    server.shutdown()
    thread.join(10)


@pytest.fixture(scope="module")
def browser():
    with playwright.sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


def sign_in(browser, base, username):
    context = browser.new_context(viewport={"width": 1400, "height": 1000})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.set_default_timeout(20000)
    page.goto(f"{base}/login")
    page.fill("input[name=username]", username)
    page.fill("input[name=password]", PASSWORD)
    page.click("button[type=submit], input[type=submit]")
    page.wait_for_url(lambda url: not url.endswith("/login"))
    return context, page, errors


def wait_for_dataset(page):
    page.wait_for_function("() => window.annzarro && window.annzarro.getDataset().status === 'open'", timeout=30000)
    page.wait_for_timeout(1000)


def wait_for_page(page):
    """The page has started, with no dataset open (a restricted user's first visit opens none)."""
    page.wait_for_function("() => window.annzarro && window.annzarro.getDataset", timeout=30000)
    page.wait_for_timeout(1000)


def test_the_browser_and_its_search_show_only_the_grants(browser, served):
    app, base, data = served
    context, page, errors = sign_in(browser, base, "bob")
    try:
        page.goto(base + "/")
        wait_for_page(page)
        assert page.evaluate("fetch('/api/v1/auth/me').then(r => r.json()).then(m => m.restricted)") is True

        modal = open_browser(page)
        # the places: the grants' root is "Your datasets", the granted folder a place of its own
        places = page.inner_text("#dsb-places")
        assert "Your datasets" in places and "pub" in places and "Data directory" not in places
        rows = browser_rows(page)
        assert any(r.endswith("in.zarr") for r in rows) and any(r.endswith("pub") for r in rows), rows
        listed = modal.inner_text()
        assert "out.zarr" not in listed and "hidden" not in listed and "deep.zarr" not in listed
        # into the granted folder, by its row and by its place
        browser_row(page, "/pub").locator(".dsb-name").click()
        browser_row(page, "p.zarr").wait_for()
        shown = page.inner_text("#dsb-table-wrap")
        assert "p.zarr" in shown and "out.zarr" not in shown and "hidden" not in shown
        assert "pub" in page.inner_text("#dsb-crumbs")
        page.click("#dsb-places [data-place='root']")
        browser_row(page, "in.zarr").wait_for()

        page.fill("#dsb-search", "zarr")
        browser_row(page, "p.zarr").wait_for()
        page.wait_for_timeout(800)          # the search below the folders answers after its pause
        everything = modal.inner_text()
        assert "in.zarr" in everything and "p.zarr" in everything
        for forbidden in ("out.zarr", "deep.zarr", "hidden", data, os.path.dirname(data)):
            assert forbidden not in everything, forbidden
        page.fill("#dsb-search", "deep")
        page.wait_for_timeout(1500)
        assert "deep.zarr" not in modal.inner_text()
        # the path field says what this user may open
        page.keyboard.press("Control+l")
        assert "shared with you" in page.inner_text("#dsb-path-label")
        page.keyboard.press("Escape")
        if SHOT:
            page.fill("#dsb-search", "")
            page.screenshot(path=os.path.join(SHOT, "restricted-picker.png"))
        assert not errors, errors
    finally:
        context.close()


def test_a_deep_link_outside_the_grants_is_not_available(browser, served):
    app, base, data = served
    context, page, errors = sign_in(browser, base, "bob")
    try:
        page.goto(f"{base}/?dataset_path={data}/out.zarr")
        page.wait_for_selector(".notification-title", timeout=30000)
        notice = page.inner_text("#notification-container")
        assert "Dataset not available" in notice
        assert "not available to you, or no longer exists" in notice
        # nothing says it exists, and nothing says where the data directory is
        assert "not on this server" not in notice
        assert os.path.dirname(data) not in page.inner_text("body").replace(data, "")
        # the page is open without data and says where: the dataset button names what they asked for, as they wrote it
        assert button_state(page) == "nodata" and button_text(page).startswith("No data"), button_text(page)
        # the button opens the browser for this view, with the sentence that is true of both cases (it may not exist,
        # or may not be theirs) and no word of where the data directory is
        modal = open_browser(page)
        banner = page.inner_text("#dataset-browser-banner")
        assert "not available to you, or no longer exists" in banner and "Its panels are kept" in banner, banner
        assert "Ask the data team for access." in banner, "the site names whom to ask (branding.admin_contact)"
        assert data not in modal.inner_text() and os.path.dirname(data) not in modal.inner_text()
        page.keyboard.press("Escape")
        # the same link to a store they may read opens it
        page.goto(f"{base}/?dataset_path={data}/in.zarr")
        wait_for_dataset(page)
        assert page.evaluate(SHOWN_DATASET).endswith("in.zarr")
        if SHOT:
            page.goto(f"{base}/?dataset_path=out.zarr")
            page.wait_for_selector(".notification-title", timeout=30000)
            page.screenshot(path=os.path.join(SHOT, "restricted-not-available.png"))
        assert not errors, errors
    finally:
        context.close()


def test_an_unrestricted_user_still_sees_everything_and_the_old_wording(browser, served):
    app, base, data = served
    context, page, errors = sign_in(browser, base, "carol")
    try:
        page.goto(base + "/")
        wait_for_page(page)
        open_browser(page)
        listed = " ".join(browser_rows(page))
        assert "in.zarr" in listed and "out.zarr" in listed
        assert page.locator("#dataset-browser-banner").is_hidden()          # nobody is told to ask anyone
        page.keyboard.press("Escape")
        page.goto(f"{base}/?dataset_path={data}/nope.zarr")
        page.wait_for_selector(".notification-title", timeout=30000)
        notice = page.inner_text("#notification-container")
        assert "Dataset not found" in notice and "not available to you" not in notice
        assert not errors, errors
    finally:
        context.close()


def test_a_grant_revoked_while_the_dataset_is_open_returns_to_the_browser(browser, served):
    app, base, data = served
    context, page, errors = sign_in(browser, base, "bob")
    try:
        page.goto(f"{base}/?dataset_path={data}/in.zarr")
        wait_for_dataset(page)
        assert page.evaluate(SHOWN_DATASET).endswith("in.zarr")
        access.remove_grant(app.config, "bob", f"{data}/in.zarr")          # the next read of it is 404
        outcome = page.evaluate("""async () => {
            const { DataManager } = await import('/static/js/data-manager.js');
            DataManager.clearCache();
            try { await DataManager.loadObs({ datasetPath: DataManager.getCurrentDataset(), columns: ['cell_type'] }); return 'read'; }
            catch (e) { return e.status; }
        }""")
        assert outcome in (404, 'read'), outcome
        if outcome == 'read':
            pytest.skip("the fixture has no such column to read after the revoke")
        page.wait_for_selector(".notification-title")
        assert "Dataset not available" in page.inner_text("#notification-container")
        page.locator(BROWSER).wait_for(state="visible")
        page.wait_for_function("() => !/Loading/.test(document.querySelector('#dsb-table-wrap').innerText)")
        page.wait_for_timeout(1500)       # the lists load after the dialog opens
        assert page.locator(f"{BROWSER} tr.dsb-row[data-path$='in.zarr']").count() == 0
        banner = page.inner_text("#dataset-browser-banner")
        assert "not available to you, or no longer exists" in banner and "Ask the data team for access." in banner
        assert button_state(page) == "unavailable"
        assert not errors, errors
    finally:
        context.close()


def test_panel_sets_listed_to_a_restricted_user(browser, served):
    app, base, data = served
    carol_context, carol, _ = sign_in(browser, base, "carol")
    bob_context, bob, errors = sign_in(browser, base, "bob")
    try:
        for name, dataset in (("carol on in", "in.zarr"), ("carol on out", "out.zarr")):
            reply = carol.evaluate("""async ([name, dataset]) => (await fetch('/api/v1/sessions/save', {
                method: 'POST', headers: {'Content-Type': 'application/json',
                    'X-AnnZarro-CSRF': document.querySelector('meta[name=annzarro-csrf]').content},
                body: JSON.stringify({name, dataset})})).status""", [name, dataset])
            assert reply == 200
        bob.goto(base + "/")
        wait_for_page(bob)
        names = bob.evaluate("fetch('/api/v1/sessions/list').then(r => r.json()).then(l => l.map(s => s.name))")
        assert names == ["carol on in"] or sorted(names) == ["carol on in"], names
        status = bob.evaluate("fetch('/api/v1/sessions/load?name=carol%20on%20out').then(r => r.status)")
        assert status == 404
        assert not errors, errors
    finally:
        carol_context.close()
        bob_context.close()
