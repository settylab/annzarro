"""The Count Plot's colour bar is the Cell Plot's: the same builder (plot-utilities/colour-bar.js), so its title runs along
the bar on its right side, with the same font, thickness, length and position.

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
CC, S, P = cc.CC, cc.S, gp.P
PT = f'.tile[data-tile-id="{P}"]'
DEPTH = {"source": {"type": "obs", "key": "depth"}}
SCORE = {"source": {"type": "obs", "key": "score"}}
CTYPE = cc.CELL_TYPE

BAR = """(t) => { const gd = document.querySelector(t + ' .js-plotly-plot');
    const full = gd._fullData.find(d => (d.colorbar && d.showscale !== false) || (d.marker && d.marker.colorbar && d.marker.showscale !== false));
    const b = full.colorbar || full.marker.colorbar;
    const pick = (o, ...k) => Object.fromEntries(k.map(x => [x, o[x]]));
    return { ...pick(b, 'orientation', 'thickness', 'len', 'lenmode', 'x', 'xanchor', 'y', 'yanchor', 'ticklabelposition'),
             titleSide: b.title.side, titleFont: pick(b.title.font, 'size', 'family'), tickFont: pick(b.tickfont, 'size', 'family'),
             titleText: b.title.text }; }"""


@pytest.mark.parametrize("mode, config", [
    ("hist2d", dict(mode="hist2d", x=DEPTH, y=SCORE)),
    ("density2d", dict(mode="density2d", x=DEPTH, y=SCORE)),
    ("heatmap", dict(mode="heatmap", x=CTYPE, y=cc.CONDITION)),
    ("hist2d", dict(mode="hist2d", x=DEPTH, y=SCORE, value={"kind": "measure"}, measure={"stat": "mean", "source": {"type": "obs", "key": "score"}})),
])
def test_the_count_plot_colour_bar_matches_the_cell_plots(page, served, mode, config):
    cell_plot = gp._plot(color={"type": "obs", "key": "depth", "column": ""}, styleDefault=True)   # a plot made now (on Default) has the default font; one saved with none is Arial
    cc._open(page, served, {CC: cc._count(**config), P: cell_plot}, open_ids=(CC, P))
    cc._drawn(page, mode)
    page.wait_for_selector(f"{PT} .js-plotly-plot .colorbar")
    page.wait_for_selector(f"{S} .js-plotly-plot .colorbar")
    folder = os.environ.get("ANNZARRO_COLOURBAR_SHOTS")
    if folder:
        page.locator(f"{S} .ccnt-plot").screenshot(path=os.path.join(folder, f"{mode}-{len(os.listdir(folder))}.png"))
    cell = page.evaluate(BAR, PT)
    count = page.evaluate(BAR, S)
    assert cell["titleSide"] == "right" and cell["orientation"] == "v", cell
    count_title, cell_title = count.pop("titleText"), cell.pop("titleText")
    assert count_title, "the count plot's bar has a title"
    assert count == cell, (count, cell)
