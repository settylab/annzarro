"""Cell-Gene Plot: z-score mean as a statistic of a cell group (aggregation-unify-080, package S2), in a real browser
against the real cell_groups route.

1.  `test_gene_row_equals_one_gene_signature`: under Color z-score mean, a gene's row and the one-row section of a
    one-gene signature of that gene hold the same numbers (the design's "one number, one way").
2.  `test_zscore_color_bar_diverges_around_zero`: with no colour map stored the bar is RdBu, centred on 0, symmetric.
3.  `test_zscore_disabled_for_size_with_reason`: Size lists z-score mean disabled, with its reason.
4.  `test_constant_gene_has_no_value_and_says_why`: a gene nobody expresses has no z-score; the hover says so.

The Gene Plot's cell group (G1a) is in test_gene_plot_group_stat.py.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import numpy as np
import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import cgene_controls as CC  # noqa: E402
from annzarro.tests.browser.test_cell_gene_panel import (  # noqa: E402,F401 (the fixtures)
    DATA, GENES, P, S1, S2, TP, _config, _drawn, _features, _open, _plot, _sig, page, served)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

OBS = {"type": "obs", "key": "cell_type"}
Z = {"stat": "zscore_mean", "layer": "logged"}
GENE = GENES[5]
CONSTANT_GENE = GENES[3]           # "a gene nobody expresses": zero in every cell, so no spread


def _heat(page):
    """Every cell of the heatmap's traces, by row label: `z` (the value per group, None where none) and `text` (the hover).
    The labels are read from the hover, whose second line is the row; a cell with no value is drawn by a trace of its own."""
    cells = page.evaluate("""(s) => {
        const gd = document.querySelector(s + ' .cgene-plot');
        const out = [];
        for (const t of gd.data.filter(d => d.type === 'heatmap')) {
            (t.z || []).forEach((row, g) => Array.from(row).forEach((v, r) => {
                const text = t.text && t.text[g] && t.text[g][r];
                if (text) out.push({ g, text, v: Number.isFinite(v) ? v : null });
            }));
        }
        return out; }""", TP)
    out = {"z": {}, "text": {}}
    for c in cells:
        label = c["text"].split("<br>")[1]
        empty = "no value" in c["text"] or "constant over" in c["text"]
        out["z"].setdefault(label, {})[c["g"]] = None if empty else c["v"]
        out["text"].setdefault(label, {})[c["g"]] = c["text"]
    return {"z": {k: [v[g] for g in sorted(v)] for k, v in out["z"].items()},
            "text": {k: [v[g] for g in sorted(v)] for k, v in out["text"].items()}}


def test_gene_row_equals_one_gene_signature(page, served):
    sections = [{"source": S1, "rows": "genes"}, {"source": S2, "rows": "set"}]
    _open(page, served, {P: _plot(cellAxis=OBS, mode="heatmap", color=Z, sections=sections),
                         S1: _sig(S1, "Marker", [GENE]), S2: _sig(S2, "One gene", [GENE])}, open_ids=(P, S1, S2))
    _drawn(page)
    wires = [f for f in _features(page.calls)]
    assert {f["kind"] for f in wires} == {"gene", "score"}, wires
    assert [f for f in wires if f["kind"] == "gene"][0]["transform"] == "zscore"
    heat = _heat(page)
    gene_row = heat["z"][GENE]
    set_row = next(v for k, v in heat["z"].items() if k != GENE)
    assert len(gene_row) == 6 and None not in gene_row
    assert np.allclose(gene_row, set_row, rtol=1e-5, atol=1e-6), (gene_row, set_row)
    # and both are the mean of the clipped z-score over all cells, by NumPy
    x = DATA.logged[:, GENES.index(GENE)].astype(np.float64)
    z = np.clip((x - x.mean()) / x.std(), -10, 10)
    cell_type = DATA.obs["cell_type"]
    want = [z[(cell_type == level).to_numpy()].mean() for level in cell_type.cat.categories]
    assert np.allclose(sorted(gene_row), sorted(want), rtol=1e-6, atol=1e-7)


def test_zscore_color_bar_diverges_around_zero(page, served):
    _open(page, served, {P: _plot(cellAxis=OBS, mode="heatmap", color=Z, sections=[{"source": S1, "rows": "genes"}]),
                         S1: _sig(S1, "Markers", GENES[5:9])}, open_ids=(P, S1))
    _drawn(page)
    assert "colorScale" not in _config(page)
    trace = page.evaluate("""(s) => { const t = document.querySelector(s + ' .cgene-plot').data.find(d => d.type === 'heatmap');
        return { scale: t.colorscale, zmid: t.zmid, zmin: t.zmin, zmax: t.zmax }; }""", TP)
    # the map is centred on 0 by a range symmetric about it (Plot Options' Center), and is RdBu, not the default Reds
    assert abs(trace["zmin"] + trace["zmax"]) < 1e-9 and trace["zmax"] > 0, trace
    # a mean colour keeps the one-direction map and the data's own range
    CC.pick_stat(page, TP, "color", "mean")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().color.stat === 'mean'", P)
    until(page, "(s) => document.querySelector(s + ' .cgene-plot').data.find(d => d.type === 'heatmap').colorscale !== 'RdBu'", TP)
    after = page.evaluate("""(s) => { const t = document.querySelector(s + ' .cgene-plot').data.find(d => d.type === 'heatmap');
        return { scale: t.colorscale, zmin: t.zmin, zmax: t.zmax }; }""", TP)
    assert after["scale"] != trace["scale"], "a mean colour is not on the z-score map"
    assert abs(after["zmin"] + after["zmax"]) > 1e-6, after


def test_zscore_disabled_for_size_with_reason(page, served):
    _open(page, served, {P: _plot(cellAxis=OBS, color=Z, sections=[{"source": S1, "rows": "genes"}]),
                         S1: _sig(S1, "Markers", GENES[5:8])}, open_ids=(P, S1))
    _drawn(page)
    for which, disabled in (("color", False), ("size", True)):
        opts = [[e["v"], e["off"], e["title"]] for e in CC.stat_entries(page, TP, which)]
        assert opts[0][0] == "zscore_mean", opts
        assert opts[0][1] is disabled, opts
    size = [[e["v"], e["off"], e["title"]] for e in CC.stat_entries(page, TP, "size")]
    assert size[0][2] == "Z-score mean is signed; dot size cannot show a sign. Use it for Color."
    # Scale's two z-scores are disabled under it, with the reason
    scales = dict((v, (d, t)) for v, d, t in page.eval_on_selector_all(
        f"{TP} .cgene-scale option", "os => os.map(o => [o.value, o.disabled, o.title])"))
    assert scales["z_groups"] == (True, "Color is already a z-score.") and scales["z_pooled"][0] is True
    assert scales["var"][0] is False


def test_constant_gene_has_no_value_and_says_why(page, served):
    _open(page, served, {P: _plot(cellAxis=OBS, mode="heatmap", color=Z, sections=[{"source": S1, "rows": "genes"}]),
                         S1: _sig(S1, "Mixed", [CONSTANT_GENE, GENE])}, open_ids=(P, S1))
    _drawn(page)
    heat = _heat(page)
    assert all(v is None for v in heat["z"][CONSTANT_GENE]), heat["z"][CONSTANT_GENE]
    assert all("constant over all cells: no z-score" in t for t in heat["text"][CONSTANT_GENE]), heat["text"][CONSTANT_GENE]
    assert all(v is not None for v in heat["z"][GENE])
