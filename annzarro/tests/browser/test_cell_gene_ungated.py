"""SO-4 of decision 31 in a real browser, against the real cell_groups route: the Cell-Gene Plot and the Cell Grouping
stop gating statistics and layers.

The store is the grouping fixture (tests/core/grouping_store.py): X signed, ``logged`` log-normalised and ``counts`` raw
counts, as core/matrix_kind.py reads them from the stored values.

1.  A plot on a default grouping reading ``logged`` (decision 24) says "(no longer offered)" nowhere, and its layer
    selects list every layer of the dataset; nothing reads "Offer other…".
2.  A new plot on a grouping axis takes decision 24's measures from all the layers: Size on ``counts``.
3.  The grouping's toolbar has no Statistics ▾ button.
4.  A link whose grouping holds "Expressed above" 1 draws Size above 1, read from the grouping (decision 34); the
    grouping's next edit drops the retired offered and layers, keeps the threshold, and the plot still draws above 1.
5.  A one-row section's Color reads a score by kind, method and layer: three selects, every method and layer listed.
6.  Screenshots of the plot's controls, the values pop-over and the grouping's toolbar (only when ANNZARRO_SHOTS names a
    directory).

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_cell_gene_panel import (  # noqa: E402,F401
    GA, GENES, P, S1, TP, VALUES, _config, _drawn, _features, _open, _plot, _sig, page, served)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

SHOTS = os.environ.get("ANNZARRO_SHOTS")
TG = f'.tile[data-tile-id="{GA}"]'
OBS = {"type": "obs", "key": "cell_type"}
AXIS = {"type": "cell-group", "key": GA}


def _grouping(**fields):
    return {"id": GA, "title": "Grouping 1", "version": 1, "partitionings": [{"source": OBS}], **fields}


def _labels(page, selector):
    return page.eval_on_selector_all(selector, "os => os.map(o => o.textContent)")


def _kinds_known(page):
    """The layer kinds are read once per dataset: X's option is disabled for % expressing once they are known."""
    until(page, "(s) => { const o = document.querySelector(s + ' .cgene-size-layer option[value=\"X\"]'); return !!o && o.disabled; }",
          TP, timeout=30)


def test_a_default_grouping_axis_plot_says_no_longer_offered_nowhere_and_lists_every_layer(page, served):
    _open(page, served, {P: _plot(cellAxis=AXIS, sections=[{"source": S1, "rows": "genes"}]), GA: _grouping(),
                         S1: _sig(S1, "Markers", GENES[:3])}, open_ids=(P, GA))
    _drawn(page)
    _kinds_known(page)
    assert "no longer offered" not in page.locator(f"{TP} .cgene-panel").inner_text()
    for which in ("color", "size"):
        labels = _labels(page, f"{TP} .cgene-{which}-layer option")
        assert labels == ["X", "counts", "logged"], labels  # the dataset's order, X first
        stats = _labels(page, f"{TP} .cgene-{which} option")
        assert stats == ["Mean", "% expressing", "Mean of expressing cells", "Sum", "SD", "Cell count"], stats
        assert not any("offer" in t.lower() or "(no longer" in t for t in labels + stats)
    assert page.input_value(f"{TP} .cgene-color-layer") == "logged"


def test_a_new_plot_on_a_grouping_axis_reads_decision_24_from_all_layers(page, served):
    _open(page, served, {P: {"id": P, "title": "Cell-Gene Plot 1", "version": 1, "cellAxis": AXIS, "sections": []}, GA: _grouping()},
          open_ids=(P, GA))
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().size.layer === 'counts'", P, timeout=30)
    cfg = _config(page)
    assert cfg["color"] == {"stat": "mean", "layer": "logged"}
    assert cfg["size"] == {"stat": "pct_expressing", "layer": "counts"}, "no threshold of its own: it follows the grouping (decision 35)"
    assert "offer" not in cfg
    assert page.locator(f"{TP} .cgene-undo").is_disabled(), "a default is not an edit"


def test_the_grouping_toolbar_has_no_statistics_button(page, served):
    _open(page, served, {P: _plot(cellAxis=AXIS), GA: _grouping()}, open_ids=(P, GA))
    page.wait_for_selector(f"{TG} .cgrp-controls", timeout=30000)
    controls = page.locator(f"{TG} .cgrp-controls")
    assert controls.locator(".cgrp-statistics, .gsig-scoring, .gsig-scoring__toggle").count() == 0
    assert "Statistics" not in controls.inner_text(), controls.inner_text()
    assert page.evaluate("(id) => typeof window.PanelManager.getPanel(id).revealStatisticsOffered", GA) == "undefined"


def test_the_groupings_threshold_is_read_by_the_plot_and_survives_the_groupings_next_edit(page, served):
    old = _grouping(offered=["mean", "pct_expressing", "sd"], layers=["logged"], detect_above=1)
    _open(page, served, {P: _plot(cellAxis=AXIS, sections=[{"source": S1, "rows": "genes"}]), GA: old, S1: _sig(S1, "Markers", GENES[:3])},
          open_ids=(P, GA))
    _drawn(page)
    cfg = _config(page)
    assert "detect_above" not in cfg["size"], "nothing is copied into the plot: it reads the grouping (decision 34)"
    assert all(f["detect_above"] == 1 for f in _features(page.calls)), "every gene is read above 1"
    hover = page.evaluate("(s) => JSON.stringify(document.querySelector(s + ' .cgene-plot').data[0].hovertext"
                          " || document.querySelector(s + ' .cgene-plot').data[0].text)", TP)
    assert "% expressing (> 1) · logged" in hover, hover[:300]
    assert page.input_value(f"{TP} .cgene-size-above") == "", "the override box is empty: the measure follows the grouping"
    assert page.get_attribute(f"{TP} .cgene-size-above", "placeholder") == "auto (grouping: 1)", "it shows the grouping's value"
    # the grouping's next edit drops the retired offered and layers and keeps its threshold; the plot still reads above 1
    n = len(page.calls)
    page.evaluate("(id) => window.PanelManager.getPanel(id).addFactor({source: {type: 'obs', key: 'condition'}})", GA)
    until(page, "(id) => !('offered' in window.PanelManager.getPanel(id).getConfig())", GA)
    grouping = page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig()", GA)
    assert "layers" not in grouping and grouping["detect_above"] == 1, grouping
    _drawn(page)
    assert all(f["detect_above"] == 1 for f in _features(page.calls[n:])), "the new groups are read above 1 still"


def test_a_one_row_score_reads_kind_method_and_layer_from_three_selects(page, served):
    plot = _plot(cellAxis=OBS, sections=[{"source": S1, "rows": "set", "color": {"agg": "score_mean", "column": "mean", "layer": "logged"}}])
    _open(page, served, {P: plot, S1: _sig(S1, "Markers", GENES[:3])}, open_ids=(P, S1))
    _drawn(page)
    page.click(f"{TP} .cgene-section__values-btn")
    pop = page.locator(VALUES)
    pop.wait_for(state="visible")
    kinds = _labels(page, f"{VALUES} .cgene-section__agg[data-which='color'] option")
    assert kinds == ["Mean of the genes' means", "Sum of the genes' means", "Mean of the genes' z-scores", "Mean of the genes' % expressing",
                     "Score, averaged", "% of cells with score above"], kinds
    methods = page.eval_on_selector_all(f"{VALUES} .cgene-section__method[data-which='color'] option", "os => os.map(o => o.value)")
    assert methods == ["zscore_mean", "mean", "sum", "control_adjusted", "detected", "fraction_of_total"], methods
    layers = _labels(page, f"{VALUES} .cgene-section__layer[data-which='color'] option")
    assert layers == ["X", "counts", "logged"], layers
    assert not any("offer" in t.lower() for t in kinds + layers)
    # the method touched wins and the layer stays when it can give it; then the layer, on its own
    page.select_option(f"{VALUES} .cgene-section__method[data-which='color']", "sum")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().sections[0].color.column === 'sum'", P)
    assert _config(page)["sections"][0]["color"] == {"agg": "score_mean", "column": "sum", "layer": "logged"}
    page.select_option(f"{VALUES} .cgene-section__layer[data-which='color']", "counts")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().sections[0].color.layer === 'counts'", P)
    # back to a summary: the method and layer selects go
    page.select_option(f"{VALUES} .cgene-section__agg[data-which='color']", "mean_of_means")
    until(page, "(id) => !('color' in window.PanelManager.getPanel(id).getConfig().sections[0])", P)
    assert page.locator(f"{VALUES} .cgene-section__method[data-which='color']").is_hidden()


@pytest.mark.skipif(not SHOTS, reason="screenshots only when ANNZARRO_SHOTS names a directory")
def test_screenshots_of_the_ungated_controls(page, served):
    plot = _plot(cellAxis=AXIS, sections=[{"source": S1, "rows": "genes"},
                                          {"source": S1, "rows": "set", "size": {"agg": "score_pct_above", "column": "mean", "layer": "logged", "above": 1}}])
    _open(page, served, {P: plot, GA: _grouping(), S1: _sig(S1, "Markers", GENES[:4])}, open_ids=(P, GA))
    _drawn(page)
    _kinds_known(page)
    os.makedirs(SHOTS, exist_ok=True)
    page.locator(TP).screenshot(path=os.path.join(SHOTS, "so4-cg-grouping-axis.png"))
    page.locator(TG).screenshot(path=os.path.join(SHOTS, "so4-grouping-toolbar.png"))
    page.click(f"{TP} .cgene-section__values-btn")
    page.locator(VALUES).wait_for(state="visible")
    page.screenshot(path=os.path.join(SHOTS, "so4-values-popover.png"))
