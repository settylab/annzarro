"""The pop-over primitive (static/js/ui/popover.js, static/css/popover.css).

Mounted on a minimal fixture page (pages/popover.html), no app server: a stdlib file server on the repository
root, started and stopped inside the fixture. Covers Escape from anywhere (and the focus return), a press outside,
a drag that starts inside, the one-open rule, Tab cycling, the panel box staying put, the menu variant, the
viewport clamp and both themes.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import functools
import http.server
import os
import threading

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
PAGE = "/annzarro/tests/browser/pages/popover.html"


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


@pytest.fixture(scope="module")
def root():
    handler = functools.partial(_Quiet, directory=REPO)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    try:
        yield f"http://127.0.0.1:{srv.server_address[1]}"
    finally:
        srv.shutdown()
        srv.server_close()
        t.join(5)


@pytest.fixture(scope="module")
def browser():
    with playwright.sync_playwright() as p:
        b = p.chromium.launch()
        try:
            yield b
        finally:
            b.close()


@pytest.fixture
def page(browser, root):
    ctx = browser.new_context(viewport={"width": 1000, "height": 700})
    pg = ctx.new_page()
    pg.goto(root + PAGE)
    pg.wait_for_function("() => window.ready === true", timeout=15000)
    yield pg
    ctx.close()


def surface(page, name):
    return page.locator(f"[data-popover={name}]")


def active_id(page):
    return page.evaluate("document.activeElement && document.activeElement.id")


def closes(page):
    return page.evaluate("window.closes")


def test_click_opens_a_dialog_and_sets_the_anchor_state(page):
    page.click("#a1")
    s = surface(page, "plot-options")
    assert s.count() == 1
    assert s.get_attribute("role") == "dialog"
    labelled = s.get_attribute("aria-labelledby")
    assert page.locator(f"#{labelled}").inner_text() == "Plot Options"
    assert page.get_attribute("#a1", "aria-expanded") == "true"
    assert page.get_attribute("#a1", "aria-haspopup") == "dialog"
    assert page.get_attribute("#a1", "aria-controls") == s.get_attribute("id")
    # Focus goes into it, to the first control.
    assert active_id(page) == "p-text"


def test_it_lives_in_the_body_layer_and_is_fixed(page):
    page.click("#a1")
    pos = page.evaluate("""() => { const s = document.querySelector('[data-popover=plot-options]');
        return [getComputedStyle(s).position, s.parentElement.id, s.closest('#tile') === null]; }""")
    assert pos == ["fixed", "az-popover-layer", True]


def test_escape_from_inside_closes_and_refocuses_the_anchor(page):
    page.click("#a1")
    page.keyboard.press("Escape")
    assert surface(page, "plot-options").count() == 0
    assert active_id(page) == "a1"
    assert page.get_attribute("#a1", "aria-expanded") == "false"
    assert closes(page) == [["a1", "escape"]]


def test_escape_from_anywhere_closes(page):
    page.click("#a1")
    page.focus("#far")                       # focus left the surface; the pop-over is still open
    assert surface(page, "plot-options").count() == 1
    page.keyboard.press("Escape")
    assert surface(page, "plot-options").count() == 0
    assert active_id(page) == "a1"


def test_a_panel_keydown_handler_cannot_eat_escape(page):
    page.evaluate("document.getElementById('tile').addEventListener('keydown', e => e.stopPropagation())")
    page.click("#a1")
    page.focus("#a2")
    page.keyboard.press("Escape")
    assert surface(page, "plot-options").count() == 0


def test_a_press_outside_closes_and_leaves_focus_where_the_click_put_it(page):
    page.click("#a1")
    page.click("#outside")
    assert surface(page, "plot-options").count() == 0
    assert active_id(page) == "outside"
    assert closes(page) == [["a1", "outside"]]


def test_a_press_inside_does_not_close(page):
    page.click("#a1")
    page.click("#p-b1")
    page.click(".az-popover-header")
    assert surface(page, "plot-options").count() == 1


def test_a_drag_that_starts_inside_and_ends_outside_does_not_close(page):
    page.click("#a1")
    box = page.locator("#p-range").bounding_box()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.down()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + 300, steps=5)
    page.mouse.move(850, 400, steps=5)
    page.mouse.up()
    assert surface(page, "plot-options").count() == 1
    # And a text selection dragged out of the box.
    t = page.locator("#p-text").bounding_box()
    page.mouse.move(t["x"] + 10, t["y"] + t["height"] / 2)
    page.mouse.down()
    page.mouse.move(900, 600, steps=5)
    page.mouse.up()
    assert surface(page, "plot-options").count() == 1


def test_the_anchor_again_closes_and_refocuses(page):
    page.click("#a1")
    page.click("#a1")
    assert surface(page, "plot-options").count() == 0
    assert closes(page) == [["a1", "anchor"]]
    assert active_id(page) == "a1"


def test_the_close_button_closes_and_refocuses(page):
    page.click("#a1")
    page.click("[data-popover=plot-options] .az-popover-close")
    assert surface(page, "plot-options").count() == 0
    assert active_id(page) == "a1"


def test_keyboard_opens_with_enter_and_space(page):
    page.focus("#a1")
    page.keyboard.press("Enter")
    assert surface(page, "plot-options").count() == 1
    page.keyboard.press("Escape")
    page.keyboard.press("Space")
    assert surface(page, "plot-options").count() == 1


def test_a_second_popover_closes_the_first(page):
    page.click("#a1")
    page.click("#a2")
    assert surface(page, "plot-options").count() == 0
    assert surface(page, "color").count() == 1
    assert page.locator(".az-popover").count() == 1
    assert closes(page) == [["a1", "other"]]


def test_opening_through_the_api_also_closes_the_other(page):
    page.click("#a1")
    page.evaluate("window.pops.a2.open()")
    assert surface(page, "plot-options").count() == 0
    assert closes(page) == [["a1", "other"]]


def test_tab_and_shift_tab_cycle_inside(page):
    page.click("#a1")
    order = []
    for _ in range(7):
        order.append(active_id(page) or "close")
        page.keyboard.press("Tab")
    assert set(order) <= {"p-text", "p-range", "p-b1", "p-b2", "close"}
    assert order[:3] == ["p-text", "p-range", "p-b1"]
    inside = page.evaluate("document.activeElement.closest('[data-popover]') !== null")
    assert inside
    page.keyboard.press("Shift+Tab")
    page.keyboard.press("Shift+Tab")
    page.keyboard.press("Shift+Tab")
    assert page.evaluate("document.activeElement.closest('[data-popover]') !== null")


def test_tab_from_the_last_control_wraps_to_the_first(page):
    page.click("#a1")
    page.focus("#p-b2")
    page.keyboard.press("Tab")
    first = page.evaluate("""() => { const s = document.querySelector('[data-popover=plot-options]');
        return document.activeElement === s.querySelector('.az-popover-close'); }""")
    assert first or active_id(page) == "p-text"
    page.focus("#p-text")
    page.keyboard.press("Shift+Tab")
    assert page.evaluate("document.activeElement.closest('[data-popover]') !== null")


def test_the_last_used_control_is_focused_on_the_next_open(page):
    page.click("#a1")
    page.focus("#p-b2")
    page.keyboard.press("Escape")
    page.keyboard.press("Enter")
    assert active_id(page) == "p-b2"


def test_the_panel_box_and_scroll_do_not_change_while_open(page):
    def measure():
        return page.evaluate("""() => { const t = document.getElementById('tile'), p = document.getElementById('plot');
            const r = (e) => { const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; };
            return {tile: r(t), plot: r(p), scroll: [t.scrollTop, t.scrollHeight, t.clientHeight],
                    doc: [document.documentElement.scrollWidth, document.documentElement.scrollHeight]}; }""")
    before = measure()
    page.click("#a1")
    assert measure() == before
    page.click("#a2")
    assert measure() == before
    page.keyboard.press("Escape")
    assert measure() == before


def test_it_stays_inside_the_viewport_with_a_margin(page):
    page.evaluate("document.getElementById('far').style.left = '980px'")
    page.evaluate("""() => { const b = document.getElementById('a2'); b.style.position = 'absolute'; b.style.left = '960px'; b.style.top = '600px'; }""")
    page.click("#a2")
    r = page.locator("[data-popover=color]").bounding_box()
    assert r["x"] >= 8 - 0.5 and r["x"] + r["width"] <= 1000 - 8 + 0.5
    assert r["y"] >= 8 - 0.5 and r["y"] + r["height"] <= 700 - 8 + 0.5
    assert page.locator("[data-popover=color]").get_attribute("data-side") == "above"


def test_a_narrow_viewport_gives_a_full_width_sheet(browser, root):
    ctx = browser.new_context(viewport={"width": 400, "height": 700})
    try:
        pg = ctx.new_page()
        pg.goto(root + PAGE)
        pg.wait_for_function("() => window.ready === true")
        pg.click("#a1")
        r = pg.locator("[data-popover=plot-options]").bounding_box()
        assert abs(r["x"] - 8) < 1 and abs(r["width"] - 384) < 1
    finally:
        ctx.close()


def test_it_follows_the_anchor_on_scroll(page):
    page.evaluate("document.body.style.height = '3000px'")
    page.click("#a1")
    y0 = page.locator("[data-popover=plot-options]").bounding_box()["y"]
    page.evaluate("window.scrollBy(0, 5)")
    page.wait_for_function("(y) => document.querySelector('[data-popover=plot-options]').getBoundingClientRect().y !== y", arg=y0)
    y1 = page.locator("[data-popover=plot-options]").bounding_box()["y"]
    assert abs((y0 - y1) - 5) < 1.5


def test_it_closes_when_the_anchor_is_removed(page):
    page.click("#a1")
    page.evaluate("document.getElementById('a1').remove()")
    page.wait_for_function("() => !document.querySelector('[data-popover=plot-options]')")
    assert closes(page) == [["a1", "anchor-gone"]]


def test_the_menu_variant(page):
    page.click("#m1")
    s = surface(page, "add")
    assert s.get_attribute("role") == "menu"
    assert page.get_attribute("#m1", "aria-haspopup") == "menu"
    assert s.locator(".az-popover-header").count() == 0
    assert active_id(page) == "mi1"
    page.keyboard.press("ArrowDown")
    assert active_id(page) == "mi2"
    page.keyboard.press("ArrowDown")
    assert active_id(page) == "mi1"
    page.keyboard.press("ArrowUp")
    assert active_id(page) == "mi2"
    page.keyboard.press("Enter")
    page.wait_for_function("() => !document.querySelector('[data-popover=add]')")
    assert active_id(page) == "m1"
    assert closes(page) == [["m1", "select"]]


def test_the_menu_opens_with_arrow_down_from_the_anchor(page):
    page.focus("#m1")
    page.keyboard.press("ArrowDown")
    assert surface(page, "add").count() == 1


@pytest.mark.parametrize("theme", ["light", "dark"])
def test_tokens_give_readable_surfaces_in_both_themes(page, theme):
    page.evaluate("t => document.documentElement.setAttribute('data-theme', t)", theme)
    page.click("#a1")
    got = page.evaluate("""() => { const s = document.querySelector('[data-popover=plot-options]');
        const cs = getComputedStyle(s), hs = getComputedStyle(s.querySelector('.az-popover-header'));
        const root = getComputedStyle(document.documentElement);
        return {bg: cs.backgroundColor, fg: cs.color, head: hs.backgroundColor,
                surface: root.getPropertyValue('--az-surface').trim(), text: root.getPropertyValue('--az-text').trim(),
                shadow: root.getPropertyValue('--az-popover-shadow').trim(), z: cs.zIndex}; }""")
    def rgb(c):
        return [int(float(x)) for x in c[c.index("(") + 1:c.index(")")].split(",")[:3]]
    def lum(c):
        def f(v):
            v /= 255
            return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
        r, g, b = (f(v) for v in rgb(c))
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
    a, b = sorted([lum(got["bg"]), lum(got["fg"])], reverse=True)
    assert (a + 0.05) / (b + 0.05) >= 4.5
    assert got["z"] == "1040"
    assert (theme == "dark") == (lum(got["bg"]) < 0.2)
    assert ("0.6" in got["shadow"]) == (theme == "dark")
