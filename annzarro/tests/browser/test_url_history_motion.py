"""Back and Forward over a layout change move the way the app does by hand.

A panel closed or opened by a step goes through the same animated path as a
close or open by the user (the layout is not rebuilt, the neighbour's width
eases through values between the two), a moved split eases its shares and the
graphs refit once at the end, and several quick Backs end on the right view.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
from annzarro.tests.browser.test_plot_options import (  # noqa: F401
    A, B, _cfgs, page, server)
from annzarro.tests.browser.test_url_history import LENGTH, SETTLE_MS
from annzarro.tests.browser.test_url_history_layout import (
    TILES, _drawn, _marked, _mark, _split, _tile, _view_link, _widths)

WIDTH_OF_A = f"document.querySelector(\".tile[data-tile-id='{A}']\").getBoundingClientRect().width"

# Records A's width on every frame, and counts rebuilds and autosize relayouts
WATCH = """() => {
  window.__w = []; window.__rebuilds = 0; window.__relayouts = 0; window.__on = true;
  const pm = window.PanelManager, orig = pm.restoreLayout;
  pm.restoreLayout = function () { window.__rebuilds++; return orig.apply(this, arguments); };
  const rl = window.Plotly.relayout;
  window.Plotly.relayout = function (el, o) { if (o && o.autosize) window.__relayouts++; return rl.apply(this, arguments); };
  const tick = () => {
    const t = document.querySelector(".tile[data-tile-id='%s']");
    if (t) window.__w.push(Math.round(t.getBoundingClientRect().width));
    if (window.__on) requestAnimationFrame(tick);
  };
  tick();
}""" % A


def _between(page):
    """The widths A went through, after the watch."""
    page.evaluate("() => { window.__on = false; }")
    return page.evaluate("() => window.__w")


def _two_panels(page, server):
    page.goto(_view_link(server, [_split([A, B])], _cfgs()))
    _drawn(page, A)
    _drawn(page, B)
    page.wait_for_timeout(SETTLE_MS)
    _mark(page, A)


def _close_b_by_hand(page):
    page.locator(f".tile[data-tile-id='{B}'] .tile-close").first.click()
    page.wait_for_function("() => document.querySelectorAll('.tile-container .tile[data-tile-id]').length === 1")
    page.wait_for_timeout(SETTLE_MS)


def _count(n):
    return f"() => document.querySelectorAll('.tile-container .tile[data-tile-id]').length === {n}"


def test_back_over_a_close_and_forward_animate_without_a_rebuild(page, server):
    _two_panels(page, server)
    half = page.evaluate(WIDTH_OF_A)
    _close_b_by_hand(page)
    full = page.evaluate(WIDTH_OF_A)
    assert full > half + 100
    page.evaluate(WATCH)
    page.go_back()                       # opens B beside A: A narrows through intermediate widths
    page.wait_for_function(_count(2), timeout=30000)
    _drawn(page, B)
    widths = _between(page)
    inside = [w for w in widths if half + 20 < w < full - 20]
    assert inside, widths
    assert page.evaluate("() => window.__rebuilds") == 0
    assert _marked(page, A) == "mine"
    assert abs(page.evaluate(WIDTH_OF_A) - half) < 4
    # Forward closes B again: A widens through intermediate widths, no rebuild
    page.evaluate(WATCH)
    page.go_forward()
    page.wait_for_function(_count(1), timeout=30000)
    page.wait_for_timeout(600)
    widths = _between(page)
    assert [w for w in widths if half + 20 < w < full - 20], widths
    assert page.evaluate("() => window.__rebuilds") == 0
    assert _marked(page, A) == "mine"
    assert page.evaluate(TILES) == [A]


def test_back_over_a_moved_split_eases_and_refits_once(page, server):
    _two_panels(page, server)
    before = _widths(page)
    start = page.evaluate(WIDTH_OF_A)
    box = page.locator(".split-handle").first.bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x - 250, y, steps=8)
    page.mouse.up()
    page.wait_for_timeout(SETTLE_MS)
    moved = page.evaluate(WIDTH_OF_A)
    assert moved < start - 100
    page.evaluate(WATCH)
    page.go_back()
    page.wait_for_function("(w) => JSON.stringify(window.PanelManager.saveLayout().hierarchy[0].panes.map(p => Math.round(p.percentage))) === JSON.stringify(w)",
                           arg=before, timeout=30000)
    page.wait_for_timeout(1200)
    widths = _between(page)
    assert [w for w in widths if moved + 20 < w < start - 20], widths
    assert page.evaluate("() => window.__rebuilds") == 0
    # two graphs, each refitted once at the end rather than on every frame
    assert page.evaluate("() => window.__relayouts") <= 2
    assert _marked(page, A) == "mine"


def test_three_quick_backs_end_on_the_right_view(page, server):
    page.goto(_view_link(server, [_tile(A)], {A: _cfgs()[A]}))
    _drawn(page, A)
    page.wait_for_timeout(SETTLE_MS)
    _mark(page, A)
    base = page.evaluate(LENGTH)
    # three actions, each its own entry: open B, close B, open B again
    for _ in range(2):
        page.evaluate("(cfg) => window.PanelManager.createPanelInLayout('cell-plot', cfg)", _cfgs()[B])
        page.wait_for_function(_count(2), timeout=30000)
        page.wait_for_timeout(SETTLE_MS)
        page.locator(f".tile[data-tile-id='{B}'] .tile-close").first.click()
        page.wait_for_function(_count(1))
        page.wait_for_timeout(SETTLE_MS)
    assert page.evaluate(LENGTH) == base + 4
    page.evaluate("() => { history.back(); history.back(); history.back(); }")
    page.wait_for_timeout(5000)
    # four entries back from the end: three steps land on the entry after the first open of B
    assert page.evaluate(TILES) == [A, B]
    assert _marked(page, A) == "mine"
    page.go_back()
    page.wait_for_function(_count(1), timeout=30000)
    page.wait_for_timeout(1500)
    assert page.evaluate(TILES) == [A]
    assert _marked(page, A) == "mine"
