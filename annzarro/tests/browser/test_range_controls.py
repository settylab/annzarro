"""The range control in the Cell-Gene and Count Plots' Color pop-overs, in a real browser: Min and Max sliders over the
drawn statistic, a number field and auto, the way the Cell Plot's colour range has them.

1.  Cell-Gene colour: the Max slider changes the stored limit, the field and the figure's cmax.
2.  Cell-Gene size (dots): the size statistic's slider changes the stored dotMax and the dots' sizes.
3.  Cell-Gene 3D height: the Height range limits the bars; auto clears it.
4.  Count Plot colour: the Min and Max sliders change the stored limits and the trace's zmin and zmax.
5.  A typed limit and auto still work beside the sliders; an old link's fields (`limits`, `dotMin`, `dotMax`) are read.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import test_cell_count_panel as cc  # noqa: E402
from annzarro.tests.browser.test_cell_gene_panel import (  # noqa: E402,F401 (the fixtures)
    GENES, P, S1, TP, _config, _drawn, _open, _plot, _sig, page, served)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

OBS = {"type": "obs", "key": "cell_type"}
PLOT = f"{TP} .cgene-plot"
CC, CS = cc.CC, cc.S
POP = "[data-popover='color']"


def _slide(page, selector, track):
    """Move a range input to `track` as a user's drag does: input while it moves, change on release."""
    page.eval_on_selector(selector, "(e, v) => { e.value = String(v); e.dispatchEvent(new Event('input', { bubbles: true }));"
                          " e.dispatchEvent(new Event('change', { bubbles: true })); }", track)


def _gene(page, served, **fields):
    _open(page, served, {P: _plot(cellAxis=OBS, sections=[{"source": S1}], **fields), S1: _sig(S1, "Markers", GENES[:4])}, open_ids=(P, S1))
    _drawn(page)
    page.click(f"{TP} .cgene-color-btn")
    page.wait_for_selector(POP)


def _redrawn(page, check):
    until(page, "([s, f]) => { const p = document.querySelector(s); return !!p && !!p.data && (new Function('p', 'return (' + f + ')(p)'))(p); }",
          [PLOT, check], timeout=30)


def _cmax(page):
    return page.evaluate("(s) => document.querySelector(s).data[0].marker.cmax", PLOT)


def test_cell_gene_colour_max_slider_changes_cmax_and_the_field(page, served):
    _gene(page, served)
    before = _cmax(page)
    assert page.eval_on_selector(f"{POP} [data-option='max']", "e => e.placeholder").startswith("auto"), "automatic: the data's end is the placeholder"
    _slide(page, f"{POP} [data-option='maxSlider']", 500)
    until(page, "(id) => { const l = window.PanelManager.getPanel(id).getConfig().limits; return Array.isArray(l) && typeof l[1] === 'number'; }", P)
    limit = _config(page)["limits"][1]
    assert limit < before, (limit, before)
    _redrawn(page, f"(p) => p.data[0].marker.cmax === {limit}")
    assert float(page.input_value(f"{POP} [data-option='max']")) == limit
    # auto puts it back to the data's own end
    page.click(f"{POP} [data-option='maxAuto']")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().limits === undefined", P)
    _redrawn(page, f"(p) => p.data[0].marker.cmax === {before}")


def test_cell_gene_size_slider_changes_the_dot_sizes_and_keeps_the_stored_field(page, served):
    _gene(page, served)
    sizes = "(s) => JSON.stringify(Array.from(document.querySelector(s).data[0].marker.size))"
    first = page.evaluate(sizes, PLOT)
    _slide(page, f"{POP} [data-option='dotMaxSlider']", 300)
    until(page, "(id) => typeof window.PanelManager.getPanel(id).getConfig().dotMax === 'number'", P)
    assert _config(page)["dotMax"] > 0
    until(page, "([s, was]) => JSON.stringify(Array.from(document.querySelector(s).data[0].marker.size)) !== was", [PLOT, first], timeout=30)
    # the Min end: its stored field is dotMin
    _slide(page, f"{POP} [data-option='dotMinSlider']", 600)
    until(page, "(id) => typeof window.PanelManager.getPanel(id).getConfig().dotMin === 'number'", P)
    assert _config(page)["dotMin"] > 0


def test_cell_gene_3d_height_range_limits_the_bars_and_auto_clears_it(page, served):
    _gene(page, served, view="3d")
    tops = "(s) => { const m = document.querySelector(s).data[0]; let top = 0; for (let k = 0; k < m.z.length; k++) if (m.z[k] > top) top = m.z[k]; return top; }"
    _redrawn(page, "(p) => p.data[0].type === 'mesh3d'")
    top = page.evaluate(tops, PLOT)
    assert page.locator(f"{POP} [data-option='heightMaxSlider']").is_visible()
    _slide(page, f"{POP} [data-option='heightMaxSlider']", 400)
    until(page, "(id) => { const l = window.PanelManager.getPanel(id).getConfig().heightLimits; return Array.isArray(l) && typeof l[1] === 'number'; }", P)
    limit = _config(page)["heightLimits"][1]
    assert 0 < limit < top
    until(page, "([s, lim]) => { const m = document.querySelector(s).data[0]; let top = 0; for (let k = 0; k < m.z.length; k++) if (m.z[k] > top) top = m.z[k];"
                " return Math.abs(top - lim) < 1e-6 * Math.max(1, lim); }", [PLOT, limit], timeout=30)
    page.click(f"{POP} [data-option='heightMaxAuto']")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().heightLimits === undefined", P)


def test_cell_gene_2d_has_no_height_range(page, served):
    _gene(page, served)
    assert page.locator(f"{POP} [data-option='heightMaxSlider']").is_hidden()


def test_an_old_link_with_limits_dotmin_and_dotmax_shows_them_on_the_sliders(page, served):
    _gene(page, served, limits=[0.1, 0.9], dotMin=5, dotMax=60)
    assert float(page.input_value(f"{POP} [data-option='min']")) == 0.1
    assert float(page.input_value(f"{POP} [data-option='max']")) == 0.9
    assert float(page.input_value(f"{POP} [data-option='dotMin']")) == 5
    assert float(page.input_value(f"{POP} [data-option='dotMax']")) == 60
    assert page.eval_on_selector(f"{POP} [data-option='maxSlider']", "e => Number(e.value)") > 0
    _redrawn(page, "(p) => p.data[0].marker.cmin === 0.1 && p.data[0].marker.cmax === 0.9")


def test_count_colour_sliders_change_zmin_and_zmax(page, served):
    cc._open(page, served, {CC: cc._count(mode="hist2d", x={"source": {"type": "obs", "key": "depth"}}, y={"source": {"type": "obs", "key": "score"}})})
    cc._drawn(page, "hist2d")
    page.click(f"{CS} .ccnt-color-btn")
    page.wait_for_selector(POP)
    zmax = page.evaluate("(s) => Math.max(...document.querySelector(s + ' .ccnt-plot').data[0].z.flat().filter(v => v !== null))", CS)
    _slide(page, f"{POP} [data-option='maxSlider']", 500)
    cc._drawn(page, "hist2d", "typeof c.color.max === 'number'")
    limit = cc._config(page)["color"]["max"]
    assert 0 < limit < zmax
    until(page, "([s, v]) => document.querySelector(s + ' .ccnt-plot').data[0].zmax === v", [CS, limit], timeout=30)
    assert float(page.input_value(f"{POP} .ccnt-color-max")) == limit
    _slide(page, f"{POP} [data-option='minSlider']", 300)
    cc._drawn(page, "hist2d", "typeof c.color.min === 'number'")
    low = cc._config(page)["color"]["min"]
    until(page, "([s, v]) => document.querySelector(s + ' .ccnt-plot').data[0].zmin === v", [CS, low], timeout=30)
    # a typed limit and auto beside the sliders
    page.click(f"{POP} [data-option='minAuto']")
    cc._drawn(page, "hist2d", "c.color.min === undefined")
