"""A busy page does not reload on Back, and a typed fragment still does.

Back and Forward between the entries this page wrote change the fragment, and the
browser says so with a hashchange event right after popstate. A page busy for
more than a second in between (large plots) used to take that for a fragment
someone typed and reloaded, which could leave its panels closed.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
from annzarro.tests.browser.test_plot_options import A, B, _cfgs, page, server  # noqa: F401
from annzarro.tests.browser.test_url_history import SETTLE_MS
from annzarro.tests.browser.test_url_history_layout import TILES, _drawn, _split, _view_link


def _two_entries(page, server):
    page.goto(_view_link(server, [_split([A, B])], _cfgs()))
    _drawn(page, A)
    _drawn(page, B)
    page.wait_for_timeout(SETTLE_MS)
    page.evaluate("() => { window.__h0 = location.hash; }")
    page.locator(f".tile[data-tile-id='{B}'] .tile-close").first.click()
    page.wait_for_timeout(SETTLE_MS)
    page.evaluate("() => { window.__alive = 1; }")


def test_a_back_handled_slowly_does_not_reload_the_page(page, server):
    _two_entries(page, server)
    # a listener after the app's own: the page is busy for 1.3 s before the hashchange arrives
    page.evaluate("() => window.addEventListener('popstate', () => { const t = Date.now(); while (Date.now() - t < 1300); })")
    page.go_back()
    page.wait_for_function("() => document.querySelectorAll('.tile-container .tile[data-tile-id]').length === 2", timeout=30000)
    _drawn(page, B)
    page.wait_for_timeout(1500)
    assert page.evaluate("() => window.__alive") == 1, "the page reloaded"
    assert page.evaluate(TILES) == sorted([A, B])


def test_a_typed_fragment_still_reloads(page, server):
    _two_entries(page, server)
    page.evaluate("() => { location.hash = window.__h0; }")
    page.wait_for_function("() => window.__alive !== 1", timeout=30000)
