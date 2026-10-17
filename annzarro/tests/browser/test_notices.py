"""The toast notices: where they live, which replaces which, how long they stay.

The pure rules (severity order, duration from length) are covered in
tests/js/notice-rules.test.mjs; here the page applies them. Toasts are raised
through the same event modules use (utils/notify.js), so no dataset action is
needed to provoke one.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI).
"""
import os
import re

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


# ---- what moved out of the toasts ------------------------------------------------------------

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
NO_CONFIRM = "window.confirm = () => { throw new Error('native confirm() used'); };"
CARD = ".session-card"


def test_no_native_confirm_remains_in_the_app():
    """The app asks in the page (a notice, a card, a button), never in a native modal."""
    pattern = re.compile(r"(?<![\w.])(?:window\.)?confirm\(")
    hits = []
    for base in ("static/js", "templates"):
        for dirpath, dirs, files in os.walk(os.path.join(REPO, base)):
            dirs[:] = [d for d in dirs if d != "vendor"]
            for name in files:
                if name.endswith((".js", ".mjs", ".html")):
                    path = os.path.join(dirpath, name)
                    for n, line in enumerate(open(path, encoding="utf-8"), 1):
                        if pattern.search(line):
                            hits.append(f"{path}:{n}")
    assert not hits, hits


def _no_toasts(page):
    return page.locator(TOAST).count() == 0


def _save_dialog(page, name):
    page.click("#btn-save-session")
    page.wait_for_selector("#session-name", state="visible")
    page.fill("#session-name", name)


def _saved(page):
    page.click("#btn-confirm-session")
    page.wait_for_selector("#session-modal", state="hidden", timeout=10000)


def test_a_refused_save_says_so_in_the_dialog(served):  # noqa: F811
    root, store = served
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1400, "height": 1000})
            page.add_init_script(NO_CONFIRM)
            page.route("**/api/v1/sessions/save*", lambda r: r.fulfill(
                status=403, content_type="application/json", body='{"status": "error", "message": "Owned by ann"}'))
            page.goto(_link(root, store))
            page.wait_for_selector(f'.tile[data-tile-id="{PID}"] .js-plotly-plot', timeout=30000)
            _save_dialog(page, "mine")
            page.click("#btn-confirm-session")
            page.wait_for_function("document.getElementById('session-save-note').textContent.length > 0")
            note = page.locator("#session-save-note")
            assert note.is_visible()
            assert note.inner_text() == "Not allowed: Owned by ann"
            assert page.is_visible("#session-modal")      # the dialog stays for another try
            assert _no_toasts(page)
            shot = os.environ.get("ANNZARRO_SHOT")
            if shot:
                page.screenshot(path=shot + "-save-refused.png")
        finally:
            browser.close()


def test_overwriting_is_asked_on_the_save_button_and_deleting_in_the_card(served):  # noqa: F811
    root, store = served
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1400, "height": 1000})
            page.add_init_script(NO_CONFIRM)      # a native confirm() would throw and leave the set unsaved
            page.goto(_link(root, store))
            page.wait_for_selector(f'.tile[data-tile-id="{PID}"] .js-plotly-plot', timeout=30000)
            _save_dialog(page, "mine")
            _saved(page)
            # the same name again: the button turns into Overwrite, the dialog says why
            _save_dialog(page, "mine")
            page.click("#btn-confirm-session")
            page.wait_for_function("document.getElementById('btn-confirm-session').textContent === 'Overwrite'")
            assert "already exists" in page.inner_text("#session-save-note")
            assert page.is_visible("#session-modal") and _no_toasts(page)
            # another name disarms it
            page.fill("#session-name", "mine2")
            assert page.inner_text("#btn-confirm-session") == "Save"
            page.fill("#session-name", "mine")
            page.click("#btn-confirm-session")
            page.wait_for_function("document.getElementById('btn-confirm-session').textContent === 'Overwrite'")
            _saved(page)          # the second press overwrites
            # delete: asked in the card, Cancel keeps the set
            page.click("#btn-load-session")
            card = page.locator(f'{CARD}[data-session-name="mine"]')
            card.wait_for(timeout=10000)
            card.locator(".session-delete").click()
            ask = card.locator(".session-card-ask")
            assert 'Delete panel set "mine"?' in ask.inner_text()
            ask.get_by_text("Cancel").click()
            assert card.count() == 1 and ask.count() == 0
            card.locator(".session-delete").click()
            card.locator(".session-card-ask").get_by_text("Delete", exact=True).click()
            card.wait_for(state="detached", timeout=10000)
            assert _no_toasts(page)
        finally:
            browser.close()


def test_a_refused_export_is_in_the_status_strip_not_a_popover(served):  # noqa: F811
    from annzarro.tests.browser.test_memory_guard import SET_FREE, _drawn
    root, store = served
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1400, "height": 1000})
            page.goto(_link(root, store))
            _drawn(page, PID)
            page.evaluate(SET_FREE, 1000)
            page.evaluate("""async (pid) => {
                const m = await import('/static/js/panels/plot-utilities/plot-aesthetics-menu.js');
                const gd = document.querySelector(`.tile[data-tile-id="${pid}"] .js-plotly-plot`);
                await m.exportPlot(gd, 'png', {}, 'full');
            }""", PID)
            tag = page.locator(f'.tile[data-tile-id="{PID}"] .ps-tag[data-tag="memory"]')
            tag.wait_for(timeout=5000)
            assert tag.inner_text() == "Not exported: browser memory"
            pop = page.locator(f'.tile[data-tile-id="{PID}"] .ps-pop[data-pop="memory"]')
            assert "memory" in pop.inner_text().lower() and pop.is_visible()
            assert page.locator(".popover").count() == 0 and _no_toasts(page)
            shot = os.environ.get("ANNZARRO_SHOT")
            if shot:
                page.screenshot(path=shot + "-export-refused.png")
        finally:
            browser.close()


def test_the_log_colour_scale_explains_a_limit_under_the_boxes(page):
    page.click(f"#log-color-{PID}")
    page.fill(f"#color-max-{PID}", "-5")
    page.dispatch_event(f"#color-max-{PID}", "change")
    hint = page.locator(f"#color-log-hint-{PID}")
    hint.wait_for(state="visible", timeout=5000)
    assert hint.inner_text().strip() != ""
    assert "text-danger" in (hint.get_attribute("class") or "")
    assert _no_toasts(page)
    # a limit that can be shown clears it
    page.fill(f"#color-max-{PID}", "5000")
    page.dispatch_event(f"#color-max-{PID}", "change")
    page.wait_for_function(f"document.getElementById('color-log-hint-{PID}').hidden")


def test_share_link_is_off_until_a_dataset_is_open(page):
    assert page.is_enabled("#btn-share-link")
    page.evaluate("""async () => {
        const { DatasetState } = await import('/static/js/utils/dataset-state.js');
        window.__was = DatasetState.get();
        DatasetState.set({ path: null, label: '', status: 'none' });
    }""")
    assert page.is_disabled("#btn-share-link")
    assert page.get_attribute("#btn-share-link", "title") == "Open a dataset first"
    page.evaluate("""async () => {
        const { DatasetState } = await import('/static/js/utils/dataset-state.js');
        DatasetState.set(window.__was);
    }""")
    assert page.is_enabled("#btn-share-link")
    assert _no_toasts(page)
