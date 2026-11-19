"""The layer a gene score is computed over, chosen per consumer (plots and table columns).

A consumer stores `{type: 'gene-score', key, column, layer}`; with no `layer` the signature's own
input applies (X by default), so links made before the choice keep their meaning. The consumer's
layer is the recipe's `input` for that request, so two layers of one signature are two scores and
one layer used twice is one. The store has X and one layer, `counts`.
"""
import json

from annzarro.tests.browser.test_gene_score_plots import (  # noqa: F401
    C, S, SIG, SCORE, _calls, _cell, _numbers, _open, _tag, _notice, _wait_coloured, _ready_plot, _slow, _finish,
    _box, _action, INIT, page, served, large_page, large_served, _wait_large_coloured, _url)
from annzarro.tests.browser.test_memory_guard import until


def _inputs(page):
    return sorted(c["input"] for c in _calls(page, "compute"))


def test_two_layers_of_one_signature_are_two_scores_and_a_shared_layer_is_one(page, served):
    cfg = _cell(x={**SCORE, "layer": "counts"}, y=SCORE, color={**SCORE, "layer": "counts"})
    _open(page, served, plots=(("cell-plot-C", cfg),))
    _ready_plot(page)
    assert _inputs(page) == ["X", "counts"], "x and colour share counts; y reads the signature's own X"
    titles = page.evaluate("(t) => { const l = document.querySelector(t + ' .js-plotly-plot').layout; return [l.xaxis.title.text, l.yaxis.title.text]; }", C)
    assert titles == ["T cell score · of counts", "T cell score"], "the layer is named when it is not the signature's own"
    # a layer that is the signature's own input is the same score as no layer
    page.goto("about:blank")
    _open(page, served, plots=(("cell-plot-C", _cell(x={**SCORE, "layer": "X"}, y=SCORE, color=SCORE)),))
    _ready_plot(page)
    assert len(_calls(page, "compute")) == 1
    assert page.evaluate("(t) => document.querySelector(t + ' .js-plotly-plot').layout.xaxis.title.text", C) == "T cell score"


def test_an_old_link_without_a_layer_reads_the_signatures_own_input(page, served):
    _open(page, served, plots=(("cell-plot-C", _cell()),), sig={"id": SIG, "title": "T cell score", "genes": ["GENE0001"], "input": "counts"})
    _wait_coloured(page)
    assert _inputs(page) == ["counts"]
    assert page.evaluate("(t) => document.querySelector(t + ' select.axis-layer-select[data-axis=\"color\"]').value", C) == ""


def test_the_layer_menu_lists_x_and_each_layer_and_choosing_one_recomputes_over_it(page, served):
    _open(page, served, plots=(("cell-plot-C", _cell()),))
    _wait_coloured(page)
    sel = f"{C} select.axis-layer-select[data-axis='color']"
    assert page.is_visible(sel)
    opts = page.evaluate("(s) => [...document.querySelector(s).options].map(o => [o.value, o.textContent])", sel)
    assert opts == [["", "of X (the signature's own)"], ["X", "of X"], ["counts", "of counts"]]
    page.select_option(sel, "counts")
    until(page, "() => window.PanelManager.getPanel('cell-plot-C').getConfig().color.layer === 'counts'")
    until(page, "() => window.__scoreCalls.filter(c => c.kind === 'compute').length === 2")
    assert _inputs(page) == ["X", "counts"]
    page.wait_for_timeout(1500)
    bars = page.evaluate("""(t) => document.querySelector(t + ' .js-plotly-plot').data
        .map(d => d.marker && d.marker.colorbar && d.marker.colorbar.title && (d.marker.colorbar.title.text || d.marker.colorbar.title)).filter(Boolean)""", C)
    assert bars == ["T cell score · of counts"]
    page.screenshot(path="/private/tmp/claude-501/-Users-dotto-gits-annzarro/d0efd83a-6333-4a2b-8ec0-f428a26626fb/scratchpad/gs5c-layer-menu.png", clip=None)
    # a plot that is not a score has no layer menu
    page.select_option(f"{C} select.axis-type-select[data-axis='color']", "obs")
    until(page, "(s) => document.querySelector(s).hidden", sel)
    assert "layer" not in page.evaluate("() => window.PanelManager.getPanel('cell-plot-C').getConfig().color")


def test_a_layer_missing_from_the_dataset_is_a_state_with_a_way_out_not_an_error(page, served):
    _open(page, served, plots=(("cell-plot-C", _cell(color={**SCORE, "layer": "log1p"})),), wait=False)
    page.wait_for_selector(f"{C} .score-notice[data-state='nolayer']", timeout=30000)
    note = _notice(page)
    assert "Layer 'log1p' is not in this dataset, so 'T cell score' has no score." in note["text"]
    assert _tag(page) == "Layer not found"
    assert [a.split("|")[0] for a in note["actions"]] == ["score-open", "score-choose"]
    opts = page.evaluate("(t) => [...document.querySelector(t + ' select.axis-layer-select[data-axis=\"color\"]').options].map(o => o.textContent)", C)
    assert "of log1p (not in this dataset)" in opts
    # choosing a layer that exists ends it
    page.select_option(f"{C} select.axis-layer-select[data-axis='color']", "counts")
    _wait_coloured(page)
    assert _notice(page) is None


def test_the_layer_round_trips_through_a_link_and_is_not_a_value(page, served):
    _open(page, served, plots=(("cell-plot-C", _cell(x={**SCORE, "layer": "counts"}, y=SCORE)),))
    _ready_plot(page)
    view = page.evaluate("() => (window.SessionManager || window.sessionManager).captureView()")
    cfg = view["layer" if False else "layout"]["panelConfigs"]["cell-plot-C"]
    assert cfg["x"]["layer"] == "counts" and "layer" not in cfg["y"]
    assert "values" not in json.dumps(view)
    other = page.context.browser.new_page()
    other.add_init_script(INIT)
    other.goto(page.url)
    other.wait_for_selector(f"{C} .js-plotly-plot", timeout=30000)
    _ready_plot(other)
    assert sorted(c["input"] for c in _calls(other, "compute")) == ["X", "counts"]
    assert other.evaluate("(t) => document.querySelector(t + ' select.axis-layer-select[data-axis=\"x\"]').value", C) == "counts"
    other.close()


def test_large_plot_mode_takes_the_same_layer_choice(large_page, large_served):
    cfg = _cell(x={**SCORE, "layer": "counts"}, y=SCORE, color={**SCORE, "layer": "counts"})
    _open(large_page, large_served, plots=(("cell-plot-C", cfg),))
    _wait_large_coloured(large_page)
    assert _inputs(large_page) == ["X", "counts"]
    bars = large_page.evaluate("""(t) => document.querySelector(t + ' .js-plotly-plot').data
        .map(d => d.marker && d.marker.colorbar && d.marker.colorbar.title && (d.marker.colorbar.title.text || d.marker.colorbar.title)).filter(Boolean)""", C)
    assert bars == ["T cell score · of counts"]


def test_a_table_column_has_its_own_layer(page, served):
    from annzarro.tests.browser import test_gene_score_tables as T
    col = {"type": "gene-score", "key": SIG, "column": "zscore_mean", "label": "T cell score", "layer": "counts"}
    plain = {"type": "gene-score", "key": SIG, "column": "zscore_mean", "label": "T cell score"}
    T._open(page, served, table=T._table(columns=[plain, col]))
    until(page, "() => window.__scoreCalls.filter(c => c.kind === 'compute').length === 2")
    assert sorted(c["input"] for c in _calls(page, "compute")) == ["X", "counts"]
    heads = T._headers(page)
    assert "T cell score" in heads and any(h.startswith("T cell score · of counts") for h in heads), heads
    # the chooser: a layer menu, and a tick under it is a column over that layer
    page.click(f"#gene-score-tab-{T.TID}")
    page.select_option(f"#gene-score-content-{T.TID} select.az-score-layer", "counts")
    assert page.is_checked(f"#checkbox-gene-score-{SIG}-zscore_mean-of-counts-{T.TID}")
    page.check(f"#checkbox-gene-score-{SIG}-mean-of-counts-{T.TID}")
    page.click(f"#apply-columns-{T.TID}")
    cfg = page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig().columns", T.TID)
    got = [(c["column"], c.get("layer")) for c in cfg if c["type"] == "gene-score"]
    assert ("mean", "counts") in got and ("zscore_mean", "counts") in got
