"""Cell-Gene Plot: a one-row section holds ONE choice (aggregation-unify-080.md 10, decision 46).

Genes / One row is a select; a one-row section has one gene-step button whose menu lists the ways to combine the gene
rows, then the source's score methods, each with its symbol. Color and Size read the one choice, each with its own
statistic and layer: a score row under % expressing is the share of cells expressing ANY gene of the set. The
per-channel steps of an earlier build are not read. Replaces the values pop-over and its tests (the pop-over is gone).

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
SYMBOLS = [("rows_mean", "="), ("rows_sum", "+"), ("rows_z", "z↔"), ("zscore_mean", "z"), ("mean", "x"), ("sum", "Σ"),
           ("control_adjusted", "Δ"), ("detected", "n/N"), ("fraction_of_total", "%")]


def _one_row(page, served, section=None, sig=None, genes=6, **plot):
    section = {"source": S1, "rows": "set", **(section or {})}
    _open(page, served, {P: _plot(cellAxis=OBS, sections=[section], **plot), S1: sig or _sig(S1, "Pathway", GENES[0:genes])},
          open_ids=(P, S1))
    _drawn(page)


def _hovers(page):
    return page.evaluate("""(s) => { const d = document.querySelector(s + ' .cgene-plot').data[0];
        return (d.hovertext || d.text || []).map(String); }""", TP)


def test_one_button_per_one_row_section(page, served):
    _one_row(page, served)
    assert page.locator(f"{TP} .cgene-section button.cgene-section__step").count() == 1
    assert page.locator(f"{TP} [data-which]").count() == 0, "no per-channel control anywhere"
    assert page.locator(f"{TP} .cgene-section__values-btn").count() == 0
    assert page.get_attribute(CR.button(TP, 0), "aria-pressed") == "false", "plain on the default"
    assert page.get_attribute(CR.button(TP, 0), "aria-label") == "Pathway, one row: Mean of the gene rows"


def test_no_button_on_a_genes_section(page, served):
    _one_row(page, served, section={"rows": "genes"})
    assert page.locator(f"{TP} button.cgene-section__step").count() == 0
    CR.show_as(page, TP, 0, "set")
    page.locator(CR.button(TP, 0)).wait_for()


def test_menu_lists_rows_then_methods_with_symbols(page, served):
    _one_row(page, served)
    entries = CR.entries(page, TP, 0)
    assert [(e["v"], e["sym"]) for e in entries] == SYMBOLS
    assert [e["heading"] for e in entries] == ["Combine the gene rows"] * 3 + ["Score each cell"] * 6
    assert entries[0]["on"] and not any(e["on"] for e in entries[1:])
    assert page.locator(f"{CR.MENU} input").count() == 0, "no threshold field in the menu"


def test_no_threshold_field_in_row_popover(page, served):
    _one_row(page, served, section={"genes": "zscore_mean"})
    CR.open_step(page, TP, 0)
    assert page.locator(f"{CR.MENU} input, {CR.MENU} select").count() == 0
    assert "cells above" not in page.inner_text(CR.MENU)
    CR.close_step(page)


def test_override_is_accent_and_label_carries_symbol(page, served):
    _one_row(page, served, section={"genes": "sum"})
    assert page.get_attribute(CR.button(TP, 0), "aria-pressed") == "true"
    assert "active" in page.get_attribute(CR.button(TP, 0), "class")
    assert page.inner_text(CR.button(TP, 0)) == "Σ"
    labels = page.evaluate("(s) => document.querySelector(s + ' .cgene-plot').layout.xaxis.ticktext", TP)
    # the name gives way to the symbol when the tick is short; the hover and the CSV say the whole name
    assert any("‹Σ›" in t for t in labels), labels
    assert any(re.search(r"<br>Pathway · Pathway<br>", h) for h in _hovers(page))
    CR.pick_step(page, TP, 0, "rows_mean")
    until(page, "(id) => !('genes' in window.PanelManager.getPanel(id).getConfig().sections[0])", P)
    assert page.get_attribute(CR.button(TP, 0), "aria-pressed") == "false"


def test_score_row_sizes_by_cells_expressing_any_gene(page, served):
    """Size is the share of cells of each group expressing at least one of the set's genes: hover text, the gene rows'
    size legend, and a value equal to an oracle computed here from the fixture matrix."""
    _one_row(page, served, section={"genes": "zscore_mean"})
    first = [f for f in _features(page.calls) if f["kind"] == "score"]
    assert sorted(f["column"] for f in first) == ["detected", "zscore_mean"], first
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
    _one_row(page, served, section={"genes": "zscore_mean"})
    n = len(page.calls)
    CC.set_above(page, TP, "size", "1")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().size.detect_above === 1", P)
    _drawn(page)
    scores = [f for f in _features(page.calls[n:]) if f["kind"] == "score" and f["column"] == "detected"]
    assert scores and all(f["recipe"]["detect_above"] == 1 for f in scores), scores
    assert any("(> 1) · logged" in t for t in _hovers(page))


def test_zscore_color_forces_follow_and_says_once(page, served):
    _one_row(page, served, section={"genes": "sum"})
    CC.pick_stat(page, TP, "color", "zscore_mean")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().color.stat === 'zscore_mean'", P)
    assert "genes" not in _config(page)["sections"][0]
    said = page.locator(f"{TP} .cgene-panel").inner_text()
    assert said.count("Pathway's row changed to z-score mean score.") == 1, said
    entries = CR.entries(page, TP, 0)
    assert [e["v"] for e in entries if not e["off"]] == ["rows_mean"]
    assert "Color is z-score mean" in next(e for e in entries if e["v"] == "mean")["title"]
    page.click(f"{TP} .cgene-undo")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().color.stat === 'mean'", P)
    assert _config(page)["sections"][0]["genes"] == "sum"


def test_grading_names_the_channel(page, served):
    _one_row(page, served, size={"stat": "sd", "layer": "logged"})
    entries = {e["v"]: e for e in CR.entries(page, TP, 0)}
    assert entries["rows_sum"]["off"]
    assert entries["rows_sum"]["title"] == "Sum of the gene rows cannot be computed with SD (Size): a sum of spreads is not the spread of the set."
    assert not entries["mean"]["off"]


def test_old_link_loads_on_defaults_without_notice(page, served):
    _one_row(page, served, section={"color": {"agg": "score_mean", "column": "zscore_mean", "layer": "counts"},
                                    "size": {"genes": "rows_sum"}})
    cfg = _config(page)
    assert set(cfg["sections"][0]) == {"source", "rows"}, cfg["sections"][0]
    text = page.locator(f"{TP} .cgene-panel").inner_text()
    assert "now follows" not in text and "it showed" not in text, text
    assert not [f for f in _features(page.calls) if f["kind"] == "score"]
    assert page.evaluate("(s) => (document.querySelector(s + ' .cgene-plot').data || []).length > 0", TP)


def test_one_row_section_is_one_line(page, served):
    _open(page, served, {P: _plot(cellAxis=OBS, sections=[{"source": S1, "rows": "genes"}, {"source": S1, "rows": "set", "genes": "mean"}]),
                         S1: _sig(S1, "Pathway", GENES[0:6])}, open_ids=(P, S1))
    _drawn(page)
    page.set_viewport_size({"width": 1500, "height": 1000})
    h = page.evaluate("(s) => [...document.querySelectorAll(s + ' .cgene-section')].map(e => Math.round(e.getBoundingClientRect().height))", TP)
    assert h[0] == h[1], h


def test_one_undo_step_per_pick(page, served):
    _one_row(page, served)
    before = page.evaluate("(id) => window.PanelManager.getPanel(id)._debugState().undo", P)
    CR.pick_step(page, TP, 0, "rows_z")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().sections[0].genes === 'rows_z'", P)
    assert page.evaluate("(id) => window.PanelManager.getPanel(id)._debugState().undo", P) == before + 1
    page.click(f"{TP} .cgene-undo")
    until(page, "(id) => !('genes' in window.PanelManager.getPanel(id).getConfig().sections[0])", P)


def test_escape_closes_the_menu_and_focus_returns_to_the_button(page, served):
    _one_row(page, served)
    CR.open_step(page, TP, 0)
    page.keyboard.press("Escape")
    page.locator(CR.MENU).wait_for(state="hidden")
    assert page.evaluate("(s) => document.activeElement === document.querySelector(s)", CR.button(TP, 0))


def test_a_signature_with_down_genes_draws_its_score_and_greys_out_combining_rows(page, served):
    sig = {**_sig(S1, "Pathway", GENES[0:4]), "down": GENES[4:6]}
    _one_row(page, served, sig=sig)
    scores = [f for f in _features(page.calls) if f["kind"] == "score"]
    assert sorted((f["column"], f["layer"]) for f in scores) == [("detected", "logged"), ("zscore_mean", "logged")], scores
    detected = next(f for f in scores if f["column"] == "detected")
    assert detected["recipe"]["genes"] == GENES[0:4] and detected["recipe"]["down"] == [], "the up genes only"
    entries = CR.entries(page, TP, 0)
    assert next(e for e in entries if e["on"])["v"] == "zscore_mean"
    rows = [e for e in entries if e["heading"] == "Combine the gene rows"]
    assert all(e["off"] for e in rows)
    assert rows[0]["title"] == "Mean of the gene rows cannot be computed with down genes (Color): it would count them as up genes. Score each cell instead."
