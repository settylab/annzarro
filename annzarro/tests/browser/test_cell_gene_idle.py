"""A drawn Cell-Gene Plot is still: at idle, nothing draws it again (lead, 2026-11-23).

The figure is laid out in px, so the panel builds it again when its plot changes size. The first drawing was built for
the plot's size before the status strip took its height, so a second drawing followed ~190 ms after the panel said
ready: a menu opened on a label in between lost its anchor ("element is not stable"). Every drawing of the plot is
counted from the page's start (Plotly.react on the plot); once the panel is ready, three idle seconds add none.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_cell_gene_panel import (  # noqa: E402,F401 (the fixtures)
    served, page, _open, _plot, _sig, _drawn, P, S1, GA, GENES)
from annzarro.tests.browser import waits  # noqa: E402

GROUPING = {"id": GA, "title": "Grouping 1", "version": 1, "layers": ["logged"],
            "partitionings": [{"source": {"type": "obs", "key": "cell_type"}}, {"source": {"type": "obs", "key": "condition"}}]}

# every Plotly.react on a Cell-Gene plot, counted from the page's start
COUNT_DRAWS = """window.__cgDraws = 0; (function wrap() {
  if (!window.Plotly || !window.Plotly.react) { setTimeout(wrap, 5); return; }
  const real = window.Plotly.react;
  window.Plotly.react = function (gd) { if (gd && gd.classList && gd.classList.contains('cgene-plot')) window.__cgDraws++; return real.apply(this, arguments); };
})();"""


@pytest.mark.parametrize("mode", ["dots", "heatmap"])
def test_at_idle_after_the_first_drawing_nothing_draws_the_plot_again(page, served, mode):
    page.add_init_script(COUNT_DRAWS)
    _open(page, served, {P: _plot(mode=mode, cellAxis={"type": "cell-group", "key": GA}, sections=[{"source": S1, "rows": "genes"}]),
                         S1: _sig(S1, "Markers", GENES[:4]), GA: GROUPING}, open_ids=(P, S1))
    _drawn(page)
    drawn = page.evaluate("() => window.__cgDraws")
    assert drawn >= 1
    waits.expect_stays(lambda: page.evaluate("() => window.__cgDraws") == drawn,
                       "a drawn plot at idle is not drawn again", page=page, seconds=3.0)
