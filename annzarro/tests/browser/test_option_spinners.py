"""Plot Options number boxes: one click on a spinner arrow steps the value once and the menu stays where it is.

The menu was placed when it opened and not again when a group opened and made it taller, so the first change
of an option (even a press in a box that changed nothing) moved it, under the pointer.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import pytest

from annzarro.tests.browser.test_plot_options import (  # noqa: F401
    A, _cfgs, _menu, _open, page, server)

# (group, box, the plot's settings, the value the arrow gives)
BOXES = [("legend", f"#legend-columns-{A}", {"legendColumns": 2}, "3"),
         ("legend", f"#legend-dot-size-{A}", {"legendDotSize": 10}, "11"),
         ("text", f"#font-size-{A}", {}, "13")]


def _box(page):
    return page.evaluate("""() => { const r = document.querySelector('.aesthetics-popover').getBoundingClientRect();
        return [r.x, r.y, r.width, r.height]; }""")


@pytest.mark.parametrize("section,selector,extra,want", BOXES)
def test_first_spinner_click_steps_once_and_menu_stays(page, server, section, selector, extra, want):
    _open(page, server, _cfgs(extra_a=extra))
    _menu(page, A, section)
    page.wait_for_timeout(600)
    before = _box(page)
    box = page.locator(selector).bounding_box()
    x, y = box["x"] + box["width"] - 12, box["y"] + box["height"] * 0.3      # the up arrow
    page.mouse.move(x, y)
    page.mouse.click(x, y)
    page.wait_for_timeout(800)
    assert page.input_value(selector) == want
    after = _box(page)
    assert all(abs(a - b) < 1 for a, b in zip(before, after)), (before, after)


def test_menu_follows_its_size_when_a_group_opens(page, server):
    _open(page, server)
    _menu(page, A, "text")
    _menu(page, A, "margins")
    _menu(page, A, "legend")
    page.wait_for_timeout(600)
    top, height = _box(page)[1], _box(page)[3]
    assert top >= 0 and top + height <= page.viewport_size["height"] + 1, (top, height)   # all of it in view
    page.fill(f"#font-size-{A}", "14")
    page.press(f"#font-size-{A}", "Tab")
    page.wait_for_timeout(500)
    assert abs(_box(page)[1] - top) < 1      # a change of an option leaves the menu where it is
