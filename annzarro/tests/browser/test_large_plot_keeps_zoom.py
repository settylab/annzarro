"""Large-plot mode keeps the zoom when a setting of the plot changes.

The committed 200-cell fixture is served with ``ui.defaults.large_plot_points``
lowered to 100, coloured by a number (so there is a colour map). The user
zooms, then changes the colour map, reverses it, changes the point size and
toggles the legend: the axes stay where they were put, as in the regular plot.
A double click still resets the zoom, and the address records the zoom: a
page opened from it shows the same view.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI).
"""
import pytest

from annzarro.tests.browser.test_large_plot_subset_roundtrip import server, GD, playwright  # noqa: F401
from annzarro.tests.browser.test_large_plot_legend_hidden import page, READY  # noqa: F401
from annzarro.tests.browser.test_large_plot_legend_off import _link

PID = "cell-plot-a"
RANGES = """() => { const l = document.querySelector('%s')._fullLayout;
  return [Array.from(l.xaxis.range).map(Number), Array.from(l.yaxis.range).map(Number)]; }""" % GD


def _close(a, b, tol=1e-3):
    return all(abs(p - q) < tol * max(1, abs(q)) for r, s in zip(a, b) for p, q in zip(r, s))


def _drawn_again(page):
    """The ranges after the redraw a setting causes (the point index is rebuilt)."""
    page.wait_for_timeout(2500)
    page.wait_for_function(READY, timeout=60000)
    return page.evaluate(RANGES)


def _zoom(page):
    x, y = page.evaluate(RANGES)
    view = [[x[0] + (x[1] - x[0]) / 4, x[1] - (x[1] - x[0]) / 4], [y[0] + (y[1] - y[0]) / 4, y[1] - (y[1] - y[0]) / 4]]
    page.evaluate("""([x, y]) => Plotly.relayout(document.querySelector('%s'),
        {'xaxis.range[0]': x[0], 'xaxis.range[1]': x[1], 'yaxis.range[0]': y[0], 'yaxis.range[1]': y[1]})""" % GD, view)
    page.wait_for_timeout(500)
    return view, (x, y)


@pytest.mark.parametrize("extra", [{}, {"flipY": True}, {"flipX": True}], ids=["plain", "flipY", "flipX"])
def test_zoom_survives_settings_changes_and_resets_on_double_click(page, server, extra):
    # a flipped axis is drawn with autorange 'reversed', which Plotly lets win over a range
    page.goto(_link(server, key="total_counts", **extra))
    page.wait_for_function(READY, timeout=60000)
    page.wait_for_timeout(1500)
    before = page.evaluate("() => location.hash")
    view, fitted = _zoom(page)
    assert not _close(view, fitted)

    # the address records the zoom: a link made from it opens at the same view
    page.wait_for_function("(old) => location.hash !== old", arg=before, timeout=15000)
    page.wait_for_timeout(2500)
    href = page.evaluate("() => location.href")
    page2 = page.context.browser.new_page(viewport={"width": 1400, "height": 900})
    page2.on("pageerror", lambda e: page.errors.append(str(e)))
    page2.goto(href)
    page2.wait_for_function(READY, timeout=60000)
    page2.wait_for_timeout(1500)
    assert _close(page2.evaluate(RANGES), view), "the address did not record the zoom"
    page2.close()

    # a colour map, then reversed
    page.select_option(f"#color-scale-{PID}", "Blues")
    assert _close(_drawn_again(page), view), "the colour map reset the zoom"
    page.click(f"#reverse-colormap-{PID}")
    assert _close(_drawn_again(page), view), "Reverse reset the zoom"

    # a point size
    page.fill(f"#point-size-input-{PID}", "6")
    page.dispatch_event(f"#point-size-input-{PID}", "change")
    assert _close(_drawn_again(page), view), "the point size reset the zoom"

    # the legend (the colour bar) off and on
    page.click(f"#aesthetics-menu-btn-{PID}")
    page.wait_for_selector(f"details[data-panel='{PID}']", state="visible")
    page.click(f"details[data-panel='{PID}'][data-section='legend'] summary")
    page.wait_for_timeout(300)
    for on in (False, True):
        page.evaluate("""([id, on]) => { const b = document.getElementById('show-legend-' + id);
            b.checked = on; b.dispatchEvent(new Event('change', { bubbles: true })); }""", [PID, on])
        assert _close(_drawn_again(page), view), f"showing the legend ({on}) reset the zoom"

    # double click is still the way back to the fitted axes
    box = page.query_selector(GD + " .nsewdrag").bounding_box()
    page.mouse.dblclick(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.wait_for_timeout(1500)
    # (the fitted ranges are not compared: the menu opened above took room from the plot)
    after = page.evaluate(RANGES)
    for axis in (0, 1):
        assert abs(after[axis][1] - after[axis][0]) > 1.5 * abs(view[axis][1] - view[axis][0]), \
            "a double click no longer resets the zoom"
