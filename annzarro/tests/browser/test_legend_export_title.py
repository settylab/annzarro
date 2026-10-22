"""A long legend is whole in an exported image; the legend title's size and gap.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.

Export. A column of 64 entries (the clone column of the many-categories fixture) is taller than the plot, so
Plotly shows part of it in a box that scrolls. Both exports (FULL, AS SHOWN) in SVG and PNG must hold every
entry, at every legend position, and the image must be tall enough for the legend.

Title. Size and gap are Plot Options, saved in the panel, the link and the layout.
"""
import base64
import json
import re

import pytest

from annzarro.tests.browser import test_many_categories as M
from annzarro.tests.browser.test_many_categories import server  # noqa: F401  (the fixture)
from annzarro.tests.browser.test_plot_options import page  # noqa: F401  (the fixture)

TILE = '.tile[data-tile-id="cell-plot-M"] .js-plotly-plot'


def _go(page, root, store, **extra):
    link = M._link(root, store, colour="clone")
    head, enc = link.split("#view=")
    view = json.loads(base64.urlsafe_b64decode(enc + "=" * (-len(enc) % 4)))
    view["layout"]["panelConfigs"]["cell-plot-M"].update(extra)
    page.goto(head + "#view=" + base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("="))
    page.wait_for_function("() => document.querySelectorAll('%s .legend g.traces').length >= 20" % TILE, timeout=60000)
    page.wait_for_timeout(1500)


EXPORT = """async ([how, format]) => {
  const { exportImageData } = await import('/static/js/utils/plot-export.js');
  const gd = document.querySelector('%s');
  const names = gd.data.filter(t => t.meta === 'az-legend' && t.showlegend !== false).map(t => t.name);
  const image = await exportImageData(gd, how, { format, width: 700, height: 400, scale: 1 });
  let svg = image, png = null;
  if (format === 'png') {
    const img = new Image(); img.src = image; await img.decode();
    png = { w: img.naturalWidth, h: img.naturalHeight };
    svg = null;
  }
  const out = { names, png, clipped: gd._fullLayout.legend._height > gd._fullLayout.legend._effHeight + 1 };
  if (svg) {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const root = doc.documentElement, box = doc.querySelector('g.legend');
    out.text = [...doc.querySelectorAll('g.legend .legendtext')].map(n => n.textContent);
    out.height = parseFloat(root.getAttribute('height'));
    out.clip = !!(box && box.querySelector('.scrollbox[clip-path]'));
    const m = /translate\\(([-\\d.]+)[ ,]+([-\\d.]+)\\)/.exec(box.getAttribute('transform'));
    out.legendBottom = parseFloat(m[2]) + parseFloat(box.querySelector('rect.bg').getAttribute('height'));
  }
  return out;
}""" % TILE


@pytest.mark.parametrize("how", ["full", "shown"])
@pytest.mark.parametrize("position", ["right", "left", "top", "bottom"])
def test_the_exported_svg_holds_every_legend_entry(page, server, position, how):
    root, store = server
    _go(page, root, store, legendPosition=position)
    r = page.evaluate(EXPORT, [how, "svg"])
    if position in ("right", "left"):
        assert r["clipped"], "the fixture's legend is taller than the plot, or the test shows nothing"
    assert len(r["names"]) == 64 and r["text"] == r["names"], (len(r["text"]), len(r["names"]))
    if position in ("right", "left"):
        assert not r["clip"]
    assert r["legendBottom"] <= r["height"], r


@pytest.mark.parametrize("how", ["full", "shown"])
@pytest.mark.parametrize("position", ["right", "top"])
def test_the_exported_png_is_as_tall_as_the_legend(page, server, position, how):
    root, store = server
    _go(page, root, store, legendPosition=position)
    svg = page.evaluate(EXPORT, [how, "svg"])
    png = page.evaluate(EXPORT, [how, "png"])["png"]
    assert abs(png["h"] - svg["height"] * (2 if how == "shown" else 1)) <= 2 and png["h"] >= svg["legendBottom"], (png, svg)


def test_a_legend_that_fits_exports_as_it_did(page, server):
    root, store = server
    _go(page, root, store)
    page.evaluate("async () => { const gd = document.querySelector('%s'); await Plotly.relayout(gd, { height: 3000 }); }" % TILE)
    r = page.evaluate(EXPORT, ["full", "svg"])
    # the export is 400 high; a legend that needed more would have grown it
    assert r["height"] >= 400


SIZES = """() => { const gd = document.querySelector('%s');
  const t = gd.querySelector('.legend .legendtitletext');
  const first = gd.querySelector('.legend g.traces').getBoundingClientRect();
  return { size: Math.max(...[t, ...t.querySelectorAll('tspan')].map(n => parseFloat(getComputedStyle(n).fontSize) || 0)), gap: first.top - (t.querySelector('tspan.line') || t).getBoundingClientRect().bottom,
           layout: gd._fullLayout.legend.title.font.size }; }""" % TILE


def test_title_size_and_gap(page, server):
    root, store = server
    _go(page, root, store)
    base = page.evaluate(SIZES)
    assert base["size"] == 14
    page.click("#aesthetics-menu-btn-cell-plot-M")
    page.click("details[data-panel='cell-plot-M'][data-section='legend'] summary")
    page.fill("#legend-title-size-cell-plot-M", "24")
    page.press("#legend-title-size-cell-plot-M", "Tab")
    page.wait_for_timeout(800)
    big = page.evaluate(SIZES)
    assert big["size"] == 24, big
    page.fill("#legend-title-gap-cell-plot-M", "30")
    page.press("#legend-title-gap-cell-plot-M", "Tab")
    page.wait_for_timeout(600)
    gap30 = page.evaluate(SIZES)
    page.fill("#legend-title-gap-cell-plot-M", "0")
    page.press("#legend-title-gap-cell-plot-M", "Tab")
    page.wait_for_timeout(600)
    gap0 = page.evaluate(SIZES)
    assert gap30["gap"] > gap0["gap"] + 15, (gap30, gap0)
    page.fill("#legend-title-gap-cell-plot-M", "30")
    page.press("#legend-title-gap-cell-plot-M", "Tab")
    page.wait_for_timeout(600)
    # saved with the panel, and drawn again from the layout
    s = page.evaluate("() => window.PanelManager.saveLayout().panelConfigs['cell-plot-M']")
    assert (s["legendTitleSize"], s["legendTitleGap"]) == (24, 30), s
    link = page.evaluate("""() => { const l = window.PanelManager.saveLayout(); return btoa(JSON.stringify({ v: 1, subset: null, layout: l })); }""")
    enc = link.replace("+", "-").replace("/", "_").rstrip("=")
    page.goto(f"{root}/?dataset_path={store}#view={enc}")
    page.wait_for_function("() => document.querySelectorAll('%s .legend g.traces').length >= 20" % TILE, timeout=60000)
    page.wait_for_timeout(1000)
    again = page.evaluate(SIZES)
    assert again["size"] == 24 and abs(again["gap"] - gap30["gap"]) < 2, (again, gap30)
    # Reset puts the box and the look back
    page.click("#aesthetics-menu-btn-cell-plot-M")
    page.click("details[data-panel='cell-plot-M'][data-section='legend'] summary")
    page.click("#reset-legend-title-size-cell-plot-M")
    page.click("#reset-legend-title-gap-cell-plot-M")
    page.wait_for_timeout(600)
    back = page.evaluate(SIZES)
    assert back["size"] == 14 and abs(back["gap"] - base["gap"]) < 2, (back, base)


@pytest.mark.parametrize("title_size", [None, 24])
def test_title_gap_is_pixels_and_linear(page, server, title_size):
    """The distance from the title's text to the first entry grows by the gap set, within 2 px, for every value."""
    root, store = server
    extra = {"legendTitleSize": title_size} if title_size else {}
    seen = {}
    for n in (0, 1, 5, 10, 20, 40, 80):
        _go(page, root, store, legendTitleGap=n, **extra)
        seen[n] = page.evaluate(SIZES)["gap"]
    for n, gap in seen.items():
        assert abs((gap - seen[0]) - n) <= 2, (n, seen)
    # unset is the blank line it always was: the same as a gap of one line
    _go(page, root, store, **extra)
    base = page.evaluate(SIZES)
    line = round(1.3 * (title_size or 14))
    assert abs((base["gap"] - seen[0]) - line) <= 2, (base, seen, line)
