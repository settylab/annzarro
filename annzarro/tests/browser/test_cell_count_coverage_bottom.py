"""The Count Plot's coverage banner sits under the plot, where the Cell Plot puts it (the status strip of panel-surface.js,
inserted right after the plot), its details open over the plot without resizing the panel, and the footer line does not
say the same thing again.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import test_cell_count_panel as cc  # noqa: E402
from annzarro.tests.browser import test_cell_group_plots as gp  # noqa: E402

served = cc.served
page = cc.page
CC, S = cc.CC, cc.S
P = gp.P
PT = f'.tile[data-tile-id="{P}"]'

# a banner with something to say: the cells below the range are left out
RANGED = dict(mode="histogram", x={"source": {"type": "obs", "key": "depth"}, "binning": {"method": "equal_width", "range": [1, None]}})

GEOMETRY = """([tile, host]) => {
    const t = document.querySelector(tile);
    const h = t.querySelector(host);
    const strip = t.querySelector('.plot-status');
    const hr = h.getBoundingClientRect(), sr = strip.getBoundingClientRect();
    return { prevIsHost: strip.previousElementSibling === h || strip.previousElementSibling.contains(h) || h.contains(strip.previousElementSibling),
             below: sr.top >= hr.bottom - 1, overlap: Math.max(0, hr.bottom - sr.top), stripH: Math.round(sr.height) }; }"""


def _count_and_cell_plot(page, served):
    configs = {CC: cc._count(**RANGED), P: gp._plot()}
    cc._open(page, served, configs, open_ids=(CC, P))
    cc._drawn(page, "bar")
    page.wait_for_selector(f"{PT} .js-plotly-plot")
    page.wait_for_selector(f"{PT} .plot-status")
    page.wait_for_selector(f"{S} .plot-status")


def test_the_banner_is_below_the_plot_box_as_in_the_cell_plot(page, served):
    _count_and_cell_plot(page, served)
    cell = page.evaluate(GEOMETRY, [PT, ".js-plotly-plot"])
    count = page.evaluate(GEOMETRY, [S, ".ccnt-plot"])
    assert cell["prevIsHost"] and cell["below"], cell
    assert count["prevIsHost"] and count["below"], count
    assert count["overlap"] == 0 and count["stripH"] == cell["stripH"], (count, cell)
    # the banner is the last thing in the plot area's column, not over the plot's top
    assert page.evaluate("(s) => document.querySelector(s + ' .plot-status').nextElementSibling === null || "
                         "document.querySelector(s + ' .plot-status').nextElementSibling.classList.contains('ccnt-state-box')", S)


def test_the_details_open_over_the_plot_without_resizing_the_panel_and_the_footer_does_not_repeat_them(page, served):
    _count_and_cell_plot(page, served)
    box = lambda: page.evaluate("""(s) => { const q = (x) => { const r = document.querySelector(s + ' ' + x).getBoundingClientRect();
        return [r.left, r.top, r.width, r.height].map(Math.round); }; return [q('.ccnt-panel'), q('.ccnt-plot'), q('.plot-status')]; }""", S)
    before = box()
    page.click(f"{S} .plot-status .ps-summary")
    page.wait_for_selector(f"{S} .plot-status .ps-pop:not([hidden])")
    assert box() == before, "the details do not resize the panel, the plot or the banner"
    inside = page.evaluate("""(s) => { const p = document.querySelector(s + ' .ps-pop').getBoundingClientRect();
        const t = document.querySelector(s + ' .ccnt-panel').getBoundingClientRect();
        return p.top >= t.top && p.bottom <= t.bottom && p.left >= t.left && p.right <= t.right; }""", S)
    assert inside, "the details open fully inside the panel"
    assert "outside the range" in page.inner_text(f"{S} .ps-pop")
    page.keyboard.press("Escape")
    # the footer says nothing the banner says: no counted / outside-the-range sentence
    assert page.query_selector(f"{S} .ccnt-strip") is None, "there is no footer line under the banner"
