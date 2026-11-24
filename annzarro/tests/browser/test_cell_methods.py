"""SO-7 of decision 34 in a real browser, against the real cell_groups route: Methods ▾ on the Cell Grouping and on the
Cell Table (offered-removal-080.md 10.2).

The store is the grouping fixture (tests/core/grouping_store.py): X signed, ``logged`` log-normalised and ``counts`` raw
counts.

1.  Methods ▾ sits in the grouping's toolbar (Add factor ▾ · Methods ▾ · Settings · Undo), lists the five statistics with
    their definitions and Expressed above under them; Escape closes it and the panel's box is unchanged.
2.  Expressed above 2 is one undo step of the grouping: a Cell-Gene Plot on that grouping asks each gene at 2 in one POST
    and reads "% expressing (> 2)"; its override box stays empty and says "auto (grouping: 2)". Undo restores 0.
3.  A measure with its own threshold (an override) is unaffected by the grouping's edit.
4.  The Cell Table's Methods ▾ stores `methods: {detect_above}` in the table's configuration, omitted at default, and a
    link carries it back; Escape closes it and the panel's box is unchanged.
5.  Screenshots of both pop-overs (only when ANNZARRO_SHOTS names a directory).

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_cell_gene_panel import (  # noqa: E402,F401
    GA, GENES, P, S1, TP, _config, _drawn, _features, _open, _plot, _sig, _url, page, served)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

SHOTS = os.environ.get("ANNZARRO_SHOTS")
TG = f'.tile[data-tile-id="{GA}"]'
T = "cell-table-T"
TT = f'.tile[data-tile-id="{T}"]'
POP = "[data-popover='methods']"
OBS = {"type": "obs", "key": "cell_type"}
AXIS = {"type": "cell-group", "key": GA}
STATS = ["Mean", "% expressing", "Mean of expressing cells", "Sum", "SD"]


def _grouping(**fields):
    return {"id": GA, "title": "Grouping 1", "version": 1, "partitionings": [{"source": OBS}], **fields}


def _recipe(page):
    return page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig()", GA)


def _hover(page):
    return page.evaluate("(s) => JSON.stringify(document.querySelector(s + ' .cgene-plot').data[0].hovertext"
                         " || document.querySelector(s + ' .cgene-plot').data[0].text)", TP)


def _box(page, selector):
    return page.evaluate("(s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }", selector)


def _set_threshold(page, value):
    box = f"{POP} [data-param='detect_above']"
    page.fill(box, str(value))
    page.press(box, "Enter")


def _plot_on_grouping(page, served, size=None):
    plot = _plot(cellAxis=AXIS, sections=[{"source": S1, "rows": "genes"}],
                 size=size or {"stat": "pct_expressing", "layer": "counts"})
    _open(page, served, {P: plot, GA: _grouping(), S1: _sig(S1, "Markers", GENES[:3])}, open_ids=(P, GA))
    _drawn(page)
    page.wait_for_selector(f"{TG} .cgrp-controls .cmeth__toggle", timeout=30000)


def test_methods_opens_from_the_grouping_toolbar_lists_every_statistic_and_escape_closes_it(page, served):
    _plot_on_grouping(page, served)
    controls = page.locator(f"{TG} .cgrp-controls")
    order = controls.evaluate("(c) => [...c.children].filter(e => !e.hidden).map(e => e.textContent.replace(/\\s+/g, ' ').trim())")
    assert [o.split(" ")[0][:8] for o in order[:4]] == ["Add", "Methods", "Settings", "Undo"], order
    assert "Statistics" not in controls.inner_text()
    before = _box(page, TG)
    page.click(f"{TG} .cmeth__toggle")
    pop = page.locator(POP)
    pop.wait_for(state="visible")
    names = page.eval_on_selector_all(f"{POP} .cmeth__name", "ns => ns.map(n => n.textContent)")
    assert names == STATS, names
    assert page.eval_on_selector_all(f"{POP} .cmeth__definition", "ds => ds.every(d => d.textContent.length > 15)")
    assert page.input_value(f"{POP} [data-param='detect_above']") == "0"
    assert "Used by % expressing and mean of expressing cells. Now: above 0." in pop.inner_text()
    assert "Cell-Gene Plot 1 (" in page.inner_text(f"{POP} [data-used-by]"), page.inner_text(f"{POP} [data-used-by]")
    assert page.locator(f"{POP} .cmeth__reset").is_disabled(), "nothing to reset at the defaults"
    assert _box(page, TG) == before, "opening the pop-over moves no box"
    page.keyboard.press("Escape")
    pop.wait_for(state="hidden")
    assert _box(page, TG) == before
    assert page.evaluate("() => document.activeElement && document.activeElement.classList.contains('cmeth__toggle')"), "focus goes back"


def test_expressed_above_redraws_the_cell_gene_plot_and_undo_restores_it(page, served):
    _plot_on_grouping(page, served)
    assert "% expressing (> 0) · counts" in _hover(page)
    assert page.input_value(f"{TP} .cgene-size-above") == ""
    assert page.get_attribute(f"{TP} .cgene-size-above", "placeholder") == "auto (grouping: 0)"
    n = len(page.calls)
    page.click(f"{TG} .cmeth__toggle")
    page.locator(POP).wait_for(state="visible")
    _set_threshold(page, 2)
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().detect_above === 2", GA)
    until(page, "(s) => { const p = document.querySelector(s + ' .cgene-plot'); const t = JSON.stringify(p.data[0].hovertext || p.data[0].text);"
          " return t.includes('% expressing (> 2) · counts'); }", TP, timeout=60)
    # the grouping's own grid reads the focused gene on X at the new threshold too (its own POST); the plot's is one
    new = [c for c in page.calls[n:] if any(f.get("layer") in ("counts", "logged") for f in c.get("features") or [])]
    assert len(new) == 1, f"one POST for the plot at the new threshold, got {len(new)}"
    counts = [f for f in _features(new) if f.get("layer") == "counts"]
    assert counts and all(f["detect_above"] == 2 for f in counts), counts
    assert "detect_above" not in _config(page)["size"], "nothing is written into the plot"
    assert page.input_value(f"{TP} .cgene-size-above") == ""
    assert page.get_attribute(f"{TP} .cgene-size-above", "placeholder") == "auto (grouping: 2)"
    assert "Now: above 2." in page.inner_text(POP)
    toggle = page.locator(f"{TG} .cmeth__toggle")
    assert toggle.locator(".cmeth__dot").is_visible(), "a non-default parameter marks the button"
    assert "expressed above 2" in toggle.get_attribute("title")
    page.keyboard.press("Escape")
    # one undo step of the grouping
    assert page.get_attribute(f"{TG} .cgrp-undo", "title") == "Undo: expressed above 2"
    page.click(f"{TG} .cgrp-undo")
    until(page, "(id) => !('detect_above' in window.PanelManager.getPanel(id).getConfig())", GA)
    until(page, "(s) => { const p = document.querySelector(s + ' .cgene-plot'); const t = JSON.stringify(p.data[0].hovertext || p.data[0].text);"
          " return t.includes('% expressing (> 0) · counts'); }", TP, timeout=60)
    assert page.get_attribute(f"{TP} .cgene-size-above", "placeholder") == "auto (grouping: 0)"
    assert page.locator(f"{TG} .cmeth__toggle .cmeth__dot").is_hidden()


def test_a_measure_with_its_own_threshold_is_unaffected(page, served):
    _plot_on_grouping(page, served, size={"stat": "pct_expressing", "layer": "counts", "detect_above": 0.5})
    assert "% expressing (> 0.5) · counts" in _hover(page)
    assert page.input_value(f"{TP} .cgene-size-above") == "0.5", "an override shows its value"
    assert "Overrides Grouping 1" in page.get_attribute(f"{TP} .cgene-size-above", "title")
    n = len(page.calls)
    page.click(f"{TG} .cmeth__toggle")
    page.locator(POP).wait_for(state="visible")
    _set_threshold(page, 2)
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().detect_above === 2", GA)
    page.keyboard.press("Escape")
    _drawn(page)
    assert not any(f.get("layer") == "counts" and f.get("detect_above") == 2 for f in _features(page.calls[n:])), "Size keeps its own threshold"
    assert "% expressing (> 0.5) · counts" in _hover(page)
    assert _config(page)["size"]["detect_above"] == 0.5
    # clearing the override follows the grouping again
    page.fill(f"{TP} .cgene-size-above", "")
    page.press(f"{TP} .cgene-size-above", "Enter")
    until(page, "(id) => !('detect_above' in window.PanelManager.getPanel(id).getConfig().size)", P)
    until(page, "(s) => { const p = document.querySelector(s + ' .cgene-plot'); const t = JSON.stringify(p.data[0].hovertext || p.data[0].text);"
          " return t.includes('% expressing (> 2) · counts'); }", TP, timeout=60)


def _open_table(page, served, table, more=None, open_ids=(T,)):
    page.goto(_url(served, list(open_ids), {T: table, **(more or {})}))
    page.wait_for_selector(f"{TT} .cmeth__toggle", timeout=30000)


def test_the_cell_tables_methods_round_trip_through_its_configuration(page, served):
    _open_table(page, served, {"id": T, "title": "Table 1"})
    cfg = page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig()", T)
    assert "methods" not in cfg, "omitted at default"
    before = _box(page, TT)
    page.click(f"{TT} .cmeth__toggle")
    pop = page.locator(POP)
    pop.wait_for(state="visible")
    assert page.eval_on_selector_all(f"{POP} .cmeth__name", "ns => ns.map(n => n.textContent)") == STATS
    assert "the table's cells" in pop.inner_text() and "group" not in pop.inner_text().lower(), pop.inner_text()
    assert _box(page, TT) == before, "opening the pop-over moves no box"
    _set_threshold(page, 2)
    until(page, "(id) => { const m = window.PanelManager.getPanel(id).getConfig().methods; return !!m && m.detect_above === 2; }", T)
    assert page.evaluate("(id) => window.PanelManager.getPanel(id).getMethods()", T) == {"detect_above": 2}
    # an invalid number keeps the last valid value and says what is expected
    _set_threshold(page, "-1")
    assert page.input_value(f"{POP} [data-param='detect_above']") == "2"
    assert "Enter a number from 0 up." in page.inner_text(POP)
    page.keyboard.press("Escape")
    pop.wait_for(state="hidden")
    assert _box(page, TT) == before
    # a link of the table carries it back
    cfg = page.evaluate("(id) => JSON.parse(JSON.stringify(window.PanelManager.getPanel(id).getConfig()))", T)
    assert cfg["methods"] == {"detect_above": 2}
    _open_table(page, served, {"id": T, "title": "Table 1", "methods": {"detect_above": 2}})
    assert page.evaluate("(id) => window.PanelManager.getPanel(id).getMethods()", T) == {"detect_above": 2}
    assert page.locator(f"{TT} .cmeth__toggle .cmeth__dot").is_visible()
    # Reset to defaults takes the field out
    page.click(f"{TT} .cmeth__toggle")
    page.locator(POP).wait_for(state="visible")
    page.click(f"{POP} .cmeth__reset")
    until(page, "(id) => !('methods' in window.PanelManager.getPanel(id).getConfig())", T)


def test_a_change_of_the_tables_methods_is_one_step_of_its_undo(page, served):
    _open_table(page, served, {"id": T, "title": "Table 1"})
    undo = f"{TT} .table-undo"
    assert page.is_disabled(undo)
    page.click(f"{TT} .cmeth__toggle")
    page.locator(POP).wait_for(state="visible")
    _set_threshold(page, 2)
    page.keyboard.press("Escape")
    until(page, "([s]) => { const b = document.querySelector(s); return !!b && !b.disabled && b.title === 'Undo: change the methods'; }", [undo])
    page.click(undo)
    until(page, "(id) => !('methods' in window.PanelManager.getPanel(id).getConfig())", T)
    assert page.evaluate("(id) => window.PanelManager.getPanel(id).getMethods()", T) == {}
    until(page, "([s]) => document.querySelector(s).disabled", [undo])


@pytest.mark.skipif(not SHOTS, reason="screenshots only when ANNZARRO_SHOTS names a directory")
def test_screenshots_of_both_popovers(page, served):
    _plot_on_grouping(page, served)
    os.makedirs(SHOTS, exist_ok=True)
    page.click(f"{TG} .cmeth__toggle")
    page.locator(POP).wait_for(state="visible")
    _set_threshold(page, 1)
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().detect_above === 1", GA)
    _drawn(page)
    page.screenshot(path=os.path.join(SHOTS, "so7-grouping-methods.png"))
    page.locator(POP).screenshot(path=os.path.join(SHOTS, "so7-grouping-methods-popover.png"))
    page.keyboard.press("Escape")
    page.locator(f"{TP} .cgene-measure").first.screenshot(path=os.path.join(SHOTS, "so7-cell-gene-color-row.png"))
    page.locator(f"{TP} .cgene-field--size").screenshot(path=os.path.join(SHOTS, "so7-cell-gene-size-override.png"))
    _open_table(page, served, {"id": T, "title": "Table 1"})
    page.click(f"{TT} .cmeth__toggle")
    page.locator(POP).wait_for(state="visible")
    page.screenshot(path=os.path.join(SHOTS, "so7-table-methods.png"))
    page.locator(POP).screenshot(path=os.path.join(SHOTS, "so7-table-methods-popover.png"))
