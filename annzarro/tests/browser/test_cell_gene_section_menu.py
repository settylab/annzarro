"""The section ⋯ menu is on top of everything (operator, 2026-11-23: "the selection goes under the plot content and some
options like Remove or Duplicate cannot be selected sometimes").

The last section's menu opens over the plot in a small tile. Each item must be what the pointer hits at its centre
(document.elementFromPoint), in dots, in a heatmap and in 3D; then Remove and Duplicate are clicked through.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_cell_gene_panel import (  # noqa: E402,F401 (the fixtures)
    served, page, _open, _plot, _sig, _drawn, _config, P, TP, S1, S2, GENES)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

ITEM = ".cgene-section__menu-item"

# every visible item of the open section menu: is it what the pointer hits at its centre?
HITS = """(item) => [...document.querySelectorAll(item)].filter(e => e.offsetParent !== null).map(e => {
  const r = e.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const hit = document.elementFromPoint(x, y);
  return { op: e.dataset.op, hit: !!hit && (hit === e || e.contains(hit)),
           what: hit ? hit.tagName.toLowerCase() + '.' + String(hit.className && hit.className.baseVal !== undefined ? hit.className.baseVal : hit.className).split(' ')[0] : null }; })"""


def _open_menu(page, i):
    page.locator(f"{TP} .cgene-section").nth(i).locator(".cgene-section__menu-btn").click()
    page.wait_for_selector(f"{ITEM}[data-op='remove']:visible", timeout=10000)


@pytest.mark.parametrize("view", ["dots", "heatmap", "3d"])
def test_the_section_menu_is_on_top_of_the_plot_and_its_items_work(page, served, view):
    page.set_viewport_size({"width": 1000, "height": 600})
    cfg = _plot(cellAxis={"type": "obs", "key": "cell_type"}, mode="heatmap" if view == "heatmap" else "dots",
                sections=[{"source": S1, "rows": "genes"}, {"source": S2, "rows": "genes"}, {"source": S1, "rows": "set"}])
    if view == "3d":
        cfg["view"] = "3d"
    _open(page, served, {P: cfg, S1: _sig(S1, "Markers", GENES[:4]), S2: _sig(S2, "Pathway", GENES[4:8])}, open_ids=(P, S1))
    _drawn(page)
    _open_menu(page, 2)
    # the menu reaches over the plot: some item lies below the plot's top edge
    over = page.evaluate("([s, item]) => { const top = document.querySelector(s + ' .cgene-plot').getBoundingClientRect().top;"
                         " return [...document.querySelectorAll(item)].some(e => e.offsetParent !== null && e.getBoundingClientRect().bottom > top); }",
                         [TP, ITEM])
    assert over, "the layout should put the menu over the plot, else this test proves nothing"
    hits = page.evaluate(HITS, ITEM)
    assert hits and all(h["hit"] for h in hits), hits
    # Duplicate, then Remove the copy, through the menu
    page.locator(f"{ITEM}[data-op='duplicate']:visible").click()
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().sections.length === 4", P)
    _open_menu(page, 3)
    assert all(h["hit"] for h in page.evaluate(HITS, ITEM))
    page.locator(f"{ITEM}[data-op='remove']:visible").click()
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().sections.length === 3", P)
