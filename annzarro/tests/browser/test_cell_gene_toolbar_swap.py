"""Swap axes is a button of the Cell-Gene toolbar (operator, 2026-11-23: "it is often pushed on its own").

The toolbar is ui/plot-toolbar.js's row, [3D] [Swap axes] [Cluster ▾] [Color ▾] … [Undo] [⚙ Plot Options] (decision 39).
At a wide and a narrow tile, Swap axes is in that row and never alone on a line of it; it swaps, and Undo swaps back.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_cell_gene_panel import (  # noqa: E402,F401 (the fixtures)
    served, page, _open, _plot, _sig, _drawn, _config, P, TP, S1, GENES)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

# where Swap axes is: in the toolbar, its order there, and the buttons on its line
WHERE = """(s) => { const swap = document.querySelector(s + ' .cgene-swap');
  const bar = swap && swap.closest('.az-plot-toolbar');
  const buttons = bar ? [...bar.querySelectorAll(':scope > .btn')].filter(b => b.offsetParent !== null) : [];
  const top = (b) => Math.round(b.getBoundingClientRect().top);
  return { inBar: !!bar, order: buttons.map(b => b.textContent.trim()),
           sameLine: buttons.filter(b => b !== swap && Math.abs(top(b) - top(swap)) <= 2).length }; }"""


@pytest.mark.parametrize("width", [1500, 700, 520])
def test_swap_axes_is_in_the_toolbar_row_and_never_alone(page, served, width):
    page.set_viewport_size({"width": width, "height": 1000})
    _open(page, served, {P: _plot(cellAxis={"type": "obs", "key": "cell_type"}, sections=[{"source": S1, "rows": "genes"}]),
                         S1: _sig(S1, "Markers", GENES[:4])})
    _drawn(page)
    where = page.evaluate(WHERE, TP)
    assert where["inBar"], where
    assert where["order"][:4] == ["3D", "Swap axes", "Cluster ▾", "Color ▾"], where
    assert where["sameLine"] >= 1, f"Swap axes alone on its line at {width} px: {where}"
    page.click(f"{TP} .cgene-swap")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().swap === true", P)
    assert page.get_attribute(f"{TP} .cgene-swap", "aria-pressed") == "true"
    page.click(f"{TP} .cgene-undo")
    until(page, "(id) => !window.PanelManager.getPanel(id).getConfig().swap", P)
    assert page.get_attribute(f"{TP} .cgene-swap", "aria-pressed") == "false"
