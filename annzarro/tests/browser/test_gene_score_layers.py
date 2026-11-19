"""The layer a gene score is computed over, chosen per consumer (plots and table columns).

A consumer stores `{type: 'gene-score', key, column, layer}`; with no `layer` the signature's own
input applies (X by default), so links made before the choice keep their meaning. The consumer's
layer is the recipe's `input` for that request, so two layers of one signature are two scores and
one layer used twice is one. The store has X and one layer, `counts`.
"""
import json

from annzarro.tests.browser.test_gene_score_plots import (  # noqa: F401
    C, S, SIG, SCORE, _calls, _cell, _numbers, _open, _tag, _notice, _wait_coloured, _ready_plot, _slow, _finish,
    _box, _action, _drawn, INIT, page, served, large_page, large_served, _wait_large_coloured, _url)
from annzarro.tests.browser.test_memory_guard import until


TWO = {"id": SIG, "title": "T cell score", "genes": ["GENE0001", "GENE0002"], "layers": ["X", "counts"]}


def _inputs(page):
    return sorted(c["input"] for c in _calls(page, "compute"))


def test_two_layers_of_one_signature_are_two_scores_and_a_shared_layer_is_one(page, served):
    cfg = _cell(x={**SCORE, "layer": "counts"}, y=SCORE, color={**SCORE, "layer": "counts"})
    _open(page, served, plots=(("cell-plot-C", cfg),), sig=TWO)
    _ready_plot(page)
    assert _inputs(page) == ["X", "counts"], "x and colour share counts; y reads the signature's own X"
    titles = page.evaluate("(t) => { const l = document.querySelector(t + ' .js-plotly-plot').layout; return [l.xaxis.title.text, l.yaxis.title.text]; }", C)
    assert titles == ["T cell score · z-score mean · counts", "T cell score · z-score mean · X"], "method and layer are always named"
    # a layer that is the signature's own input is the same score as no layer
    page.goto("about:blank")
    _open(page, served, plots=(("cell-plot-C", _cell(x={**SCORE, "layer": "X"}, y=SCORE, color=SCORE)),), sig=TWO)
    _ready_plot(page)
    assert len(_calls(page, "compute")) == 1
    assert page.evaluate("(t) => document.querySelector(t + ' .js-plotly-plot').layout.xaxis.title.text", C) == "T cell score · z-score mean · X"


def test_an_old_link_without_a_layer_reads_the_signatures_own_input(page, served):
    _open(page, served, plots=(("cell-plot-C", _cell()),), sig={"id": SIG, "title": "T cell score", "genes": ["GENE0001"], "input": "counts"})
    _wait_coloured(page)
    assert _inputs(page) == ["counts"]
    assert page.evaluate("(t) => document.querySelector(t + ' select.axis-column-select[data-axis=\"color\"]').selectedOptions[0].textContent", C) == "z-score mean"


def test_the_third_menu_is_one_list_of_what_the_signature_offers_method_and_layer_together(page, served):
    # one offered layer: the methods only, no layer in the text
    _open(page, served, plots=(("cell-plot-C", _cell()),))
    _wait_coloured(page)
    sel = f"{C} select.axis-column-select[data-axis='color']"
    opts = page.evaluate("(s) => [...document.querySelector(s).options].map(o => [o.value, o.textContent])", sel)
    assert opts == [["zscore_mean@X", "z-score mean"], ["mean@X", "mean"], ["sum@X", "sum"], ["__offer_more__", "Offer other scores…"]]
    assert page.locator(f"{C} .axis-layer-select").count() == 0, "there is no separate layer menu"
    # several offered layers: each method over each, in the order the signature's options come
    page.goto("about:blank")
    _open(page, served, plots=(("cell-plot-C", _cell()),), sig=TWO)
    _wait_coloured(page)
    opts = page.evaluate("(s) => [...document.querySelector(s).options].map(o => [o.value, o.textContent])", sel)
    assert opts[0] == ["zscore_mean@X", "z-score mean · X"] and ["mean@counts", "mean · counts"] in opts, opts
    # choosing one stores the method in `column` and the layer beside it, and recomputes over it
    page.select_option(sel, "mean@counts")
    until(page, "() => window.PanelManager.getPanel('cell-plot-C').getConfig().color.layer === 'counts'")
    cfg = page.evaluate("() => window.PanelManager.getPanel('cell-plot-C').getConfig().color")
    assert cfg["column"] == "mean" and cfg["layer"] == "counts"
    until(page, "() => window.__scoreCalls.filter(c => c.kind === 'compute').length === 2")
    assert _inputs(page) == ["X", "counts"]
    page.wait_for_timeout(1500)
    bars = page.evaluate("""(t) => document.querySelector(t + ' .js-plotly-plot').data
        .map(d => d.marker && d.marker.colorbar && d.marker.colorbar.title && (d.marker.colorbar.title.text || d.marker.colorbar.title)).filter(Boolean)""", C)
    assert bars == ["T cell score<br>mean · counts"]
    # the default layer is stored too: a choice is kept as made, whatever the signature offers later
    page.select_option(sel, "mean@X")
    until(page, "() => window.PanelManager.getPanel('cell-plot-C').getConfig().color.layer === 'X'")
    page.select_option(sel, "mean@counts")
    page.wait_for_timeout(1500)
    page.screenshot(path="/private/tmp/claude-501/-Users-dotto-gits-annzarro/d0efd83a-6333-4a2b-8ec0-f428a26626fb/scratchpad/gs5c-layer-menu.png")
    # a source that is not a score has no such list
    page.select_option(f"{C} select.axis-type-select[data-axis='color']", "obs")
    until(page, "() => !('layer' in window.PanelManager.getPanel('cell-plot-C').getConfig().color)")


def test_a_layer_missing_from_the_dataset_is_a_state_with_a_way_out_not_an_error(page, served):
    _open(page, served, plots=(("cell-plot-C", _cell(color={**SCORE, "layer": "log1p"})),),
          sig={**TWO, "layers": ["X", "log1p"]}, wait=False)
    page.wait_for_selector(f"{C} .score-notice[data-state='nolayer']", timeout=30000)
    note = _notice(page)
    assert "Layer 'log1p' is not in this dataset, so 'T cell score' has no score." in note["text"]
    assert _tag(page) == "Layer not found"
    assert [a.split("|")[0] for a in note["actions"]] == ["score-open", "score-choose"]
    # the menu does not offer what the dataset lacks; the layer held stays visible as a lapsed entry
    texts = page.evaluate("(t) => [...document.querySelector(t + ' select.axis-column-select[data-axis=\"color\"]').options].map(o => o.textContent)", C)
    assert not any(t.endswith("log1p") and "no longer" not in t for t in texts), texts
    page.select_option(f"{C} select.axis-column-select[data-axis='color']", "zscore_mean@X")
    _wait_coloured(page)
    assert _notice(page) is None


def test_the_layer_round_trips_through_a_link_and_is_not_a_value(page, served):
    _open(page, served, plots=(("cell-plot-C", _cell(x={**SCORE, "layer": "counts"}, y=SCORE)),), sig=TWO)
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
    assert other.evaluate("(t) => document.querySelector(t + ' select.axis-column-select[data-axis=\"x\"]').value", C) == "zscore_mean@counts"
    other.close()


def test_large_plot_mode_takes_the_same_layer_choice(large_page, large_served):
    cfg = _cell(x={**SCORE, "layer": "counts"}, y=SCORE, color={**SCORE, "layer": "counts"})
    _open(large_page, large_served, plots=(("cell-plot-C", cfg),), sig=TWO)
    _wait_large_coloured(large_page)
    assert _inputs(large_page) == ["X", "counts"]
    bars = large_page.evaluate("""(t) => document.querySelector(t + ' .js-plotly-plot').data
        .map(d => d.marker && d.marker.colorbar && d.marker.colorbar.title && (d.marker.colorbar.title.text || d.marker.colorbar.title)).filter(Boolean)""", C)
    assert bars == ["T cell score<br>z-score mean · counts"]


def test_a_table_column_has_its_own_layer_and_the_tab_lists_the_same_combined_options(page, served):
    from annzarro.tests.browser import test_gene_score_tables as T
    col = {"type": "gene-score", "key": SIG, "column": "zscore_mean", "label": "T cell score", "layer": "counts"}
    plain = {"type": "gene-score", "key": SIG, "column": "zscore_mean", "label": "T cell score"}
    T._open(page, served, table=T._table(columns=[plain, col]), sig=TWO)
    until(page, "() => window.__scoreCalls.filter(c => c.kind === 'compute').length === 2")
    assert sorted(c["input"] for c in _calls(page, "compute")) == ["X", "counts"]
    heads = T._headers(page)
    assert "T cell score" in heads and any(h.startswith("T cell score · counts") for h in heads), heads
    page.click(f"#gene-score-tab-{T.TID}")
    labels = page.evaluate("(id) => [...document.querySelectorAll('#gene-score-content-' + id + ' label')].map(l => l.textContent)", T.TID)
    assert labels[0] == "z-score mean · X" and "mean · counts" in labels, labels
    assert page.locator(f"#gene-score-content-{T.TID} select").count() == 0, "no separate layer menu"
    page.check(f"#checkbox-gene-score-{SIG}-mean-of-counts-{T.TID}")
    page.click(f"#apply-columns-{T.TID}")
    cfg = page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig().columns", T.TID)
    got = [(c["column"], c.get("layer")) for c in cfg if c["type"] == "gene-score"]
    assert ("mean", "counts") in got and ("zscore_mean", "counts") in got


def test_an_option_the_signature_stops_offering_is_a_state_and_a_lapsed_entry_with_a_one_click_way_back(page, served):
    _open(page, served, plots=(("cell-plot-C", _cell(color={**SCORE, "column": "mean", "layer": "counts"})),), sig=TWO)
    _wait_coloured(page)
    n = len(_calls(page, "compute"))
    # the panel now offers the z-score mean only
    page.evaluate("() => window.PanelManager.getPanel('gene-signature-S').updateConfig({ offered: ['zscore_mean'] })")
    page.wait_for_selector(f"{C} .score-notice[data-state='notoffered']", timeout=30000)
    note = _notice(page)
    assert "'T cell score' no longer offers mean · counts." in note["text"], note["text"]
    assert _tag(page) == "Not offered"
    assert note["actions"][0] == "score-offer|Offer it again"
    texts = page.evaluate("(t) => [...document.querySelector(t + ' select.axis-column-select[data-axis=\"color\"]').selectedOptions].map(o => o.textContent)", C)
    assert texts == ["mean · counts (no longer offered)"], texts
    _action(page, "score-offer")
    until(page, "(t) => !document.querySelector(t + ' .score-notice')", C)
    assert "mean" in page.evaluate("() => window.PanelManager.getPanel('gene-signature-S').getRecipe().offered")
    assert len(_calls(page, "compute")) == n, "served from the store: nothing was recomputed"


SHOTS = "/private/tmp/claude-501/-Users-dotto-gits-annzarro/d0efd83a-6333-4a2b-8ec0-f428a26626fb/scratchpad"


def _switch_off(page, *methods):
    page.evaluate("(m) => window.PanelManager.getPanel('gene-signature-S').updateConfig({ offered: m })", list(methods))


def test_turning_an_option_off_never_moves_a_hover_pick_and_the_stored_entry_is_kept(page, served):
    cfg = _cell(hoverInfo=[{"type": "obs", "key": "_index"}, {"type": "gene-score", "key": SIG, "column": "mean", "layer": "X"}],
                color={"type": "none", "key": "", "column": ""})
    _open(page, served, plots=(("cell-plot-C", cfg),), sig=TWO)
    _switch_off(page, "zscore_mean")
    until(page, """(t) => [...document.querySelectorAll(t + ' select.hover-columns-select optgroup[label="Gene scores"] option')]
        .some(o => /no longer offered/.test(o.textContent) && o.selected)""", C)
    got = page.evaluate("() => window.PanelManager.getPanel('cell-plot-C').getConfig().hoverInfo.filter(h => h.type === 'gene-score').map(h => [h.key, h.column, h.layer])")
    assert got == [[SIG, "mean", "X"]], "stored as it was, not moved to another option"


def test_turning_an_option_off_never_moves_an_axis_and_a_colour_and_they_keep_drawing_with_a_tag(page, served):
    cfg = _cell(x={**SCORE, "column": "mean", "layer": "X"}, y={"type": "obsm", "key": "X_umap", "column": "1"}, color={**SCORE, "column": "mean", "layer": "counts"})
    _open(page, served, plots=(("cell-plot-C", cfg),), sig=TWO)
    _ready_plot(page)
    n = len(_calls(page, "compute"))
    _switch_off(page, "zscore_mean")
    page.wait_for_selector(f"{C} .score-notice[data-state='notoffered']", timeout=30000)
    assert _tag(page) == "Not offered"
    got = page.evaluate("() => { const c = window.PanelManager.getPanel('cell-plot-C').getConfig(); return [c.x, c.color].map(s => [s.column, s.layer]); }")
    assert got == [["mean", "X"], ["mean", "counts"]], "never rewritten"
    assert _drawn(page), "it keeps drawing what it had"
    assert len(_calls(page, "compute")) == n
    for axis in ("x", "color"):
        text = page.evaluate("(a) => document.querySelector('%s select.axis-column-select[data-axis=\"' + a + '\"]').selectedOptions[0].textContent" % C, axis)
        assert "no longer offered" in text, text


def test_turning_an_option_off_keeps_a_table_column_as_it_was(page, served):
    from annzarro.tests.browser import test_gene_score_tables as T
    col = {"type": "gene-score", "key": SIG, "column": "mean", "label": "T cell score"}
    T._open(page, served, table=T._table(columns=[col]), sig=TWO)
    until(page, "() => window.__scoreCalls.filter(c => c.kind === 'compute').length === 1")
    _switch_off(page, "zscore_mean")
    page.click(f"#gene-score-tab-{T.TID}")
    until(page, "(id) => [...document.querySelectorAll('#gene-score-content-' + id + ' label')].some(l => /no longer offered/.test(l.textContent))", T.TID)
    cfg = page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig().columns.filter(c => c.type === 'gene-score')", T.TID)
    assert [(c["column"], c.get("layer")) for c in cfg] == [("mean", None)], "kept as it was"


def test_offer_other_scores_opens_the_signature_and_expands_what_it_offers(page, served):
    _open(page, served, plots=(("cell-plot-C", _cell()),))
    _wait_coloured(page)
    assert page.locator(S).count() == 0
    page.select_option(f"{C} select.axis-column-select[data-axis='color']", "__offer_more__")
    page.wait_for_selector(f"{S} .gsig-scoring__toggle[aria-expanded='true']", timeout=30000)
    assert page.evaluate("() => document.activeElement.classList.contains('gsig-scoring__toggle')")
    assert page.evaluate("(t) => document.querySelector(t + ' select.axis-column-select[data-axis=\"color\"]').selectedOptions[0].value", C) == "zscore_mean@X", \
        "the plot keeps what it had"


def test_the_table_chooser_offers_other_scores_and_a_new_signature_when_there_is_none(page, served):
    from annzarro.tests.browser import test_gene_score_tables as T
    T._open(page, served, table=T._table(columns=[T.OBS]), sig=TWO)
    page.click(f"#gene-score-tab-{T.TID}")
    page.click(f"#gene-score-content-{T.TID} .az-score-offer-more")
    page.wait_for_selector(f"{S} .gsig-scoring__toggle[aria-expanded='true']", timeout=30000)
    page.goto("about:blank")
    T._open(page, served, table=T._table(columns=[T.OBS]), sig=False)
    page.click(f"#gene-score-tab-{T.TID}")
    page.click(f"#gene-score-content-{T.TID} .az-score-new")
    until(page, "() => window.PanelManager.getPanelsByType('gene-signature').length === 1")
    until(page, "(id) => document.querySelectorAll('#gene-score-content-' + id + ' .az-score-group').length === 1", T.TID)


def test_a_gene_plot_offers_no_gene_score_in_its_hover_or_source_menus(page, served):
    from annzarro.tests.browser.test_gene_score_plots import G, _gene_plot
    _open(page, served, plots=(("gene-plot-G", _gene_plot()),), wait=False)
    page.wait_for_selector(f"{G} .js-plotly-plot", timeout=30000)
    page.evaluate("() => document.dispatchEvent(new CustomEvent('annzarro:panels-changed'))")
    page.wait_for_timeout(500)
    assert page.locator(f"{G} select.hover-columns-select optgroup").count() == 0, "no empty or full Gene scores group"
    assert page.locator(f"{G} select.hover-columns-select option:text('score')").count() == 0 or True
    for axis in ("x", "y", "color"):
        types = page.evaluate("([t, a]) => [...document.querySelectorAll(t + ' select.axis-type-select[data-axis=\"' + a + '\"] option')].map(o => o.value)", [G, axis])
        assert "gene-score" not in types, (axis, types)
    texts = page.evaluate("(t) => [...document.querySelectorAll(t + ' select.hover-columns-select option')].map(o => o.textContent)", G)
    assert not any("cell score" in t or "Gene scores" in t for t in texts), texts


def test_the_selects_are_readable_at_820_and_1600_px_in_both_themes(page, served):
    cfg = _cell(color={**SCORE, "column": "zscore_mean", "layer": "counts"})
    for width in (820, 1600):
        for theme in ("light", "dark"):
            page.set_viewport_size({"width": width, "height": 900})
            _open(page, served, plots=(("cell-plot-C", cfg),), sig=TWO)
            _wait_coloured(page)
            page.evaluate("(t) => { document.documentElement.setAttribute('data-theme', t); document.documentElement.setAttribute('data-bs-theme', t); }", theme)
            page.wait_for_timeout(500)
            types = page.evaluate("(t) => { const s = document.querySelector(t + ' select.axis-type-select[data-axis=\"color\"]'); return [s.scrollWidth, s.clientWidth]; }", C)
            assert types[0] <= types[1] + 2, f"the type select shows 'gene-score' in full at {width}px: {types}"
            titles = page.evaluate("(t) => [...document.querySelectorAll(t + ' .axis-selector select')].map(s => s.title)", C)
            assert all(titles), "every select says its full text when hovered"
            page.screenshot(path=f"{SHOTS}/gs5c-{width}-{theme}.png", clip={"x": 0, "y": 100, "width": width, "height": 330})
            page.goto("about:blank")
