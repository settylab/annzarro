"""The Cell-Gene Plot's Group band: each group in its own colour, as the grid's swatch shows it (operator decisions 33, 38).

The strips show each factor's level; a group's own colour (`groupOverrides`, set from its swatch in the group grid) shows
nowhere else in the plot. A Group band beside the strips shows every group's colour from the one resolver
(utils/grouping-colours.js), when the grouping has more than one factor or a group has its own colour. It can be switched
off in Plot Options. A colour set in the grid reaches it, and the grouping's Undo takes it back.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import pytest

from annzarro.tests.browser.test_grouping_palettes import (  # noqa: E402,F401 (the fixtures: a store with uns colours)
    served, page, _open, _grid, _rgb, _config, GROUP_NAMES, TWO, GENES, S1, GP, GT, _gene_plot, _sig)
from annzarro.tests.browser.test_cell_grouping_panel import A, CELL_TYPE, GA, _grouping  # noqa: E402
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

# the Group band: the strip whose hover names "Group", as {group name: colour} in drawn order
BAND = """(s) => { const gd = document.querySelector(s + ' .cgene-plot'); if (!gd || !gd.data) return null;
  const t = gd.data.find((d) => d.name === 'group strip' && (d.hovertext || []).some((h) => h.includes('<br>Group: ')));
  if (!t) return null;
  return t.hovertext.map((h, i) => [h.split('<br>Group: ')[1], Array.from(t.marker.color)[i]]); }"""


def _ready(page):
    until(page, "(s) => { const e = document.querySelector(s + ' .cgene-panel'); return !!e && e.dataset.state === 'ready'; }", GT, timeout=60)


def _band(page):
    got = page.evaluate(BAND, GT)
    return dict(got) if got else None


def _gene(**fields):
    return _gene_plot(cellAxis={"type": "cell-group", "key": GA}, sections=[{"source": S1, "rows": "genes"}], **fields)


def test_the_group_band_shows_each_groups_colour_and_follows_the_grid_with_undo(page, served):
    _open(page, served, {GP: _gene(), S1: _sig(S1, "Markers", GENES[:4]), GA: _grouping(partitionings=TWO)}, (GP, S1, GA))
    _ready(page)
    band = _band(page)
    assert band is not None, "two factors: the Group band is drawn"
    assert sorted(band) == sorted(GROUP_NAMES)
    grid = _grid(page)
    assert _rgb(page, [band[n] for n in GROUP_NAMES]) == _rgb(page, [grid[n] for n in GROUP_NAMES]), "the grid's swatch colours"
    # a group's own colour, set in the grid, reaches the band
    page.fill(f"{A} .cgg-row:has(.cgg-name:text-is('B cell | treated')) .cgg-swatch input[type=color]", "#fedcba")
    until(page, f"(s) => {{ const b = ({BAND})(s); return !!b && b.some(([n, c]) => n === 'B cell | treated' && c === '#fedcba'); }}", GT)
    assert _config(page)["groupOverrides"] == [{"name": "B cell | treated", "color": "#fedcba"}]
    # the grouping's Undo takes it back
    page.click(f"{A} .cgrp-undo")
    until(page, f"(s) => {{ const b = ({BAND})(s); return !!b && !b.some(([, c]) => c === '#fedcba'); }}", GT)
    # Plot Options switches the band off, and its own Undo on again
    page.click(f"{GT} .cgene-options-btn")
    page.uncheck("[data-popover='plot-options'] [data-option='groupBand']")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().groupBand === false", GP)
    until(page, f"(s) => ({BAND})(s) === null", GT)
    page.keyboard.press("Escape")
    page.click(f"{GT} .cgene-undo")
    until(page, f"(s) => ({BAND})(s) !== null", GT)


def test_one_factor_has_no_group_band_until_a_group_has_its_own_colour(page, served):
    _open(page, served, {GP: _gene(), S1: _sig(S1, "Markers", GENES[:4]), GA: _grouping(partitionings=[CELL_TYPE])}, (GP, S1, GA))
    _ready(page)
    assert _band(page) is None, "one factor and no group of its own colour: the strip says it all"
    page.fill(f"{A} .cgg-row:has(.cgg-name:text-is('B cell')) .cgg-swatch input[type=color]", "#123456")
    until(page, f"(s) => {{ const b = ({BAND})(s); return !!b && b.some(([n, c]) => n === 'B cell' && c === '#123456'); }}", GT)
