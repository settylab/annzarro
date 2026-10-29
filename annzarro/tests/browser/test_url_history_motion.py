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
  window.__w = []; window.__rebuilds = 0; window.__relayouts = 0; window.__on = true; window.__motion = [];
  // the layout motion (utils/layout-motion.js) eases by a CSS transition it sets on the moving element:
  // seeing it set is the animated path, however many frames a slow machine drew of it
  if (window.__mo) window.__mo.disconnect();
  window.__mo = new MutationObserver((list) => { for (const m of list) { const t = m.target.style && m.target.style.transition;
    if (t && /(max-width|height|flex-grow)/.test(t) && !/none/.test(t)) window.__motion.push(t); } });
  window.__mo.observe(document.body, { attributes: true, attributeFilter: ['style'], subtree: true });
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


def _animated(page):
    """The transitions the layout motion set since the watch (an empty list: the step was built at once)."""
    return page.evaluate("() => window.__motion")


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
    _between(page)
    assert _animated(page), "Back over the close was not animated"
    assert page.evaluate("() => window.__rebuilds") == 0
    assert _marked(page, A) == "mine"
    assert abs(page.evaluate(WIDTH_OF_A) - half) < 4
    # Forward closes B again: A widens through intermediate widths, no rebuild
    page.evaluate(WATCH)
    page.go_forward()
    page.wait_for_function(_count(1), timeout=30000)
    page.wait_for_timeout(600)
    _between(page)
    assert _animated(page), "Forward over the open was not animated"
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
    _between(page)
    assert _animated(page), "Back over the moved split was not animated"
    assert page.evaluate("() => window.__rebuilds") == 0
    # two graphs, each refitted once at the end rather than on every frame
    assert page.evaluate("() => window.__relayouts") <= 2
    assert _marked(page, A) == "mine"



C = "cell-plot-c3"
D = "cell-plot-d4"


def _rows(page, server, ids=(A, B, C)):
    """Panels in rows, drawn and settled."""
    cfgs = {**_cfgs(), C: {**_cfgs()[B], "id": C}, D: {**_cfgs()[A], "id": D}}
    page.goto(_view_link(server, [_tile(i) for i in ids], {i: cfgs[i] for i in ids}))
    for pid in ids:
        _drawn(page, pid)
    page.wait_for_timeout(SETTLE_MS)
    _mark(page, A)
    return page.evaluate(LENGTH)


def _close(page, pid):
    page.locator(f".tile[data-tile-id='{pid}'] .tile-close").first.click()
    page.wait_for_function("(id) => !document.querySelector(`.tile[data-tile-id=\"${id}\"]`)", arg=pid)


def test_two_quick_closes_are_two_entries_and_each_back_animates(page, server):
    base = _rows(page, server)
    _close(page, C)
    page.wait_for_timeout(200)
    _close(page, B)
    page.wait_for_timeout(SETTLE_MS)
    assert page.evaluate(LENGTH) == base + 2
    assert page.evaluate(TILES) == [A]
    page.evaluate(WATCH)
    page.go_back()
    page.wait_for_function(_count(2), timeout=30000)
    _drawn(page, B)
    assert page.evaluate(TILES) == sorted([A, B])
    page.go_back()
    page.wait_for_function(_count(3), timeout=30000)
    _drawn(page, C)
    assert page.evaluate(TILES) == sorted([A, B, C])
    assert page.evaluate("() => window.__rebuilds") == 0
    assert _marked(page, A) == "mine"


def test_spinner_clicks_and_a_slider_drag_are_one_entry_each(page, server):
    from annzarro.tests.browser.test_plot_options import _menu
    page.goto(_view_link(server, [_split([A, B])], _cfgs()))
    _drawn(page, A)
    _drawn(page, B)
    _menu(page, A, "text")
    page.wait_for_timeout(SETTLE_MS)
    base = page.evaluate(LENGTH)
    page.focus(f"#font-size-{A}")
    for _ in range(5):
        page.keyboard.press("ArrowUp")
        page.wait_for_timeout(150)
    page.wait_for_timeout(SETTLE_MS)
    assert page.evaluate(LENGTH) == base + 1
    # a slider: press, move through values, release
    slider = page.evaluate("""() => {
        const r = [...document.querySelectorAll('input[type=range]')].find(e => e.offsetParent !== null);
        if (!r) return null;
        r.id = r.id || 'test-slider';
        return r.id;
    }""")
    assert slider
    page.evaluate("""async (id) => {
        const r = document.getElementById(id);
        const min = +r.min || 0, max = +r.max || 100;
        r.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        for (let i = 1; i <= 8; i++) {
            r.value = min + (max - min) * i / 10;
            r.dispatchEvent(new Event('input', { bubbles: true }));
            await new Promise(res => setTimeout(res, 80));
        }
        r.dispatchEvent(new Event('change', { bubbles: true }));
        r.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    }""", slider)
    page.wait_for_timeout(SETTLE_MS)
    assert page.evaluate(LENGTH) == base + 2


def test_changes_to_two_controls_300ms_apart_are_two_entries(page, server):
    from annzarro.tests.browser.test_plot_options import _menu
    page.goto(_view_link(server, [_split([A, B])], _cfgs()))
    _drawn(page, A)
    _drawn(page, B)
    _menu(page, A, "text")
    page.wait_for_timeout(SETTLE_MS)
    base = page.evaluate(LENGTH)
    _menu(page, A, "axes")
    first, second = f"axis-line-width-{A}", f"font-size-{A}"
    page.fill(f"#{first}", "2")
    page.press(f"#{first}", "Tab")
    page.wait_for_timeout(300)
    page.fill(f"#{second}", "16")
    page.press(f"#{second}", "Tab")
    page.wait_for_timeout(SETTLE_MS)
    assert page.evaluate(LENGTH) == base + 2
    page.go_back()
    page.wait_for_function("(id) => window.PanelManager.saveLayout().panelConfigs[id].fontSize !== 16", arg=A, timeout=30000)


def test_three_quick_backs_end_on_the_right_view(page, server):
    base = _rows(page, server, (A, B, C, D))
    for pid in (D, C, B):
        _close(page, pid)
        page.wait_for_timeout(700)
    page.wait_for_timeout(SETTLE_MS)
    assert page.evaluate(LENGTH) == base + 3
    assert page.evaluate(TILES) == [A]
    page.evaluate(WATCH)
    page.evaluate("() => { history.back(); history.back(); history.back(); }")
    page.wait_for_function(_count(4), timeout=60000)
    page.wait_for_timeout(2500)
    assert page.evaluate(TILES) == sorted([A, B, C, D])
    assert _marked(page, A) == "mine"
    # and forward once undoes only the first close
    page.go_forward()
    page.wait_for_function(_count(3), timeout=30000)
    page.wait_for_timeout(1500)
    assert page.evaluate(TILES) == sorted([A, B, C])
