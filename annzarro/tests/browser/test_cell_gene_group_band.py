"""The Cell-Gene Plot's colour strips: Factors (default), Group or None, in Plot Options (operator, 2026-11-24).

Factors draws one strip per factor of the grouping; Group draws only the combined Group band, each group in its own
colour from the one resolver (utils/grouping-colours.js, decision 38: the grid swatch's colour); None draws no colour
strip, and the other annotations (Cells per group) stay. The legend follows what is drawn. An older link's
`groupBand: false` opens with the default.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
from annzarro.tests.browser.test_grouping_palettes import (  # noqa: E402,F401 (the fixtures: a store with uns colours)
    served, page, _open, _grid, _rgb, _config, GROUP_NAMES, TWO, GENES, S1, GP, GT, _gene_plot, _sig)
from annzarro.tests.browser.test_cell_grouping_panel import A, GA, _grouping  # noqa: E402
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

# what the colour strips are: each strip's factor (the name its hover gives each group), and the strip legends' count
STRIPS = """(s) => { const gd = document.querySelector(s + ' .cgene-plot'); if (!gd || !gd.data) return null;
  const strips = gd.data.filter((d) => d.name === 'group strip');
  return { factors: strips.map((t) => ((t.hovertext || [''])[0].split('<br>')[1] || '').split(':')[0]).sort(),
           legends: gd.data.filter((d) => d.name === 'strip legend').length,
           totals: gd.data.some((d) => d.name === 'cells per group'),
           band: (strips.find((t) => (t.hovertext || [])[0].includes('<br>Group: ')) || null) && Object.fromEntries(
             strips.find((t) => (t.hovertext || [])[0].includes('<br>Group: ')).hovertext.map((h, i) =>
               [h.split('<br>Group: ')[1], Array.from(strips.find((t) => (t.hovertext || [])[0].includes('<br>Group: ')).marker.color)[i]])) }; }"""
SELECT = "[data-popover='plot-options'] [data-option='colorStrips']"


def _ready(page):
    until(page, "(s) => { const e = document.querySelector(s + ' .cgene-panel'); return !!e && e.dataset.state === 'ready'; }", GT, timeout=60)


def _strips(page):
    return page.evaluate(STRIPS, GT)


def _until(page, check):
    until(page, f"(s) => {{ const f = ({STRIPS})(s); return !!f && ({check})(f); }}", GT)
    return _strips(page)


def _choose(page, value):
    if page.locator(SELECT).count() == 0:
        page.click(f"{GT} .cgene-options-btn")
    page.select_option(SELECT, value)


def _gene(**fields):
    return _gene_plot(cellAxis={"type": "cell-group", "key": GA}, sections=[{"source": S1, "rows": "genes"}], totals=True, **fields)


def test_factors_by_default_then_group_then_none_each_with_undo(page, served):
    _open(page, served, {GP: _gene(), S1: _sig(S1, "Markers", GENES[:4]), GA: _grouping(partitionings=TWO)}, (GP, S1, GA))
    _ready(page)
    # Factors: one strip per factor and its legend, no Group band
    f = _until(page, "(f) => f.factors.length > 0")
    assert f["factors"] == ["cell_type", "condition"] and f["legends"] == 2 and f["band"] is None and f["totals"], f
    # Group: only the band, each group in its own colour; a swatch colour reaches it, the grouping's Undo takes it back
    _choose(page, "group")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().colorStrips === 'group'", GP)
    f = _until(page, "(f) => !!f.band")
    assert f["factors"] == ["Group"] and f["legends"] == 1 and sorted(f["band"]) == sorted(GROUP_NAMES) and f["totals"], f
    grid = _grid(page)
    assert _rgb(page, [f["band"][n] for n in GROUP_NAMES]) == _rgb(page, [grid[n] for n in GROUP_NAMES]), "the grid's swatch colours"
    page.keyboard.press("Escape")
    page.fill(f"{A} .cgg-row:has(.cgg-name:text-is('B cell | treated')) .cgg-swatch input[type=color]", "#fedcba")
    _until(page, "(f) => !!f.band && f.band['B cell | treated'] === '#fedcba'")
    page.click(f"{A} .cgrp-undo")
    _until(page, "(f) => !!f.band && f.band['B cell | treated'] !== '#fedcba'")
    # None: no colour strip and no strip legend; Cells per group stays
    _choose(page, "none")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().colorStrips === 'none'", GP)
    f = _until(page, "(f) => f.factors.length === 0")
    assert f["legends"] == 0 and f["totals"], f
    page.keyboard.press("Escape")
    # Undo: Group again, then Factors (the default, stored as nothing)
    page.click(f"{GT} .cgene-undo")
    _until(page, "(f) => !!f.band && f.factors.length === 1")
    page.click(f"{GT} .cgene-undo")
    _until(page, "(f) => f.factors.length === 2 && !f.band")
    assert "colorStrips" not in _config(page, GP)


def test_an_older_links_group_band_off_opens_with_the_factor_strips(page, served):
    _open(page, served, {GP: _gene(groupBand=False), S1: _sig(S1, "Markers", GENES[:4]), GA: _grouping(partitionings=TWO)}, (GP, S1, GA))
    _ready(page)
    f = _until(page, "(f) => f.factors.length > 0")
    assert f["factors"] == ["cell_type", "condition"] and f["band"] is None, f
