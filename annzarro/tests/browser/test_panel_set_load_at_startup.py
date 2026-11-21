"""A panel set loaded while the page is still starting waits until it can be applied (FX-S).

Start-up exposes window.sessionManager and binds the Load Panel Set button (main.js, _initUI) before it has read
the policy and installed the view applier (SessionManager.setViewApplier). A load in that window used to take the
closed-panels fallback: it said "success" and left the set's panels closed and never drawn. Here the policy read is
held in the page until the test releases it, so the window is open for as long as the test needs, on any machine.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_panel_set_loads_closed import (  # noqa: E402,F401  (fixtures)
    CLOSED_ALL, DATA, _guard, _tile_ids, _write_set, browser, server)

SET = "at-startup"
PLOT = "cell-plot-P1"

# The policy read (GET /api/v1/policy/effective, awaited by main.js init before setViewApplier) waits for the test
HOLD_START = """(() => {
    const real = window.fetch;
    let release;
    const gate = new Promise((r) => { release = r; });
    window.__policyAsked = false;
    window.__releaseStart = () => release();
    window.fetch = function (input, init) {
        const url = String(typeof input === 'string' ? input : (input && input.url) || '');
        if (url.includes('/api/v1/policy/effective')) {
            window.__policyAsked = true;
            return gate.then(() => real.call(this, input, init));
        }
        return real.call(this, input, init);
    };
})();"""


def _held(browser):
    """A page stopped in its start-up, at the policy read: the Load button works, no applier is set yet."""
    _write_set(SET, [PLOT])
    ctx = browser.new_context(viewport={"width": 1400, "height": 1000})
    page = ctx.new_page()
    seen = _guard(page)
    page.add_init_script(HOLD_START)
    page.goto(DATA["root"] + "/")
    page.wait_for_function("() => window.__policyAsked && window.sessionManager && window.PanelManager", timeout=30000)
    return ctx, page, seen


def _assert_drawn_and_open(page):
    page.wait_for_selector(f".tile[data-tile-id='{PLOT}'] .js-plotly-plot", timeout=30000)
    assert PLOT in _tile_ids(page)
    assert PLOT not in page.evaluate(CLOSED_ALL), "the set's open panel came in closed"


def test_load_session_during_start_up_waits_and_opens_the_set(server, browser):
    ctx, page, seen = _held(browser)
    try:
        page.evaluate("""(n) => { window.__loaded = null;
            window.sessionManager.loadSession(n).then((r) => { window.__loaded = r; }); }""", SET)
        # nothing is reported while the page cannot apply the set
        assert page.evaluate("() => window.__loaded") is None
        page.evaluate("() => window.__releaseStart()")
        page.wait_for_function("() => window.__loaded !== null", timeout=60000)
        loaded = page.evaluate("() => window.__loaded")
        assert loaded["status"] == "success" and loaded.get("message") != "Panels added (closed)", loaded
        _assert_drawn_and_open(page)
        assert seen["errors"] == [] and seen["dialogs"] == [], seen
    finally:
        ctx.close()


def test_the_dialogs_load_during_start_up_says_loading_then_opens_the_set(server, browser):
    ctx, page, seen = _held(browser)
    try:
        page.click("#btn-load-session")
        card = page.locator(f".session-card[data-session-name='{SET}']")
        card.wait_for(timeout=30000)
        card.locator(".session-load").click()
        actions = card.locator(".load-actions")
        playwright.expect(card.locator(".session-load")).to_have_text("Loading…")
        playwright.expect(actions).to_have_attribute("aria-busy", "true")
        playwright.expect(page.locator("#session-modal")).to_be_visible()     # the dialog waits with it
        assert page.evaluate(CLOSED_ALL) == [], "nothing was added while the page was starting"
        page.evaluate("() => window.__releaseStart()")
        page.wait_for_function("() => document.getElementById('session-modal').offsetParent === null", timeout=60000)
        _assert_drawn_and_open(page)
        assert seen["errors"] == [] and seen["dialogs"] == [], seen
    finally:
        ctx.close()


def test_the_welcome_list_appears_only_once_a_set_can_be_applied(server, browser):
    """The welcome tile is made by PanelManager.init, in the same task as setViewApplier: its set cards cannot be
    clicked during start-up. Held at the policy read there is none; when one shows, loading is ready."""
    ctx, page, seen = _held(browser)
    try:
        assert page.locator(".session-item").count() == 0
        assert page.evaluate("() => window.sessionManager.isReady()") is False
        page.evaluate("() => window.__releaseStart()")
        page.locator(".session-item", has_text=SET).first.wait_for(timeout=30000)
        assert page.evaluate("() => window.sessionManager.isReady()") is True
        assert seen["errors"] == [] and seen["dialogs"] == [], seen
    finally:
        ctx.close()
