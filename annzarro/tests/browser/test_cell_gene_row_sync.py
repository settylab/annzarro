"""Cell-Gene Plot: a one-row section is the set treated as one gene (aggregation-unify-080.md 11).

Genes / One row is a select and a one-row section has no other control: each channel shows it by the fixed rule of its
statistic (cell-gene-model.js ROW_RULE), on the channel's layer and threshold, and the section's tooltip says the rule.
Under % expressing it is the share of cells expressing ANY gene of the set. The settings of earlier builds are not read.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os
import re

import numpy as np
import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import cgene_controls as CC  # noqa: E402
from annzarro.tests.browser import cgene_rows as CR  # noqa: E402
from annzarro.tests.browser.test_cell_gene_panel import (  # noqa: E402,F401 (the fixtures)
    DATA, GENES, P, S1, TP, _config, _drawn, _features, _open, _plot, _sig, page, served)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

OBS = {"type": "obs", "key": "cell_type"}
def _one_row(page, served, section=None, sig=None, genes=6, **plot):
    section = {"source": S1, "rows": "set", **(section or {})}
    _open(page, served, {P: _plot(cellAxis=OBS, sections=[section], **plot), S1: sig or _sig(S1, "Pathway", GENES[0:genes])},
          open_ids=(P, S1))
    _drawn(page)


def _hovers(page):
    return page.evaluate("""(s) => { const d = document.querySelector(s + ' .cgene-plot').data[0];
        return (d.hovertext || d.text || []).map(String); }""", TP)


def test_one_row_section_has_no_aggregation_control(page, served):
    _one_row(page, served)
    assert page.locator(f"{CR.section(TP, 0)} button").count() == 2, "the card's head and ⋯ only"
    assert page.locator(f"{TP} [data-which], {TP} .cgene-section__step, {TP} .cgene-section__values-btn").count() == 0
    CR.show_as(page, TP, 0, "genes")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().sections[0].rows === 'genes'", P)
    CR.show_as(page, TP, 0, "set")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().sections[0].rows === 'set'", P)
    assert _config(page)["sections"][0] == {"source": S1, "rows": "set"}


def test_section_tooltip_states_the_rule(page, served):
    _one_row(page, served)
    assert CR.rule(page, TP, 0) == "Color: the mean of the genes' means. Size: % of cells expressing at least one gene."
    CC.pick_stat(page, TP, "color", "zscore_mean")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().color.stat === 'zscore_mean'", P)
    CC.pick_stat(page, TP, "size", "sum")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().size.stat === 'sum'", P)
    until(page, "([s]) => /z-score mean score of the set/.test(document.querySelector(s + ' .az-card__head').title)", [TP])
    assert CR.rule(page, TP, 0) == "Color: the z-score mean score of the set. Size: the sum of the genes' sums."


def test_row_follows_color_and_size_changes(page, served):
    """Color x̄, z̄, σ and Size %, x̄⁺: the row's hover names each rule."""
    _one_row(page, served)
    assert any("cells: Mean" in h for h in _hovers(page)), _hovers(page)[:1]
    CC.pick_stat(page, TP, "color", "zscore_mean")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().color.stat === 'zscore_mean'", P)
    _drawn(page)
    assert any("<br>Z-score mean · logged: " in h for h in _hovers(page))
    CC.pick_stat(page, TP, "color", "sd")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().color.stat === 'sd'", P)
    _drawn(page)
    assert any("cells: SD · logged; genes: mean" in h for h in _hovers(page)), _hovers(page)[:1]
    CC.pick_stat(page, TP, "size", "mean_expressing")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().size.stat === 'mean_expressing'", P)
    _drawn(page)
    assert any("Mean of expressing cells" in h and "genes: mean" in h for h in _hovers(page)), _hovers(page)[:1]


def test_no_symbol_suffix_on_row_labels(page, served):
    _one_row(page, served)
    labels = page.evaluate("(s) => document.querySelector(s + ' .cgene-plot').layout.xaxis.ticktext", TP)
    assert not any("\u2039" in t or "\u203a" in t for t in labels), labels


def test_score_row_sizes_by_cells_expressing_any_gene(page, served):
    """Size is the share of cells of each group expressing at least one of the set's genes: hover text, the gene rows'
    size legend, and a value equal to an oracle computed here from the fixture matrix."""
    _one_row(page, served)
    first = [f for f in _features(page.calls) if f["kind"] == "score"]
    assert sorted(f["column"] for f in first) == ["detected"], first
    detected = next(f for f in first if f["column"] == "detected")
    assert detected["above"] == 0 and detected["layer"] == "logged" and detected["recipe"]["detect_above"] == 0
    names = [str(c) for c in DATA.obs["cell_type"].cat.categories]
    idx = [GENES.index(g) for g in GENES[0:6]]
    counts = DATA.logged[:, idx]
    codes = DATA.obs["cell_type"].cat.codes.to_numpy()
    oracle = {n: 100.0 * np.mean((counts[codes == k] > 0).any(axis=1)) for k, n in enumerate(names)}
    seen = {}
    for text in _hovers(page):
        m = re.search(r"^(.*?) · Cells: .*% of cells expressing at least one of Pathway's 6 genes \(> 0\) · logged: ([0-9.]+)", text.replace("<br>", " "))
        if m:
            seen[m.group(1)] = float(m.group(2))
    assert set(seen) == set(names), seen
    for n in names:
        assert abs(seen[n] - oracle[n]) < 0.06, (n, seen[n], oracle[n])
    # the size legend is the gene rows' (a score row has none of its own)
    assert page.evaluate("(s) => (document.querySelector(s + ' .cgene-plot').layout.annotations || []).filter(a => /at least one/.test(a.text || '')).length", TP) == 0


def test_threshold_change_in_size_moves_the_any_gene_value(page, served):
    _one_row(page, served)
    n = len(page.calls)
    CC.set_above(page, TP, "size", "1")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().size.detect_above === 1", P)
    _drawn(page)
    scores = [f for f in _features(page.calls[n:]) if f["kind"] == "score" and f["column"] == "detected"]
    assert scores and all(f["recipe"]["detect_above"] == 1 for f in scores), scores
    assert any("(> 1) · logged" in t for t in _hovers(page))


def test_old_link_loads_on_defaults_without_notice(page, served):
    _one_row(page, served, section={"color": {"agg": "score_mean", "column": "zscore_mean", "layer": "counts"},
                                    "size": {"genes": "rows_sum"}, "genes": "zscore_mean"})
    cfg = _config(page)
    assert set(cfg["sections"][0]) == {"source", "rows"}, cfg["sections"][0]
    text = page.locator(f"{TP} .cgene-panel").inner_text()
    assert "now follows" not in text and "it showed" not in text, text
    assert [f["column"] for f in _features(page.calls) if f["kind"] == "score"] == ["detected"], "only Size's any-gene score"
    assert page.evaluate("(s) => (document.querySelector(s + ' .cgene-plot').data || []).length > 0", TP)


def test_one_row_section_is_one_line(page, served):
    _open(page, served, {P: _plot(cellAxis=OBS, sections=[{"source": S1, "rows": "genes"}, {"source": S1, "rows": "set"}]),
                         S1: _sig(S1, "Pathway", GENES[0:6])}, open_ids=(P, S1))
    _drawn(page)
    page.set_viewport_size({"width": 1500, "height": 1000})
    h = page.evaluate("(s) => [...document.querySelectorAll(s + ' .cgene-section')].map(e => Math.round(e.getBoundingClientRect().height))", TP)
    assert h[0] == h[1], h


def test_a_signature_with_down_genes_draws_its_mean_score_and_the_up_genes_for_any_gene(page, served):
    sig = {**_sig(S1, "Pathway", GENES[0:4]), "down": GENES[4:6]}
    _one_row(page, served, sig=sig)
    scores = [f for f in _features(page.calls) if f["kind"] == "score"]
    assert sorted((f["column"], f["layer"]) for f in scores) == [("detected", "logged"), ("mean", "logged")], scores
    detected = next(f for f in scores if f["column"] == "detected")
    assert detected["recipe"]["genes"] == GENES[0:4] and detected["recipe"]["down"] == [], "the up genes only"
    assert not [f for f in _features(page.calls) if f["kind"] == "gene"], "the gene rows' features are not read"
