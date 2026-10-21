"""The dataset browser's listing cache and Refresh button, in a real (headless) browser.

A listing read before is shown the moment the browser opens, while a fresh one is read behind it;
Refresh is busy and cannot be clicked while a read runs; a failed read keeps the list; a dataset that
disappeared goes at the next read and is not opened from a stale row; a second login sees no listing of
the first.

The server's answer is held with a Playwright route, released by the test. Needs Playwright with
Chromium; skipped without it, or failed when ANNZARRO_REQUIRE_BROWSER=1.
"""
import os
import shutil

from annzarro.tests.ui_helpers import BROWSER, BUTTON, ROW, browser_row, browser_rows, close_browser, open_browser

from .dsb_servers import FIXTURE, SHOTS, Session, hosted_server, server  # noqa: F401  (fixtures)

FOLDER_ROUTE = "**/api/v1/datasets/folder*"
LISTINGS_KEYS = "() => Object.keys(localStorage).filter(k => k.startsWith('annzarro.listings:'))"


def _shot(page, name):
    if SHOTS:
        page.wait_for_timeout(500)       # the dialog has faded in
        os.makedirs(SHOTS, exist_ok=True)
        page.screenshot(path=os.path.join(SHOTS, name))


def _hold(page):
    """Hold every folder listing the page asks for until ``release``; returns the held routes."""
    held = []
    page.route(FOLDER_ROUTE, lambda route: held.append(route))
    return held


def _release(page, held):
    for route in held:
        route.continue_()
    held.clear()
    page.unroute(FOLDER_ROUTE)


def _show(page):
    """Open the browser without waiting for it to have listed something."""
    page.wait_for_function("() => !!(window.annzarro && window.annzarro.ready)", timeout=30_000)
    page.click(BUTTON)
    page.locator(BROWSER).wait_for(state="visible", timeout=10_000)


def _idle(page):
    page.wait_for_function(
        "() => { const b = document.getElementById('dsb-refresh'); return b && !b.disabled && b.getAttribute('aria-busy') === 'false'; }",
        timeout=30_000)


def _warm(page):
    """Open the browser once so that it has read the data directory, then close it."""
    open_browser(page)
    _idle(page)
    names = browser_rows(page)
    close_browser(page)
    return names


def test_reopening_shows_the_list_at_once_and_refresh_is_busy_and_disabled_until_the_read_ends(server):
    base, data = server
    s = Session(base)
    page = s.page
    try:
        warm = _warm(page)
        assert warm and page.evaluate(LISTINGS_KEYS), "the browser kept what it read"
        held = _hold(page)
        _show(page)
        # the rows are there while the server has not answered: no "Loading" screen
        page.wait_for_selector(f"{ROW}[data-kind]", timeout=5_000)
        assert browser_rows(page) == warm
        assert "Loading" not in page.inner_text("#dsb-table-wrap")
        page.wait_for_function("() => document.getElementById('dsb-refresh').getAttribute('aria-busy') === 'true'", timeout=5_000)
        assert page.is_disabled("#dsb-refresh")
        assert "Refreshing" in page.inner_text("#dsb-refresh")
        assert page.locator("#dsb-refresh i.fa-spin").count() == 1
        assert len(held) >= 1, "the fresh read is under way"
        # type, select and scroll while it is: they survive the list arriving
        page.fill("#dsb-search", "other")
        browser_row(page, "other_small.zarr").locator("td").first.click()
        page.wait_for_selector(f"{ROW}.selected")
        _shot(page, "list-cache-busy.png")
        _release(page, held)
        _idle(page)
        assert not page.is_disabled("#dsb-refresh") and page.inner_text("#dsb-refresh").strip() == "Refresh"
        assert page.input_value("#dsb-search") == "other"
        assert page.locator(f"{ROW}.selected").count() == 1 and page.locator(f"{ROW}.selected").get_attribute("data-path").endswith("other_small.zarr")
        assert page.locator("#dsb-refresh-note").is_hidden()
        _shot(page, "list-cache-idle.png")
        assert not s.errors, s.errors
    finally:
        s.close()


def test_the_list_survives_a_reload_and_is_shown_before_the_server_answers(server):
    base, data = server
    s = Session(base)
    page = s.page
    try:
        warm = _warm(page)
        page.reload()
        held = _hold(page)
        _show(page)
        page.wait_for_selector(f"{ROW}[data-kind]", timeout=5_000)
        assert browser_rows(page) == warm
        _release(page, held)
        _idle(page)
        assert browser_rows(page) == warm
    finally:
        s.close()


def test_a_failed_refresh_keeps_the_list_with_a_note_and_the_button_comes_back(server):
    base, data = server
    s = Session(base)
    page = s.page
    try:
        warm = _warm(page)
        page.route(FOLDER_ROUTE, lambda route: route.abort())
        _show(page)
        page.wait_for_function("() => !document.getElementById('dsb-refresh-note').hidden", timeout=10_000)
        assert "Could not refresh" in page.inner_text("#dsb-refresh-note")
        assert browser_rows(page) == warm, "never a blank list"
        _idle(page)
        assert not page.is_disabled("#dsb-refresh")
        _shot(page, "list-cache-failed.png")
        # the server is back: Refresh clears the note
        page.unroute(FOLDER_ROUTE)
        page.click("#dsb-refresh")
        page.wait_for_function("() => document.getElementById('dsb-refresh-note').hidden", timeout=10_000)
        assert browser_rows(page) == warm
    finally:
        s.close()


def test_the_refresh_button_reads_again_and_a_new_dataset_appears(server):
    base, data = server
    s = Session(base)
    page = s.page
    added = os.path.join(data, "added_later.zarr")
    try:
        open_browser(page)
        _idle(page)
        assert browser_row(page, "added_later.zarr").count() == 0
        shutil.copytree(FIXTURE, added)
        held = _hold(page)
        page.click("#dsb-refresh")
        page.wait_for_function("() => document.getElementById('dsb-refresh').disabled", timeout=5_000)
        assert page.get_attribute("#dsb-refresh", "aria-busy") == "true"
        n = len(held)
        page.wait_for_timeout(300)
        assert len(held) == n, "a disabled button asks for nothing more"
        _release(page, held)
        _idle(page)
        assert browser_row(page, "added_later.zarr").count() == 1
    finally:
        shutil.rmtree(added, ignore_errors=True)
        s.close()


def test_a_dataset_that_disappeared_goes_at_the_refresh_and_a_stale_row_is_not_opened(server):
    base, data = server
    s = Session(base)
    page = s.page
    gone = os.path.join(data, "ephemeral.zarr")
    try:
        shutil.copytree(FIXTURE, gone)
        warm = _warm(page)
        assert any(p.endswith("ephemeral.zarr") for p in warm)
        shutil.rmtree(gone)
        held = _hold(page)
        _show(page)
        page.wait_for_selector(f"{ROW}[data-path$='ephemeral.zarr']", timeout=5_000)
        # clicking it before the refresh arrives: the browser asks, stays open and says so
        browser_row(page, "ephemeral.zarr").locator(".dsb-name").click()
        page.wait_for_function("() => /no longer available/.test(document.getElementById('dsb-status').textContent)", timeout=5_000)
        assert page.locator(BROWSER).is_visible()
        assert browser_row(page, "ephemeral.zarr").count() == 0
        _release(page, held)
        _idle(page)
        assert all(not p.endswith("ephemeral.zarr") for p in browser_rows(page))
        # and with no click at all, the refresh alone removes it
        shutil.copytree(FIXTURE, gone)
        close_browser(page)
        open_browser(page)
        _idle(page)
        assert browser_row(page, "ephemeral.zarr").count() == 1
        close_browser(page)
        shutil.rmtree(gone)
        _show(page)
        page.wait_for_function(f"() => !document.querySelector(\"{ROW}[data-path$='ephemeral.zarr']\")", timeout=10_000)
        _idle(page)
    finally:
        shutil.rmtree(gone, ignore_errors=True)
        s.close()


def test_another_user_who_signs_in_sees_no_listing_of_the_first(hosted_server):
    base, data, _ = hosted_server
    s = Session(base, login=("alice", "alice-pw"))
    page = s.page
    try:
        warm = _warm(page)
        assert warm
        assert [k.rsplit("|", 1)[1] for k in page.evaluate(LISTINGS_KEYS)] == ["user:alice"]
        s.context.clear_cookies()                        # signed out
        page.goto(base + "/")
        page.fill("#username", "root")
        page.fill("#password", "root-pw")
        page.click("button[type=submit]")
        page.wait_for_function("() => window.annzarro && window.annzarro.getDataset", timeout=60_000)
        held = _hold(page)
        _show(page)
        page.wait_for_timeout(500)
        assert page.locator(f"{ROW}[data-kind]").count() == 0, "alice's list is not shown to root"
        assert "Loading" in page.inner_text("#dsb-table-wrap")
        _release(page, held)
        _idle(page)
        assert browser_rows(page)
        keys = [k.rsplit("|", 1)[1] for k in page.evaluate(LISTINGS_KEYS)]
        assert keys == ["user:root"], keys
    finally:
        s.close()
