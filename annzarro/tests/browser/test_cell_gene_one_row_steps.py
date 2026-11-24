"""Cell-Gene Plot: a one-row section follows the plot's Color and Size and chooses only its gene step (decision 40).

The operator's words (2026-11-23): "by default it may use the same as is already chosen for color and size. Also, we
should not be able to chose a different layer here, from what is already chosen for color and size."

1.  The pop-over has no layer and no statistic select; switching Color's layer re-reads the row on the new layer.
2.  A row on Sum of the gene rows goes back to the mean when Size becomes SD, said once; one Undo restores both.
3.  Change in Color closes the pop-over and focuses the plot's Color statistic.
4.  A link from before decision 40 loads, says once what changed, and draws.
5.  A signature with down genes draws its score: the rows family is greyed out with the reason.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_cell_gene_panel import (  # noqa: E402,F401 (the fixtures)
    GENES, P, S1, TP, VALUES, _config, _drawn, _features, _open, _plot, _sig, page, served)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

OBS = {"type": "obs", "key": "cell_type"}
BUTTON = f"{TP} .cgene-section__values-btn"


def _one_row(page, served, section=None, sig=None, **plot):
    section = {"source": S1, "rows": "set", **(section or {})}
    _open(page, served, {P: _plot(cellAxis=OBS, sections=[section], **plot), S1: sig or _sig(S1, "Pathway", GENES[0:6])},
          open_ids=(P, S1))
    _drawn(page)


def _open_values(page):
    page.click(BUTTON)
    page.wait_for_selector(VALUES, state="visible")


def test_the_row_has_no_layer_and_no_statistic_of_its_own_and_follows_colors_layer(page, served):
    _one_row(page, served)
    _open_values(page)
    assert page.locator(f"{VALUES} select").count() == 2, "one gene step select per channel, nothing else"
    assert page.locator(f"{VALUES} .cgene-section__channel[data-which='color']").inner_text() == "Mean · logged"
    page.keyboard.press("Escape")
    n = len(page.calls)
    page.select_option(f"{TP} .cgene-color-layer", "counts")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().color.layer === 'counts'", P)
    _drawn(page)
    feats = _features(page.calls[n:])
    assert sorted({f["layer"] for f in feats}) == ["counts"], feats
    assert sorted(f["name"] for f in feats) == sorted(GENES[0:6]), "the row reads its genes on counts, as Color does"
    _open_values(page)
    assert page.locator(f"{VALUES} .cgene-section__channel[data-which='color']").inner_text() == "Mean · counts"


def test_a_sum_goes_back_to_the_mean_when_size_becomes_sd_said_once_and_undone_in_one_step(page, served):
    _one_row(page, served, section={"size": {"genes": "rows_sum"}}, size={"stat": "mean", "layer": "logged"})
    page.select_option(f"{TP} .cgene-size", "sd")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().size.stat === 'sd'", P)
    cfg = _config(page)
    assert "size" not in cfg["sections"][0], cfg["sections"][0]
    said = page.locator(f"{TP} .cgene-panel").inner_text()
    assert said.count("Pathway's Size row changed to Mean of the gene rows. Sum of the gene rows cannot be computed with SD") == 1, said
    page.click(f"{TP} .cgene-undo")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().size.stat === 'mean'", P)
    assert _config(page)["sections"][0]["size"] == {"genes": "rows_sum"}


def test_change_in_color_closes_the_popover_and_focuses_the_plots_color_statistic(page, served):
    _one_row(page, served)
    _open_values(page)
    page.click(f"{VALUES} .cgene-section__change[data-which='color']")
    page.wait_for_selector(VALUES, state="detached")
    assert page.evaluate("(s) => document.activeElement === document.querySelector(s + ' .cgene-color')", TP)


def test_a_link_from_before_decision_40_loads_says_what_changed_once_and_draws(page, served):
    _one_row(page, served, section={"color": {"agg": "score_mean", "column": "zscore_mean", "layer": "counts"}})
    cfg = _config(page)
    assert cfg["sections"][0]["color"] == {"genes": "zscore_mean"}
    text = page.locator(f"{TP} .cgene-panel").inner_text()
    assert text.count("Pathway's Color row now follows Color (Mean · logged); it showed z-score mean · counts, averaged.") == 1, text
    scores = [f for f in _features(page.calls) if f["kind"] == "score"]
    assert [(f["column"], f["layer"]) for f in scores] == [("zscore_mean", "logged")]
    assert page.evaluate("(s) => (document.querySelector(s + ' .cgene-plot').data || []).length > 0", TP)


def test_a_signature_with_down_genes_draws_its_score_and_greys_out_combining_rows(page, served):
    sig = {**_sig(S1, "Pathway", GENES[0:4]), "down": GENES[4:6]}
    _one_row(page, served, sig=sig)
    scores = [f for f in _features(page.calls) if f["kind"] == "score"]
    assert [(f["column"], f["layer"]) for f in scores] == [("zscore_mean", "logged")], scores
    _open_values(page)
    sel = f"{VALUES} .cgene-section__genes[data-which='color']"
    assert page.input_value(sel) == "zscore_mean"
    rows = page.eval_on_selector_all(f"{sel} optgroup:first-child option", "os => os.map(o => [o.disabled, o.title])")
    assert all(d for d, _ in rows), rows
    assert rows[0][1] == "Mean of the gene rows cannot be computed with down genes: it would count them as up genes. Score each cell instead."
