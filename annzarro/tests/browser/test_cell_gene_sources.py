"""Cell-Gene Plot Color and Size sources in a real browser, against the real cell_groups route (WP-4, FB-2a).

The store is the grouping fixture (tests/core/grouping_store.py): X signed, ``logged`` log-normalised and ``counts``
raw counts, as core/matrix_kind.py reads them from the stored values (never from the names).

1.  An obs column as groups: Size's layer select offers ``counts`` (the log-normalised and counts layers count as
    offered, operator ruling Q1); choosing it before the genes are added sends one POST whose features hold each gene on
    both layers once (no wire change).
2.  A new plot: Color = mean on the log-normalised layer, Size = % expressing on counts above 0 (Q2).
3.  "Offer other…" opens where layers are offered: the plot's own Statistics offered on an obs axis (an edit there is
    one undoable step of the plot), the grouping's Statistics offered on a grouping axis.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_cell_gene_panel import (  # noqa: E402,F401
    GA, GENES, P, S1, TP, _config, _drawn, _features, _open, _plot, _sig, page, served)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

OBS = {"type": "obs", "key": "cell_type"}
OFFER_OTHER = "__offer_other__"


def _layer_usable(page, which, layer):
    until(page, "([s, w, l]) => { const o = document.querySelector(`${s} .cgene-${w}-layer option[value=\"${l}\"]`); "
                "return !!o && !o.disabled; }", [TP, which, layer], timeout=30)


def test_size_on_counts_on_an_obs_axis_is_one_post_with_each_gene_on_both_layers_once(page, served):
    genes = GENES[:4]
    _open(page, served, {P: _plot(cellAxis=OBS, sections=[]), S1: _sig(S1, "Markers", genes)}, open_ids=(P, S1))
    # the layer select lists the offered layers only: X, and the log-normalised and counts layers by matrix kind
    _layer_usable(page, "size", "counts")
    values = page.eval_on_selector_all(f"{TP} .cgene-size-layer option", "os => os.map(o => o.value)")
    assert values == ["X", "logged", "counts", OFFER_OTHER], values
    assert page.locator(f"{TP} .cgene-size-layer option[value='X']").evaluate("o => o.disabled"), "% expressing cannot be read on a signed X"
    page.select_option(f"{TP} .cgene-size-layer", "counts")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().size.layer === 'counts'", P)
    # the threshold sits beside Size
    assert page.locator(f"{TP} .cgene-size-above").is_visible()
    assert page.locator(f"{TP} .cgene-color-above").is_hidden(), "a mean uses no threshold"
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
    assert "% expressing (> 0) · counts: " in hover, hover[:300]


def test_a_new_plot_reads_color_on_the_log_normalised_layer_and_size_on_counts(page, served):
    _open(page, served, {P: {"id": P, "title": "Cell-Gene Plot 1", "version": 1, "cellAxis": OBS, "sections": []}})
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().size.layer === 'counts'", P, timeout=30)
    cfg = _config(page)
    assert cfg["color"] == {"stat": "mean", "layer": "logged"}
    assert cfg["size"] == {"stat": "pct_expressing", "layer": "counts", "detect_above": 0}
    assert page.input_value(f"{TP} .cgene-color") == "mean" and page.input_value(f"{TP} .cgene-color-layer") == "logged"
    assert page.input_value(f"{TP} .cgene-size") == "pct_expressing" and page.input_value(f"{TP} .cgene-size-layer") == "counts"
    assert page.input_value(f"{TP} .cgene-size-above") == "0"
    assert page.locator(f"{TP} .cgene-undo").is_disabled(), "a default is not an edit"


def test_offer_other_opens_the_plots_own_offer_on_an_obs_axis_and_the_groupings_on_a_grouping_axis(page, served):
    grouping = {"id": GA, "title": "Grouping 1", "version": 1, "partitionings": [{"source": {"type": "obs", "key": "cell_type"}}]}
    _open(page, served, {P: _plot(cellAxis=OBS, sections=[]), GA: grouping}, open_ids=(P, GA))
    _layer_usable(page, "color", "counts")
    toggle = f"#gsig-scoring-toggle-{P}"
    assert page.get_attribute(toggle, "aria-expanded") == "false"
    page.select_option(f"{TP} .cgene-color-layer", OFFER_OTHER)
    until(page, "(t) => document.querySelector(t).getAttribute('aria-expanded') === 'true'", toggle)
    assert page.input_value(f"{TP} .cgene-color-layer") == "logged", "the select still shows what is drawn"
    # an edit of the plot's own offer is one undoable step, kept in its configuration
    page.uncheck(f"{TP} [data-layer-offer='counts']")
    until(page, "(id) => JSON.stringify(window.PanelManager.getPanel(id).getConfig().offer) === JSON.stringify({layers: ['X', 'logged']})", P)
    values = page.eval_on_selector_all(f"{TP} .cgene-color-layer option", "os => os.map(o => o.value)")
    assert values == ["X", "logged", OFFER_OTHER], values
    page.click(f"{TP} .cgene-undo")
    until(page, "(id) => !('offer' in window.PanelManager.getPanel(id).getConfig())", P)
    # a grouping as the groups: its Statistics offered opens instead, and the plot's own list is not shown
    page.select_option(f"{TP} .cgene-axis-type", "cell-group")
    page.select_option(f"{TP} .cgene-axis-key", GA)
    until(page, "(s) => document.querySelector(s + ' .cgene-offer').hidden", TP)
    values = page.eval_on_selector_all(f"{TP} .cgene-color-layer option", "os => os.map(o => o.value)")
    assert values[0] == "X" and "counts" not in values, "the grouping offers X only: the gate (SHR-26)"
    group_toggle = f"#gsig-scoring-toggle-{GA}"
    assert page.get_attribute(group_toggle, "aria-expanded") == "false"
    page.select_option(f"{TP} .cgene-color-layer", OFFER_OTHER)
    until(page, "(t) => document.querySelector(t).getAttribute('aria-expanded') === 'true'", group_toggle)
