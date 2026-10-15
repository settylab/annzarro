"""The desktop app's frameless window: room for the window controls, and the drag region.

On macOS and Windows the Electron app has no native title bar; its preload marks
``<html data-desktop-frame="mac|win">`` (and ``data-desktop-fullscreen`` in full screen) and
static/css/desktop-frame.css does the rest. This test sets the same attributes in a headless
Chromium (the page cannot tell the difference) and measures the header on the page:

- both: the header is exactly as tall as in the browser at the same width (no extra strip);
- mac: nothing in the header reaches into the area at the top left that the traffic lights
  float over, at window widths from the 800 px minimum to 1920; only the title drops (into the
  space the signed-in line has in the browser), at the same x; in full screen it is back where it was;
- win: nothing in the header reaches under the window controls at the top right (also with the
  dataset box on a row of its own), and the panel set buttons sit below them; the controls
  get the header's colours, light and dark;
- all: the panel set buttons line up with the dataset and focus boxes, not with the middle
  of their labelled columns (on a row of their own when the window is too narrow);
- both: the header is the drag region, everything you can use in it (and the popups over it)
  is not; with no flag (browser, Linux) nothing changes.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402  (required: fail, do not skip)
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_memory_guard import _serve  # noqa: E402

WIDTHS = [800, 900, 1000, 1100, 1280, 1500, 1920]
MAC_LIGHTS = (0, 0, 80, 24)          # x0, y0, x1, y1: the traffic lights (14..~66 px, 8..24 px)
OVERLAY_W, OVERLAY_H = 140, 32       # the window controls, at the top right

# What you use in the header: visible boxes of these must stay out of the controls' way.
USABLE = "#app-header :is(a, button, input, select, textarea, label, h1, .select2-container, .auth-indicator)"

BOXES = """(sel) => [...document.querySelectorAll(sel)].map(e => {
    const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
    return {id: e.id || e.className || e.tagName, x0: r.left, y0: r.top, x1: r.right, y1: r.bottom,
            shown: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !e.closest('[hidden]')};
}).filter(b => b.shown)"""

# Runs before the page's own scripts, as the preload does.
FLAG = """(() => {
  const set = () => { const r = document.documentElement; r.setAttribute('data-desktop', '');
    r.setAttribute('data-desktop-platform', %(platform)r); r.setAttribute('data-desktop-frame', %(frame)r); };
  if (document.documentElement) set();
  else new MutationObserver((_, o) => { if (document.documentElement) { o.disconnect(); set(); } })
    .observe(document, {childList: true});
  window.__overlay = [];
  window.api = {setTitleBarOverlay: (c) => { window.__overlay.push(c); return Promise.resolve(true); }};
})()"""


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    root, proc = _serve(tmp_path_factory)
    yield root
    proc.terminate()
    proc.wait(10)


@pytest.fixture(scope="module")
def browser():
    with playwright.sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


@pytest.fixture
def open_page(browser, server):
    contexts = []

    def make(frame=None, width=1280, height=800, scheme="light"):
        ctx = browser.new_context(viewport={"width": width, "height": height}, color_scheme=scheme)
        contexts.append(ctx)
        if frame:
            ctx.add_init_script(FLAG % {"platform": {"mac": "darwin", "win": "win32"}[frame], "frame": frame})
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(server + "/")
        page.wait_for_selector("#app-header .app-title")
        page.wait_for_function("document.getElementById('theme-toggle').children.length > 0")
        page.wait_for_timeout(400)  # the header's fitting (header-fit.js)
        page.errors = errors
        return page
    yield make
    for c in contexts:
        c.close()


def _hits(box, rect):
    x0, y0, x1, y1 = rect
    return box["x0"] < x1 and box["x1"] > x0 and box["y0"] < y1 and box["y1"] > y0


def _title_top(page):
    return page.evaluate("document.querySelector('#app-header .app-title').getBoundingClientRect().top")


def test_browser_and_linux_are_unchanged(open_page):
    page = open_page(None)
    assert page.evaluate("document.documentElement.hasAttribute('data-desktop-frame')") is False
    assert _title_top(page) < MAC_LIGHTS[3]
    for sel in ("#app-header", "#app-header button", "#dataset-stats"):
        assert page.evaluate("(s) => getComputedStyle(document.querySelector(s)).webkitAppRegion || 'none'", sel) == "none", sel
    assert not page.errors


@pytest.mark.parametrize("width", WIDTHS)
def test_mac_keeps_the_header_out_of_the_traffic_lights(open_page, width):
    plain = open_page(None, width)
    base_top, base_h = _title_top(plain), plain.evaluate("document.getElementById('app-header').offsetHeight")
    page = open_page("mac", width)
    boxes = page.evaluate(BOXES, USABLE)
    assert boxes, "nothing measured"
    under = [b["id"] for b in boxes if _hits(b, MAC_LIGHTS)]
    assert not under, f"under the traffic lights at {width}px: {under}"
    # the header keeps its height; only the title drops, below the lights, and does not move right
    assert page.evaluate("document.getElementById('app-header').offsetHeight") == base_h
    assert _title_top(page) >= MAC_LIGHTS[3]
    assert _title_top(page) > base_top  # it did move down (by the height of the line)
    left = "document.querySelector('#app-header .app-title').getBoundingClientRect().left"
    assert page.evaluate(left) == plain.evaluate(left)
    # nothing else in the header moved
    others = "[...document.querySelectorAll('#app-header :is(input, select, .btn)')].map(e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })"
    assert page.evaluate(others) == plain.evaluate(others)
    # full screen: no traffic lights, the title is back where it was
    page.evaluate("document.documentElement.setAttribute('data-desktop-fullscreen', '')")
    assert abs(_title_top(page) - base_top) < 1
    page.evaluate("document.documentElement.removeAttribute('data-desktop-fullscreen')")
    assert _title_top(page) >= MAC_LIGHTS[3]
    assert not page.errors


@pytest.mark.parametrize("frame", [None, "mac", "win"])
@pytest.mark.parametrize("width", WIDTHS)
def test_panel_set_buttons_sit_on_the_row_of_the_input_boxes(open_page, width, frame):
    page = open_page(frame, width)
    plain = open_page(None, width)
    height = "document.getElementById('app-header').offsetHeight"
    assert page.evaluate(height) == plain.evaluate(height)
    box = "(s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.top, r.bottom]; }"
    (b_top, b_bottom), (g_top, g_bottom), (c_top, _) = (
        page.evaluate(box, s) for s in ("#btn-save-session", "#focused-gene", "#focused-cell"))
    assert abs(g_top - c_top) < 1
    if b_top < g_bottom:  # on the row of the focus boxes: the same top and bottom as the boxes
        assert abs(b_top - g_top) < 1 and abs(b_bottom - g_bottom) < 1, \
            f"buttons at {b_top}, input boxes at {g_top} ({width}px, {frame})"
    else:  # narrow: a row of their own below the boxes
        assert width < 900, f"buttons on a row of their own at {width}px"
    assert not page.errors


@pytest.mark.parametrize("stacked", [False, True])
@pytest.mark.parametrize("width", WIDTHS)
def test_windows_keeps_the_header_out_of_the_window_controls(open_page, width, stacked):
    page = open_page("win", width)
    if stacked:  # the dataset box on a row of its own (header-fit.js does this when the row is short)
        page.evaluate("document.getElementById('app-header').classList.add('dataset-stacked')")
    rect = (width - OVERLAY_W, 0, width, OVERLAY_H)
    if not stacked:  # the header keeps the browser's height
        plain = open_page(None, width)
        assert page.evaluate("document.getElementById('app-header').offsetHeight") == \
            plain.evaluate("document.getElementById('app-header').offsetHeight")
    boxes = page.evaluate(BOXES, USABLE)
    assert boxes, "nothing measured"
    under = [b["id"] for b in boxes if _hits(b, rect)]
    assert not under, f"under the window controls at {width}px (stacked={stacked}): {under}"
    actions = page.evaluate(BOXES, "#app-header .header-actions .btn")
    assert actions and all(b["y0"] >= OVERLAY_H or b["x1"] <= width - OVERLAY_W for b in actions)
    # the panel set buttons are at the right edge, moved down rather than left
    assert max(b["x1"] for b in actions) > width - 24
    # full screen has no window controls: the header is the browser's again
    page.evaluate("document.documentElement.setAttribute('data-desktop-fullscreen', '')")
    if not stacked:
        plain = open_page(None, width)
        assert page.evaluate("document.getElementById('app-header').offsetHeight") == \
            plain.evaluate("document.getElementById('app-header').offsetHeight")
    assert not page.errors


def test_windows_controls_follow_the_header_colours_through_theme_changes(open_page):
    page = open_page("win", scheme="light")
    header_hex = """() => { const c = getComputedStyle(document.getElementById('app-header')); 
        const h = (s) => '#' + s.match(/\\d+/g).slice(0, 3).map(n => (+n).toString(16).padStart(2, '0')).join('');
        return {color: h(c.backgroundColor), symbolColor: h(c.color)}; }"""
    first = page.evaluate("window.__overlay.at(-1)")
    assert first == page.evaluate(header_hex)
    page.click("#theme-toggle button[title*='dark']")
    page.wait_for_function("document.documentElement.getAttribute('data-theme') === 'dark'")
    page.wait_for_function("(c) => window.__overlay.at(-1).color !== c", arg=first["color"])
    dark = page.evaluate("window.__overlay.at(-1)")
    assert dark == page.evaluate(header_hex) and dark != first
    page.click("#theme-toggle button[title*='light']")
    page.wait_for_function("(c) => window.__overlay.at(-1).color === c", arg=first["color"])
    assert not page.errors


@pytest.mark.parametrize("frame", ["mac", "win"])
def test_header_drags_the_window_and_what_you_use_does_not(open_page, frame):
    page = open_page(frame)
    region = "(s) => getComputedStyle(document.querySelector(s)).webkitAppRegion"
    assert page.evaluate(region, "#app-header") == "drag"
    assert page.evaluate(region, "#app-header .app-title") != "no-drag"
    usable = page.evaluate("""() => [...document.querySelectorAll(
        '#app-header :is(a, button, input, select, textarea, label, .select2-container, .name-picker, .dataset-pick)')]
        .filter(e => e.getBoundingClientRect().width > 0)
        .map(e => [e.id || e.className || e.tagName, getComputedStyle(e).webkitAppRegion])""")
    assert len(usable) > 8
    assert [u for u in usable if u[1] != "no-drag"] == []
    # the signed-in line is empty in the app: a box beside the traffic lights that must still drag
    # (it was a 96 x 24 px dead zone at 1100 px and wider); with links in it, they are clickable
    assert page.evaluate("document.getElementById('account-links').textContent") == ""
    assert page.evaluate(region, "#account-links") == "drag"
    page.evaluate("document.getElementById('account-links').innerHTML = '<a href=\"#\">Change password</a>'")
    assert page.evaluate(region, "#account-links") == "no-drag"
    assert page.evaluate(region, "#account-links a") == "no-drag"
    page.evaluate("document.getElementById('account-links').textContent = ''")
    # everything outside the header: the stats bar, the panels, and popups that open over the header
    assert page.evaluate(region, "#dataset-stats") == "no-drag"
    page.click("#dataset-selector + .select2-container")
    page.wait_for_selector(".select2-dropdown")
    assert page.evaluate("getComputedStyle(document.querySelector('.select2-dropdown').closest('body > *')).webkitAppRegion") == "no-drag"
    assert not page.errors
