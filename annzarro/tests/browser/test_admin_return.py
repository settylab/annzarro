"""Returning from the admin pages gives the admin their panels back (a browser test).

A server with login on and an admin user. Panels are opened on a dataset, the
autosave is waited for, the header's Admin link is followed, and the way back
is taken twice: the admin page's "Back to" link and the browser's Back button.
Both must show the panels the admin left.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_crash_restore import IDS, _drawn, _link, _settled, until  # noqa: E402
from annzarro.tests.browser.test_outbound_policy import Session, browser, server  # noqa: E402,F401

TILES = ('() => [...document.querySelectorAll(\'.tile[data-tile-id^="cell-plot"]\')]'
         '.map(t => t.dataset.tileId).sort()')


def _open_panels_then_admin(browser, server, settled):
    """Three plots drawn, then the header's Admin link and two admin sections.

    `settled`: wait until the page's restore marker is gone first. Otherwise the
    admin is opened at once, while the marker still stands (a large dataset
    draws for far longer than this fixture does).
    """
    s = Session(browser, server, "root")
    page = s.page
    page.goto(_link(server, IDS[:3]))
    for pid in IDS[:3]:
        _drawn(page, pid)
    _settled(page)
    # the autosave of this page is written
    until(page, "() => { const a = localStorage.getItem('annzarro_autosave') "
                "|| sessionStorage.getItem('annzarro_autosave'); return !!a && "
                "Object.keys(JSON.parse(a).panelConfigs || {}).length === 3; }", timeout=60)
    if settled:
        until(page, "() => !localStorage.getItem('annzarro_restoring')", timeout=60)
        page.wait_for_timeout(1500)
    else:
        assert page.evaluate("() => !!localStorage.getItem('annzarro_restoring')"), "the marker should stand"
    page.wait_for_selector('#account-links a[data-link="admin"]', timeout=30000)
    page.click('#account-links a[data-link="admin"]')
    page.wait_for_url("**/admin", timeout=30000)
    page.wait_for_selector("#admin-nav .nav-link", timeout=30000)
    links = page.locator("#admin-nav .nav-link")
    for i in range(min(2, links.count())):
        links.nth(i).click()
        page.wait_for_timeout(300)
    return s


WHEN = pytest.mark.parametrize("settled", [True, False], ids=["settled", "leaving-mid-restore"])


@WHEN
def test_the_back_link_of_the_admin_page_restores_the_panels(browser, server, settled):
    s = _open_panels_then_admin(browser, server, settled)
    try:
        page = s.page
        page.locator("header a:has-text('Back to')").click()
        page.wait_for_selector("#auth-indicator:not([hidden])", timeout=30000)
        _settled(page)
        assert page.evaluate(TILES) == sorted(IDS[:3])
    finally:
        s.close()


@WHEN
def test_the_browser_back_button_restores_the_panels(browser, server, settled):
    s = _open_panels_then_admin(browser, server, settled)
    try:
        page = s.page
        # the admin sections keep their own history entries: Back until the app
        while "/admin" in page.url:
            page.go_back()
            page.wait_for_timeout(300)
        page.wait_for_selector("#auth-indicator:not([hidden])", timeout=30000)
        _settled(page)
        assert page.evaluate(TILES) == sorted(IDS[:3])
    finally:
        s.close()
