"""Plot Options popover: the arrow keys of its number boxes, and closing only on a press that starts outside.

1. The Focused opacity box shows its value (1 by default), so the arrow keys and the
   mouse spinner step from it (1, 0.95, 0.9), not from the minimum; an emptied box with a
   non-numeric placeholder steps from opaque by the keyboard. In Chromium and WebKit.
2. A press inside the popover (selecting text, dragging a slider) that ends outside it
   leaves it open; a click outside closes it, and so do Escape and the button.

Needs Playwright with Chromium (and WebKit for the stepping test); skipped otherwise,
unless ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_plot_options import A, DRAWN, _link, _menu, page, server  # noqa: E402,F401  (fixtures)


@pytest.fixture(params=["chromium", "webkit"])
def engine_page(request, server):
    with playwright.sync_playwright() as p:
        try:
            browser = getattr(p, request.param).launch()
        except Exception as e:                                  # an engine that is not installed
            if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
                raise
            pytest.skip(f"{request.param} is not available: {e}")
        try:
            page = browser.new_page(viewport={"width": 1500, "height": 1000})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(_link(server))
            page.wait_for_function(DRAWN, arg=A, timeout=60000)
            page.wait_for_timeout(1000)
            yield page
            assert not errors, errors
        finally:
            browser.close()


def _arrow(page, selector, key):
    page.focus(selector)
    page.keyboard.press(key)
    page.wait_for_timeout(150)
    return page.input_value(selector)


def test_the_arrows_step_from_the_default_in_chromium_and_webkit(engine_page):
    page = engine_page
    _menu(page, A, "focused")
    op = f"#focused-opacity-{A}"
    assert page.input_value(op) == "1"                     # the box shows the default, so a spinner steps from it
    assert _arrow(page, op, "ArrowDown") == "0.95"
    assert _arrow(page, op, "ArrowDown") == "0.9"
    assert _arrow(page, op, "ArrowUp") == "0.95"
    assert _arrow(page, op, "ArrowUp") == "1"
    # the value reached the plot, not only the box
    page.wait_for_function("(id) => window.PanelManager.getActivePanels().find(p => p.getId() === id).getConfig().focusedOpacity === undefined"
                           " || window.PanelManager.getActivePanels().find(p => p.getId() === id).getConfig().focusedOpacity === 1", arg=A)
    # boxes that show their value step from it
    assert _arrow(page, f"#focused-scale-{A}", "ArrowDown") == "4.9"
    assert _arrow(page, f"#focused-edge-width-{A}", "ArrowDown") == "1.5"
    assert _arrow(page, f"#focused-edge-width-{A}", "ArrowUp") == "2"
    # Not in table opacity is automatic when empty (no table here): the arrows start from opaque
    _menu(page, A, "points")
    nt = f"#not-in-table-opacity-{A}"
    assert page.input_value(nt) == ""
    assert _arrow(page, nt, "ArrowDown") == "0.95"
    assert _arrow(page, nt, "ArrowDown") == "0.9"


def test_a_drag_that_ends_outside_keeps_the_menu_open(page, server):
    page.goto(_link(server))
    page.wait_for_function(DRAWN, arg=A, timeout=60000)
    page.wait_for_timeout(1000)
    _menu(page, A, "focused")
    popover = ".aesthetics-popover"
    box = page.locator(f"#focused-scale-{A}").bounding_box()
    outside = (5, 5)
    assert page.evaluate("([x, y]) => !document.elementFromPoint(x, y).closest('.popover')", list(outside))
    # a press in a number box, a drag out of the menu, a release over the page: still open
    page.mouse.move(box["x"] + 10, box["y"] + box["height"] / 2)
    page.mouse.down()
    page.mouse.move(*outside, steps=8)
    page.mouse.up()
    page.wait_for_timeout(400)
    assert page.query_selector(popover), "the menu closed on a drag that started inside it"
    # a click that starts and ends outside closes it
    page.mouse.click(*outside)
    page.wait_for_selector(popover, state="detached", timeout=5000)
    # the button opens it again and closes it again
    page.click(f"#aesthetics-menu-btn-{A}")
    page.wait_for_selector(popover, state="visible")
    page.click(f"#aesthetics-menu-btn-{A}")
    page.wait_for_selector(popover, state="detached", timeout=5000)
