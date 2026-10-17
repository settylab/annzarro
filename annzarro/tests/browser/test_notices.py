"""The toast notices: where they live, which replaces which, how long they stay.

The pure rules (severity order, duration from length) are covered in
tests/js/notice-rules.test.mjs; here the page applies them. Toasts are raised
through the same event modules use (utils/notify.js), so no dataset action is
needed to provoke one.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI).
"""
import os

import pytest

from annzarro.tests.browser.test_refresh_reads_disk import PID, _link, served  # noqa: F401  (fixture)

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

BOX = "#notification-container"
TOAST = f"{BOX} .notification"


def _notify(page, title, message, type_, duration=None):
    page.evaluate(
        """([title, message, type, duration]) => {
            const detail = { title, message, type };
            if (duration !== null) detail.duration = duration;
            document.dispatchEvent(new CustomEvent('annzarro:notify', { detail }));
        }""", [title, message, type_, duration])


def _titles(page):
    return page.locator(f"{TOAST} .notification-title").all_inner_texts()


@pytest.fixture
def page(served):  # noqa: F811
    root, store = served
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1400, "height": 1000})
            page.goto(_link(root, store))
            page.wait_for_selector(f'.tile[data-tile-id="{PID}"] .js-plotly-plot', timeout=30000)
            yield page
        finally:
            browser.close()


def test_the_container_is_a_live_region_before_any_toast(served):  # noqa: F811
    root, store = served
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page()
            page.goto(_link(root, store), wait_until="domcontentloaded")
            box = page.locator(BOX)
            assert box.count() == 1
            assert box.get_attribute("role") == "status" and box.get_attribute("aria-live") == "polite"
            assert page.locator(TOAST).count() == 0
        finally:
            browser.close()


def test_an_error_survives_the_info_notice_that_follows(page):
    _notify(page, "Shared view not readable", "It could not be decoded.", "error")
    _notify(page, "Opened on another path", "Same cells and genes.", "info")
    page.wait_for_selector(f"{TOAST}:nth-child(2)")
    assert _titles(page) == ["Shared view not readable", "Opened on another path"]
    assert page.locator(f"{TOAST}.notification-error").get_attribute("role") == "alert"
    # a warning is below an error as well, and replaces the info below it
    _notify(page, "A warning", "Something partial.", "warning")
    page.wait_for_function(f"document.querySelectorAll('{TOAST}').length === 2")
    assert _titles(page) == ["Shared view not readable", "A warning"]


def test_a_more_severe_notice_replaces_a_lower_one(page):
    _notify(page, "Info", "First.", "info")
    page.wait_for_selector(TOAST)
    _notify(page, "Warning", "Second.", "warning")
    page.wait_for_function(f"document.querySelectorAll('{TOAST}').length === 1")
    assert _titles(page) == ["Warning"]
    _notify(page, "Error", "Third.", "error")
    page.wait_for_function(f"document.querySelectorAll('{TOAST}').length === 1")
    assert _titles(page) == ["Error"]


def test_hovering_a_toast_holds_its_clock(page):
    _notify(page, "Slow reader", "Still reading.", "info", 1500)
    page.wait_for_selector(TOAST)
    page.wait_for_timeout(400)  # the toast fades in under the pointer's reach
    page.hover(TOAST)
    page.wait_for_timeout(2600)  # well past its duration
    assert page.locator(TOAST).count() == 1
    page.mouse.move(5, 600)
    page.wait_for_selector(TOAST, state="detached", timeout=8000)


def test_a_toast_without_a_pointer_goes_on_time(page):
    _notify(page, "Quick", "Gone soon.", "info", 800)
    page.wait_for_selector(TOAST)
    page.wait_for_selector(TOAST, state="detached", timeout=5000)
