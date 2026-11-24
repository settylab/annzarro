"""The "Add New Panel" tile takes the height the layout gives it and scrolls inside (0.8.0, operator: "does not need to have
a minimum size to show all panels and can instead be scrollable. Otherwise the minimum size can grow indefinitely and it is
disruptive to the layout when spawned").

Splitting a tile spawns the tile in the new pane. Its height is the pane's, its content scrolls, and the row (and the tile it
was split from) keep their height.
"""
import urllib.parse

import pytest

from annzarro.tests.browser.test_nested_split_links import (  # noqa: E402,F401
    _choose, _open, browser, server)

CHOOSER = ".split-pane > .tile-selector:not([data-is-bottom-selector='true'])"
GEOMETRY = """() => { const r = (e) => e.getBoundingClientRect();
  const row = document.querySelector('.tile-container > .panel-wrapper');
  const pane = document.querySelector("%s");
  const tile = document.querySelector('.tile[data-tile-id]');
  const box = pane.querySelector('.tile-selection-container');
  return {row: r(row).height, tile: r(tile).height, chooser: r(pane).height, pane: r(pane.parentElement).height,
          scrolls: box.scrollHeight > box.clientHeight + 1, overflow: getComputedStyle(box).overflowY,
          heading: r(pane.querySelector('.tile-selection-header')).bottom <= r(pane).bottom, entries: pane.querySelectorAll('.panel-type-option').length}; }""" % CHOOSER


@pytest.mark.parametrize("direction", ["horizontal", "vertical"])
@pytest.mark.parametrize("viewport", [{"width": 1400, "height": 1000}, {"width": 1400, "height": 520}])
def test_a_spawned_add_panel_tile_has_the_pane_height_and_scrolls(server, browser, direction, viewport):
    server, store = server
    ctx = browser.new_context(viewport=viewport)
    try:
        page = ctx.new_page()
        _open(page, f"{server}/?dataset_path={urllib.parse.quote(store, safe='/')}")
        page.wait_for_selector(".panel-type-option[data-type='cell-plot']", timeout=30000)
        tile = _choose(page, ".tile-selector", "cell-plot")
        before = page.evaluate(GEOMETRY.replace("const pane = document.querySelector(\"%s\")" % CHOOSER, "const pane = document.querySelector('.tile-container .tile')")
                               .replace("pane.querySelector('.tile-selection-header')", "pane").replace("box = pane.querySelector('.tile-selection-container')", "box = pane"))
        page.locator(f".tile[data-tile-id='{tile}'] .tile-split-{direction[0]}").first.click()
        page.wait_for_selector(CHOOSER, state="visible")
        got = page.evaluate(GEOMETRY)
        assert got["entries"] > 3
        assert abs(got["chooser"] - got["pane"]) <= 1, f"the tile is as tall as its pane, not as its content: {got}"
        if viewport["height"] >= 1000:     # room for it: the layout does not move (a short row may grow by the tile's bounded minimum)
            assert abs(got["row"] - before["row"]) <= 1, f"spawning the tile resized the row: {before['row']} -> {got['row']}"
        else:
            assert got["row"] - before["row"] <= 200, f"the minimum of the tile is bounded: {before['row']} -> {got['row']}"
            assert got["chooser"] >= 170, got
        assert got["scrolls"] and got["overflow"] in ("auto", "scroll"), got
        assert got["heading"], f"the heading is in view: {got}"
    finally:
        ctx.close()
