"""A refresh of a store too large to fingerprint tells the user what that means.

Issue #91: for a store with more files than the refresh check can stat in its
budget, POST data/refresh answers status "partial" and does not bump the
generation, so a write that only overwrote chunk files is not served until an
admin's cache reset. The browser used to drop the answer, leaving a user who
pressed Refresh with the old values and no hint why.

The refresh answer is route-mocked as "partial" (the server side is covered
in tests/server/test_refresh_freshness.py); the page runs against a real
server. Who the user is comes from a mocked auth/me for the non-admin, and
from the real login-less local server (which may clear its cache) for the
admin case.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI).
"""
import json
import os

import pytest

from annzarro.tests.browser.test_refresh_reads_disk import PID, _link, served  # noqa: F401  (fixture)

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

PARTIAL = {"status": "partial", "changed": False, "checked": False, "result": "success",
           "message": "Store too large to fingerprint fully in 3 s"}
USER = {"auth_enabled": True, "username": "bob", "is_admin": False, "exposed": False,
        "may_open_any_path": False}
NOTICE = "#notification-container .notification"


def _json(route, body):
    route.fulfill(status=200, content_type="application/json", body=json.dumps(body))


def _open(browser, root, store, as_user):
    page = browser.new_page(viewport={"width": 1400, "height": 1000})
    page.route("**/api/v1/data/refresh*", lambda r: _json(r, PARTIAL))
    if as_user:
        page.route("**/api/v1/auth/me", lambda r: _json(r, USER))
    page.goto(_link(root, store))
    page.wait_for_selector(f'.tile[data-tile-id="{PID}"] .js-plotly-plot', timeout=30000)
    page.wait_for_timeout(1000)
    return page


def _notices(page):
    return page.locator(NOTICE).all_inner_texts()


@pytest.mark.parametrize("how", ["header", "panel"])
def test_a_user_is_told_a_chunk_only_write_may_not_show(served, how):  # noqa: F811
    root, store = served
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = _open(browser, root, store, as_user=True)
            assert not _notices(page)
            page.click("#refresh-dataset" if how == "header" else f"#refresh-plot-{PID}")
            page.wait_for_selector(NOTICE, timeout=15000)
            page.wait_for_timeout(700)  # the toast fades in
            text = " ".join(_notices(page))
            assert "Refresh may not show every change" in text, text
            assert "inside its data chunks may not show" in text and "admin" in text, text
            assert "restart" in text, text
            assert len(_notices(page)) == 1
            shot = os.environ.get("ANNZARRO_SHOT")
            if shot and how == "header":
                page.screenshot(path=shot + "-user.png")
        finally:
            browser.close()


def test_an_admin_is_told_the_cache_was_cleared(served):  # noqa: F811
    """Login off (the local server): Refresh dataset also clears the server's
    cache, which serves chunk-only writes, and the notice says so."""
    root, store = served
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = _open(browser, root, store, as_user=False)
            with page.expect_response(lambda r: r.request.method == "POST" and "/api/v1/cache/reset" in r.url):
                page.click("#refresh-dataset")
            page.wait_for_selector(NOTICE, timeout=15000)
            page.wait_for_timeout(700)  # the toast fades in
            text = " ".join(_notices(page))
            assert "Large dataset refreshed" in text and "cache" in text, text
            assert "may not show" not in text, text
            shot = os.environ.get("ANNZARRO_SHOT")
            if shot:
                page.screenshot(path=shot + "-admin.png")
        finally:
            browser.close()


def test_a_full_check_shows_no_notice(served):  # noqa: F811
    root, store = served
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1400, "height": 1000})
            page.goto(_link(root, store))
            page.wait_for_selector(f'.tile[data-tile-id="{PID}"] .js-plotly-plot', timeout=30000)
            with page.expect_response(lambda r: r.request.method == "POST" and "/api/v1/data/refresh" in r.url):
                page.click("#refresh-dataset")
            page.wait_for_timeout(2500)
            assert not _notices(page)
        finally:
            browser.close()
