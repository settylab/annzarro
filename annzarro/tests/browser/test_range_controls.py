"""The range boxes in the Cell-Gene and Count Plots' Color pop-overs, in a real browser: Min and Max (and Center) of each
scale in one box style. An unset box reads the value drawn, never empty; a set box shows its number; the scale's
reset (the arrow) returns it to auto in one undo step.

1.  Cell-Gene colour: Min, Max and Center boxes reach cmin, cmax; auto with the drawn value; reset, then Undo.
2.  Cell-Gene size (dots): "Size min (% expressing)" and "Size max (% expressing)", stored as dotMin and dotMax; the dots' sizes follow.
3.  Cell-Gene 3D height: new Height min and max boxes limit the bars; reset, then Undo.
4.  Count Plot colour: Min, Max and Center, auto with the drawn value, reset, then Undo.
5.  An old link's fields (`limits`, `dotMin`, `dotMax`) are read.

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


def _gene(page, served, **fields):
    _open(page, served, {P: _plot(cellAxis=OBS, sections=[{"source": S1}], **fields), S1: _sig(S1, "Markers", GENES[:4])}, open_ids=(P, S1))
    _drawn(page)
    page.click(f"{TP} .cgene-color-btn")
    page.wait_for_selector(POP)


def _redrawn(page, check):
    until(page, "([s, f]) => { const p = document.querySelector(s); return !!p && !!p.data && (new Function('p', 'return (' + f + ')(p)'))(p); }",
          [PLOT, check], timeout=30)


def _box(page, option):
    return f"{POP} [data-option='{option}']"


def _type(page, selector, text):
    page.fill(selector, text)
    page.press(selector, "Enter")


def _placeholder(page, option):
    return page.eval_on_selector(_box(page, option), "e => e.placeholder")


def _is_drawn(text):
    """A placeholder that is the drawn value alone (a number), not the word auto."""
    try:
        float(text)
    except ValueError:
        return False
    return True


def _cfg(page, field):
    return page.evaluate("([id, f]) => window.PanelManager.getPanel(id).getConfig()[f]", [P, field])


def test_an_unset_scale_reads_auto_with_the_drawn_value_and_never_empty(page, served):
    _gene(page, served)
    for option in ("min", "max", "dotMin", "dotMax"):
        text = _placeholder(page, option)
        float(text)       # the drawn value alone: it fits the box, and the title says it is automatic
        assert "follows" in page.get_attribute(_box(page, option), "title").lower(), option
        assert page.input_value(_box(page, option)) == ""
    assert _placeholder(page, "center") == "auto"
    drawn = page.evaluate("(s) => { const m = document.querySelector(s).data[0].marker; return [m.cmin, m.cmax]; }", PLOT)
    assert float(_placeholder(page, "max")) == pytest.approx(drawn[1], rel=0.01, abs=0.01)


def test_cell_gene_colour_boxes_reach_the_figure_and_reset_to_auto_with_undo(page, served):
    _gene(page, served)
    _type(page, _box(page, "max"), "2")
    until(page, "(id) => JSON.stringify(window.PanelManager.getPanel(id).getConfig().limits) === '[null,2]'", P)
    _redrawn(page, "(p) => p.data[0].marker.cmax === 2")
    assert page.input_value(_box(page, "max")) == "2"
    assert page.is_enabled(_box(page, "colorRange"))
    page.click(_box(page, "colorRange"))
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().limits === undefined", P)
    assert page.input_value(_box(page, "max")) == "" and _is_drawn(_placeholder(page, "max"))
    page.click(f"{TP} .cgene-undo")
    until(page, "(id) => JSON.stringify(window.PanelManager.getPanel(id).getConfig().limits) === '[null,2]'", P)
    page.click(f"{TP} .cgene-color-btn")      # a press outside closed the pop-over
    page.wait_for_selector(POP)
    assert page.input_value(_box(page, "max")) == "2", "Undo restores the value"


def test_the_size_boxes_are_named_by_the_statistic_and_keep_the_stored_fields(page, served):
    _gene(page, served)
    labels = page.eval_on_selector_all(f"{POP} .az-range__label", "els => els.map(e => e.textContent)")
    assert "Size min (% expressing)" in labels and "Size max (% expressing)" in labels, labels
    assert not any("% at the" in t for t in labels), labels
    sizes = "(s) => JSON.stringify(Array.from(document.querySelector(s).data[0].marker.size))"
    first = page.evaluate(sizes, PLOT)
    _type(page, _box(page, "dotMax"), "20")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().dotMax === 20", P)
    until(page, "([s, was]) => JSON.stringify(Array.from(document.querySelector(s).data[0].marker.size)) !== was", [PLOT, first], timeout=30)
    _type(page, _box(page, "dotMin"), "5")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().dotMin === 5", P)
    page.click(_box(page, "sizeRange"))
    until(page, "(id) => { const c = window.PanelManager.getPanel(id).getConfig(); return c.dotMin === undefined && c.dotMax === undefined; }", P)
    assert _is_drawn(_placeholder(page, "dotMax"))
    page.click(f"{TP} .cgene-undo")
    until(page, "(id) => { const c = window.PanelManager.getPanel(id).getConfig(); return c.dotMin === 5 && c.dotMax === 20; }", P)


def test_cell_gene_3d_height_boxes_limit_the_bars_and_reset_with_undo(page, served):
    _gene(page, served, view="3d")
    _redrawn(page, "(p) => p.data[0].type === 'mesh3d'")
    top = "(s) => { const m = document.querySelector(s).data[0]; let t = 0; for (let k = 0; k < m.z.length; k++) if (m.z[k] > t) t = m.z[k]; return t; }"
    drawn = page.evaluate(top, PLOT)
    assert _is_drawn(_placeholder(page, "heightMax"))
    limit = round(drawn / 2, 3)
    _type(page, _box(page, "heightMax"), str(limit))
    until(page, "([id, v]) => { const l = window.PanelManager.getPanel(id).getConfig().heightLimits; return Array.isArray(l) && l[1] === v; }", [P, limit])
    until(page, "([s, v]) => { const m = document.querySelector(s).data[0]; let t = 0; for (let k = 0; k < m.z.length; k++) if (m.z[k] > t) t = m.z[k]; return Math.abs(t - v) < 1e-6; }",
          [PLOT, limit], timeout=30)
    page.click(_box(page, "heightRange"))
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().heightLimits === undefined", P)
    page.click(f"{TP} .cgene-undo")
    until(page, "([id, v]) => { const l = window.PanelManager.getPanel(id).getConfig().heightLimits; return Array.isArray(l) && l[1] === v; }", [P, limit])
    page.click(f"{TP} .cgene-color-btn")
    page.wait_for_selector(POP)
    assert page.input_value(_box(page, "heightMax")) == str(limit)


def test_cell_gene_2d_has_no_height_boxes(page, served):
    _gene(page, served)
    assert page.locator(_box(page, "heightMax")).is_hidden()


def test_an_old_link_with_limits_dotmin_and_dotmax_shows_them_in_the_boxes(page, served):
    _gene(page, served, limits=[0.1, 0.9], dotMin=5, dotMax=60)
    assert float(page.input_value(_box(page, "min"))) == 0.1
    assert float(page.input_value(_box(page, "max"))) == 0.9
    assert float(page.input_value(_box(page, "dotMin"))) == 5
    assert float(page.input_value(_box(page, "dotMax"))) == 60
    _redrawn(page, "(p) => p.data[0].marker.cmin === 0.1 && p.data[0].marker.cmax === 0.9")


def test_count_colour_boxes_read_auto_reach_the_trace_and_reset_with_undo(page, served):
    cc._open(page, served, {CC: cc._count(mode="hist2d", x={"source": {"type": "obs", "key": "depth"}}, y={"source": {"type": "obs", "key": "score"}})})
    cc._drawn(page, "hist2d")
    page.click(f"{CS} .ccnt-color-btn")
    page.wait_for_selector(POP)
    assert _is_drawn(_placeholder(page, "max")) and _is_drawn(_placeholder(page, "min"))
    assert _placeholder(page, "center") == "auto"
    assert page.input_value(_box(page, "max")) == ""
    _type(page, f"{POP} .ccnt-color-max", "3")
    _type(page, f"{POP} .ccnt-color-min", "1")
    cc._drawn(page, "hist2d", "c.color.max === 3 && c.color.min === 1")
    until(page, "(s) => { const t = document.querySelector(s + ' .ccnt-plot').data[0]; return t.zmax === 3 && t.zmin === 1; }", CS, timeout=30)
    page.click(_box(page, "colorRange"))
    cc._drawn(page, "hist2d", "c.color === undefined")
    assert page.input_value(_box(page, "max")) == "" and _is_drawn(_placeholder(page, "max"))
    page.click(f"{CS} .ccnt-undo")
    cc._drawn(page, "hist2d", "c.color.max === 3 && c.color.min === 1")
    page.click(f"{CS} .ccnt-color-btn")
    page.wait_for_selector(POP)
    assert page.input_value(_box(page, "max")) == "3", "Undo restores the value"


SHOTS = os.environ.get("ANNZARRO_SHOTS")


@pytest.mark.skipif(not SHOTS, reason="screenshots only when ANNZARRO_SHOTS names a directory")
def test_screenshots_of_the_range_controls(page, served):
    os.makedirs(SHOTS, exist_ok=True)
    _gene(page, served, view="3d")
    _type(page, _box(page, "max"), "1")
    until(page, "(id) => !!window.PanelManager.getPanel(id).getConfig().limits", P)
    page.locator(POP).screenshot(path=os.path.join(SHOTS, "cell-gene-color-popover.png"))
    page.locator(TP).screenshot(path=os.path.join(SHOTS, "cell-gene-3d-limited.png"))
    page.keyboard.press("Escape")
    cc._open(page, served, {CC: cc._count(mode="hist2d", x={"source": {"type": "obs", "key": "depth"}}, y={"source": {"type": "obs", "key": "score"}})})
    cc._drawn(page, "hist2d")
    page.click(f"{CS} .ccnt-color-btn")
    page.wait_for_selector(POP)
    _type(page, f"{POP} .ccnt-color-max", "3")
    cc._drawn(page, "hist2d", "c.color.max === 3")
    page.locator(POP).screenshot(path=os.path.join(SHOTS, "count-color-popover.png"))
    page.locator(CS).screenshot(path=os.path.join(SHOTS, "count-plot-limited.png"))
