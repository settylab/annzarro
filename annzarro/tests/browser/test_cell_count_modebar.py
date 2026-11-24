"""The Count Plot's Plotly toolbar looks and offers what the Cell Plot's does: no grey box behind it, the same buttons, in
light and dark theme and in every mode that draws a Plotly figure.

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
SETS = [{"source": {"type": "obs", "key": "cell_type"}, "member": {"levels": ["c:T cell", "c:NK cell"]}},
        {"source": {"type": "obs", "key": "pseudotime"}, "member": {"op": ">", "value": 0.5}}]

MODEBAR = """(t) => { const bar = document.querySelector(t + ' .modebar');
    if (!bar) return null;
    const bg = (e) => getComputedStyle(e).backgroundColor;
    const alpha = (c) => { const m = /rgba?\\(([^)]*)\\)/.exec(c); if (!m) return 1; const p = m[1].split(',').map(Number); return p.length > 3 ? p[3] : 1; };
    const layers = [bar, ...bar.querySelectorAll('.modebar-group')].map(e => alpha(bg(e)));
    return { bgAlpha: Math.max(...layers), buttons: [...bar.querySelectorAll('.modebar-btn')].map(b => b.getAttribute('data-title')),
             color: getComputedStyle(bar.querySelector('.modebar-btn svg path, .modebar-btn svg')).fill }; }"""


def _modebar(page, tile):
    page.hover(f"{tile} .js-plotly-plot")
    page.wait_for_selector(f"{tile} .modebar-btn")
    return page.evaluate(MODEBAR, tile)


@pytest.mark.parametrize("theme", ["light", "dark"])
@pytest.mark.parametrize("mode, config", [
    ("hist2d", dict(mode="hist2d", x=DEPTH, y=SCORE)),
    ("density2d", dict(mode="density2d", x=DEPTH, y=SCORE)),
    ("bar", dict(mode="bar", x=CTYPE)),
    ("bar", dict(mode="histogram", x=DEPTH)),          # a link stored as a histogram: a Bar of a number
    ("density", dict(mode="density", x=DEPTH)),
    ("venn", dict(mode="venn", sets=SETS)),
    ("upset", dict(mode="upset", sets=SETS)),
])
def test_the_count_plot_modebar_matches_the_cell_plots(page, served, theme, mode, config):
    configs = {CC: cc._count(**config), P: gp._plot()}
    page.add_init_script(f"try {{ localStorage.setItem('annzarro-theme', '{theme}'); }} catch (e) {{}}")
    cc._open(page, served, configs, open_ids=(CC, P))
    cc._drawn(page, mode)
    page.wait_for_selector(f"{PT} .js-plotly-plot")
    cell = _modebar(page, PT)
    count = _modebar(page, S)
    folder = os.environ.get("ANNZARRO_MODEBAR_SHOTS")
    if folder:
        page.hover(f"{S} .js-plotly-plot")
        box = page.locator(f"{S} .ccnt-plot").bounding_box()
        page.screenshot(path=os.path.join(folder, f"{mode}-{theme}.png"),
                        clip={"x": box["x"] + box["width"] - 360, "y": box["y"], "width": 360, "height": 140})
    assert cell["bgAlpha"] == 0, cell
    assert count["bgAlpha"] == cell["bgAlpha"], (mode, theme, count, cell)
    # a Venn has fixed axes: nothing to zoom or pan, only the camera
    want = ["Download plot as a png"] if mode == "venn" else cell["buttons"]
    assert count["buttons"] == want, (mode, theme, count["buttons"], want)
    assert page.get_attribute("html", "data-theme") == theme, "the page is in the theme asked for"
    assert count["color"] == cell["color"], (mode, theme, count["color"], cell["color"])
