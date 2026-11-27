"""Cell-Gene Plot Color and Size sources in a real browser, against the real cell_groups route (WP-4, FB-2a).

The store is the grouping fixture (tests/core/grouping_store.py): X signed, ``logged`` log-normalised and ``counts``
raw counts, as core/matrix_kind.py reads them from the stored values (never from the names).

1.  An obs column as groups: Size's layer select lists every layer (decision 31); choosing ``counts`` before the genes
    are added sends one POST whose features hold each gene on both layers once (no wire change).
2.  A new plot: Color = mean on the log-normalised layer, Size = Fraction of cells on counts above 0 (decision 24).
3.  Nothing is offered on either axis kind: the plot has no Statistics offered of its own, and a grouping as the groups
    lists the same layers as an obs column.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import cgene_controls as CC  # noqa: E402
from annzarro.tests.browser.test_cell_gene_panel import (  # noqa: E402,F401
    GA, GENES, P, S1, TP, _config, _drawn, _features, _open, _plot, _sig, page, served)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

OBS = {"type": "obs", "key": "cell_type"}


def _layer_usable(page, which, layer):
    until(page, "([s, w, l]) => { const o = document.querySelector(`${s} .cgene-${w}-layer option[value=\"${l}\"]`); "
                "return !!o && !o.disabled; }", [TP, which, layer], timeout=30)


def test_size_on_counts_on_an_obs_axis_is_one_post_with_each_gene_on_both_layers_once(page, served):
    genes = GENES[:4]
    _open(page, served, {P: _plot(cellAxis=OBS, sections=[]), S1: _sig(S1, "Markers", genes)}, open_ids=(P, S1))
    # the layer select lists every layer of the dataset (decision 31), graded
    _layer_usable(page, "size", "counts")
    values = page.eval_on_selector_all(f"{TP} .cgene-size-layer option", "os => os.map(o => o.value)")
    assert sorted(values) == ["X", "counts", "logged"] and values[0] == "X", values
    # every layer is listed at once; X is disabled once its kind is read (a layer's kind arrives on its own)
    until(page, "(s) => document.querySelector(s + ' .cgene-size-layer option[value=\"X\"]').disabled", TP, timeout=30)
    page.select_option(f"{TP} .cgene-size-layer", "counts")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().size.layer === 'counts'", P)
    # the threshold sits beside Size
    assert CC.above(page, TP, "size") is not None
    assert CC.above(page, TP, "color") is None, "a mean uses no threshold"
    page.click(f"{TP} .cgene-add")
    page.locator(f"{TP} .cgene-add-menu [role='menuitem']", has_text="Markers").click()
    st = _drawn(page)
    assert st["rows"] == len(genes)
    assert len(page.calls) == 1, "one POST for the groups and every gene on both layers"
    feats = _features(page.calls)
    assert sorted((f["name"], f["layer"]) for f in feats) == sorted((g, layer) for g in genes for layer in ("logged", "counts"))
    assert len(feats) == 2 * len(genes), "each gene once per layer"
    # each dot's hover names Size by statistic, threshold and layer
    hover = page.evaluate("(s) => JSON.stringify(document.querySelector(s + ' .cgene-plot').data[0].hovertext"
                          " || document.querySelector(s + ' .cgene-plot').data[0].text)", TP)
    assert "Fraction of cells (> 0) · counts: " in hover, hover[:300]


def test_a_new_plot_reads_color_on_the_log_normalised_layer_and_size_on_counts(page, served):
    _open(page, served, {P: {"id": P, "title": "Cell-Gene Plot 1", "version": 1, "cellAxis": OBS, "sections": []}})
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().size.layer === 'counts'", P, timeout=30)
    cfg = _config(page)
    assert cfg["color"] == {"stat": "mean", "layer": "logged"}
    assert cfg["size"] == {"stat": "fraction_of_cells", "layer": "counts"}, "no threshold stored: 0 on an obs axis, a grouping's on a grouping axis"
    assert CC.chosen_stat(page, TP, "color") == "mean" and page.input_value(f"{TP} .cgene-color-layer") == "logged"
    assert CC.chosen_stat(page, TP, "size") == "fraction_of_cells" and page.input_value(f"{TP} .cgene-size-layer") == "counts"
    assert CC.above(page, TP, "size")["value"] == "0"
    assert page.locator(f"{TP} .cgene-undo").is_disabled(), "a default is not an edit"


def test_nothing_is_offered_on_either_axis_kind(page, served):
    grouping = {"id": GA, "title": "Grouping 1", "version": 1, "partitionings": [{"source": {"type": "obs", "key": "cell_type"}}]}
    _open(page, served, {P: _plot(cellAxis=OBS, sections=[]), GA: grouping}, open_ids=(P, GA))
    _layer_usable(page, "color", "counts")
    obs = page.eval_on_selector_all(f"{TP} .cgene-color-layer option", "os => os.map(o => o.value)")
    assert page.locator(f"{TP} .cgene-offer, {TP} .gsig-scoring").count() == 0, "the plot keeps no Statistics offered"
    # a grouping as the groups lists the same layers: no gate (SHR-26 retired)
    page.select_option(f"{TP} .cgene-axis-type", "cell-group")
    page.select_option(f"{TP} .cgene-axis-key", GA)
    until(page, "(id) => (window.PanelManager.getPanel(id).getConfig().cellAxis || {}).type === 'cell-group'", P)
    _layer_usable(page, "color", "counts")
    values = page.eval_on_selector_all(f"{TP} .cgene-color-layer option", "os => os.map(o => o.value)")
    assert values == obs, (values, obs)
    texts = page.eval_on_selector_all(f"{TP} .cgene-controls option", "os => os.map(o => o.textContent)")
    assert not any("offer" in t.lower() for t in texts), texts
