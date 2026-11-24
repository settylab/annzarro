"""The Cell-Gene tile keeps its height while it works (operator: panels must not resize or move the layout while working).

Three tiles share a row (Grouping, Cell-Gene, Cell Count, each about 460 px wide), and a row is as tall as its tallest
tile's content. The Cell-Gene panel's content grew when it drew: Plotly's figure, sized in px to the plot, plus the
status strip under it, and the clustering's sentence wrapping in the control grid. The row grew with it, by 86 px, and
moved every tile in it. Every tile's box is recorded on every frame from the first paint until the plot is ready and two
seconds after: no tile's height changes by more than 1 px, and the plot reaches ready.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_cell_grouping_popovers import (  # noqa: E402,F401 (the fixtures)
    page, served, _configs, _url, GA, P, CC, TP)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

# every tile's height on every frame, with the Cell-Gene panel's state
RECORD = """window.__tiles = []; (function rec() {
  const tiles = [...document.querySelectorAll('.tile[data-tile-id]')];
  const cg = document.querySelector('.tile[data-tile-id="cell-gene-P"] .cgene-panel');
  if (tiles.length === 3) window.__tiles.push({ t: performance.now() | 0, state: cg ? cg.dataset.state : null,
    h: Object.fromEntries(tiles.map(t => [t.dataset.tileId, t.getBoundingClientRect().height])) });
  requestAnimationFrame(rec); })();"""


@pytest.mark.parametrize("mode", ["dots", "heatmap"])
def test_three_tiles_keep_their_height_while_the_cell_gene_plot_draws(page, served, mode):
    page.set_viewport_size({"width": 1400, "height": 800})
    page.add_init_script(RECORD)
    configs = _configs()
    configs[P] = {**configs[P], "mode": mode}
    page.goto(_url(served, [GA, P, CC], configs))
    until(page, "(s) => { const e = document.querySelector(s + ' .cgene-panel'); return !!e && e.dataset.state === 'ready'; }", TP, timeout=60)
    page.wait_for_timeout(2000)
    frames = page.evaluate("() => window.__tiles")
    assert frames and frames[-1]["state"] == "ready", frames[-1:]
    for tile in frames[0]["h"]:
        heights = [f["h"][tile] for f in frames if tile in f["h"]]
        lo, hi = min(heights), max(heights)
        changed = next((f for f in frames if abs(f["h"][tile] - heights[0]) > 1), None)
        assert hi - lo <= 1, f"{tile}: {lo:.0f} to {hi:.0f} px; first change at {changed['t']} ms, plot {changed['state']}"
