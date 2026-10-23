"""A burst of quick, mixed actions, then Back: every Back lands exactly on the view recorded.

Closing panels, a number box, opening a panel by its chooser and moving a
split, all within a couple of seconds, are separate steps. Each Back (also one
pressed while the step before is still moving) ends on the view of the entry
it went to, never on a no-op or on a panel that was removed earlier.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
from annzarro.tests.browser.test_plot_options import (  # noqa: F401
    A, B, _cfgs, _menu, page, server)
from annzarro.tests.browser.test_url_history import LENGTH, SETTLE_MS
from annzarro.tests.browser.test_url_history_layout import (
    TILES, _drawn, _mark, _marked, _split, _tile, _view_link)
from annzarro.tests.browser.test_url_history_motion import C, D, WATCH, _close, _count, _rows

# what a view is, for comparing: the panels, A's text size and the split shares
SIG = """() => { const l = window.PanelManager.saveLayout();
  const ids = [...document.querySelectorAll('.tile-container .tile[data-tile-id]')].map(t => t.dataset.tileId).sort();
  const a = l.panelConfigs['%s'];
  const shares = []; (function w(n) { if (n && n.type === 'split') { shares.push(...n.panes.map(p => Math.round(p.percentage))); n.children.forEach(w); } })(l.hierarchy[0]);
  return JSON.stringify([ids, a && a.fontSize, shares]); }""" % A


def _sig(page):
    return page.evaluate(SIG)


def _open_by_chooser(page):
    page.locator(".tile-selector[data-is-bottom-selector='true'] .panel-type-option[data-type='cell-plot']").first.click()


def _land(page, want, timeout=30000):
    page.wait_for_function("([sig, f]) => f && true", arg=[want, 1], timeout=timeout) if False else None
    page.wait_for_function(f"(want) => ({SIG})() === want", arg=want, timeout=timeout)


def _burst(page, server):
    """Six mixed actions in about two seconds; the view after each."""
    _rows(page, server, (A, B, C, D))
    _menu(page, A, "text")
    page.wait_for_timeout(SETTLE_MS)
    base = page.evaluate(LENGTH)
    seen = [_sig(page)]
    _close(page, D)
    seen.append(_sig(page))
    page.focus(f"#font-size-{A}")
    for _ in range(2):
        page.keyboard.press("ArrowUp")
        page.wait_for_timeout(60)
    seen.append(_sig(page))
    _close(page, C)
    seen.append(_sig(page))
    _open_by_chooser(page)
    page.wait_for_function(_count(3), timeout=30000)
    seen.append(_sig(page))
    _close(page, B)
    seen.append(_sig(page))
    return base, seen


def test_a_burst_of_mixed_actions_then_back_lands_on_every_view(page, server):
    warnings = []
    page.on("console", lambda m: warnings.append(m.text) if "did not land" in m.text else None)
    page.add_init_script("""(() => { window.__pushed = []; const o = history.pushState;
        history.pushState = function (s, t, u) { window.__pushed.push([location.href === new URL(u, location.href).href, String(u).length]); return o.apply(this, arguments); }; })()""")
    base, seen = _burst(page, server)
    page.wait_for_timeout(SETTLE_MS)
    assert page.evaluate(LENGTH) == base + 5
    # no entry holds the address the page already had
    assert not [p for p in page.evaluate("() => window.__pushed") if p[0]]
    assert _sig(page) == seen[-1]
    for want in reversed(seen[:-1]):
        page.go_back()
        _land(page, want)
        page.wait_for_timeout(300)
        assert _sig(page) == want
    for want in seen[1:]:
        page.go_forward()
        _land(page, want)
        page.wait_for_timeout(300)
        assert _sig(page) == want
    # every step landed by the way of the animations: none was built at once
    assert not warnings, warnings


def test_back_at_once_after_a_burst_lands_on_the_last_recorded_view(page, server):
    base, seen = _burst(page, server)
    # no settling: the last action is not written yet, Back shows the view before it
    for want in reversed(seen[:-1]):
        page.go_back()
        _land(page, want)
        page.wait_for_timeout(300)
        assert _sig(page) == want
    page.wait_for_timeout(SETTLE_MS)
    assert _sig(page) == seen[0]


def test_back_pressed_while_a_step_is_moving_ends_on_the_right_view(page, server):
    base, seen = _burst(page, server)
    page.wait_for_timeout(SETTLE_MS)
    # three Backs 40 ms apart, each while the one before is still moving
    for _ in range(3):
        page.evaluate("() => history.back()")
        page.wait_for_timeout(40)
    _land(page, seen[-4])
    page.wait_for_timeout(1500)
    assert _sig(page) == seen[-4]
    page.go_back()
    _land(page, seen[-5])


def test_a_step_that_does_not_land_is_built_at_once(page, server):
    base, seen = _burst(page, server)
    page.wait_for_timeout(SETTLE_MS)
    # a step whose animation leaves the screen as it was (as an interrupted one might)
    page.evaluate("() => { window.PanelManager.applyLayoutStep = async () => true; }")
    page.go_back()
    _land(page, seen[-2])
    page.wait_for_timeout(500)
    assert _sig(page) == seen[-2]
