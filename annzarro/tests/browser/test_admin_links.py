"""The header's link to the admin interface, in a real browser (admin slice 6).

A server with login on. An admin sees "Admin" next to the signed-in badge and
reaches the admin page, which links back to the app. An ordinary user sees no
link, and /admin answers 403 (the server decides; the link is only a courtesy).

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_outbound_policy import Session, browser, server  # noqa: E402,F401
from annzarro.tests.server.multiworker_helpers import PASSWORD  # noqa: E402


def test_an_admin_sees_the_link_and_reaches_the_page_that_links_back(browser, server):
    s = Session(browser, server, "root")
    try:
        page = s.page
        page.goto(server + "/")
        page.wait_for_selector('#account-links a[data-link="admin"]', timeout=30000)
        assert page.inner_text('#account-links a[data-link="admin"]') == "Admin"
        page.click('#account-links a[data-link="admin"]')
        page.wait_for_url("**/admin", timeout=30000)
        page.wait_for_selector("#admin-nav .nav-link", timeout=30000)
        back = page.locator("header a:has-text('Back to')")
        assert back.count() == 1
        back.click()
        page.wait_for_selector("#auth-indicator:not([hidden])", timeout=30000)
        assert page.url.rstrip("/") == server
    finally:
        s.close()


def test_the_change_password_link_opens_the_page_and_the_new_password_signs_in(browser, server):
    s = Session(browser, server, "carol")
    try:
        page = s.page
        page.goto(server + "/")
        page.wait_for_selector('#account-links a[data-link="password"]', timeout=30000)
        page.click('#account-links a[data-link="password"]')
        page.wait_for_url("**/account/password", timeout=30000)
        assert "Change password" in page.inner_text("h1")
        page.fill("#account-current", PASSWORD)
        page.fill("#account-new", "a-new-long-password")
        page.fill("#account-confirm", "a-new-long-password")
        page.click("#account-submit")
        page.wait_for_selector("#account-message.alert-success", timeout=30000)
        assert "changed" in page.inner_text("#account-message")
        fresh = browser.new_context()
        try:
            tab = fresh.new_page()
            tab.goto(server + "/login")
            tab.fill("#username", "carol")
            tab.fill("#password", PASSWORD)
            tab.click("button[type=submit]")
            tab.wait_for_selector(".error-message", timeout=10000)
            assert "/login" in tab.url, "the old password still signs in"
            tab.fill("#username", "carol")
            tab.fill("#password", "a-new-long-password")
            tab.click("button[type=submit]")
            tab.wait_for_url(lambda u: "/login" not in u, timeout=30000)
        finally:
            fresh.close()
    finally:
        s.close()


def test_an_ordinary_user_sees_no_admin_link_and_gets_403_at_the_page(browser, server):
    s = Session(browser, server, "alice")
    try:
        page = s.page
        page.goto(server + "/")
        page.wait_for_selector("#auth-indicator:not([hidden])", timeout=30000)
        assert page.locator('#account-links a[data-link="admin"]').count() == 0
        assert page.inner_text('#account-links a[data-link="password"]') == "Change password"
        response = page.goto(server + "/admin")
        assert response.status == 403
        assert "needs an administrator" in page.inner_text("body")
    finally:
        s.close()
