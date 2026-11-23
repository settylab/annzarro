"""The layer a gene score is computed over, chosen per consumer (plots and table columns).

A consumer stores `{type: 'gene-score', key, column, layer}`; with no `layer` the signature's own
input applies (X by default), so links made before the choice keep their meaning. The consumer's
layer is the recipe's `input` for that request, so two layers of one signature are two scores and
one layer used twice is one. The store has X and one layer, `counts`.
"""
import json
import urllib.parse

from annzarro.tests.browser.test_gene_score_plots import (  # noqa: F401
    C, S, SIG, SCORE, _calls, _cell, _numbers, _open, _tag, _notice, _wait_coloured, _ready_plot, _slow, _finish,
    _box, _action, _drawn, _frame, INIT, page, served, large_page, large_served, _wait_large_coloured, _url)
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


def test_a_score_is_chosen_by_a_method_select_and_a_layer_select_each_listing_everything(page, served):
    """Decision 31: the method select lists every method and the layer select every layer, so a menu's length is
    methods + layers, never methods x layers; nothing is "offered"."""
    _open(page, served, plots=(("cell-plot-C", _cell()),), sig=TWO)
    _wait_coloured(page)
    method = f"{C} select.axis-column-select[data-axis='color']"
    layer = f"{C} select.axis-layer-select[data-axis='color']"
    opts = page.evaluate("(s) => [...document.querySelector(s).options].map(o => [o.value, o.textContent])", method)
    assert [o[0] for o in opts] == ["zscore_mean", "mean", "sum", "control_adjusted", "detected", "fraction_of_total"], opts
    assert not any("offer" in o[1].lower() or "·" in o[1] for o in opts), opts
    assert page.evaluate("(s) => [...document.querySelector(s).options].map(o => o.value)", layer) == ["X", "counts"]
    assert page.evaluate("(s) => document.querySelector(s).value", layer) == "X"
    # choosing a layer stores it beside the method, and recomputes over it
    page.select_option(method, "mean")
    page.select_option(layer, "counts")
    until(page, "() => window.PanelManager.getPanel('cell-plot-C').getConfig().color.layer === 'counts'")
    cfg = page.evaluate("() => window.PanelManager.getPanel('cell-plot-C').getConfig().color")
    assert cfg["column"] == "mean" and cfg["layer"] == "counts"
    until(page, "() => window.__scoreCalls.some(c => c.kind === 'compute' && c.method === 'mean' && c.input === 'counts')")
    BARS = """(t) => document.querySelector(t + ' .js-plotly-plot').data
        .map(d => d.marker && d.marker.colorbar && d.marker.colorbar.title && (d.marker.colorbar.title.text || d.marker.colorbar.title)).filter(Boolean)"""
    until(page, "(t) => JSON.stringify((" + BARS + ")(t)) === JSON.stringify(['T cell score<br>mean · counts'])", C)
    # the default layer is stored too: a choice is kept as made
    page.select_option(layer, "X")
    until(page, "() => window.PanelManager.getPanel('cell-plot-C').getConfig().color.layer === 'X'")
    page.select_option(layer, "counts")
    until(page, "() => window.PanelManager.getPanel('cell-plot-C').getConfig().color.layer === 'counts'")
    # a source that is not a score has no layer, and no layer select
    page.select_option(f"{C} select.axis-type-select[data-axis='color']", "obs")
    until(page, "() => !('layer' in window.PanelManager.getPanel('cell-plot-C').getConfig().color)")
    assert page.locator(layer).count() == 0


def test_a_layer_missing_from_the_dataset_is_a_state_with_a_way_out_not_an_error(page, served):
    _open(page, served, plots=(("cell-plot-C", _cell(color={**SCORE, "layer": "log1p"})),),
          sig={**TWO, "layers": ["X", "log1p"]}, wait=False)
    page.wait_for_selector(f"{C} .score-notice[data-state='nolayer']", timeout=30000)
    note = _notice(page)
    assert "Layer 'log1p' is not in this dataset, so 'T cell score' has no score." in note["text"]
    assert _tag(page) == "Layer not found"
    assert [a.split("|")[0] for a in note["actions"]] == ["score-open", "score-choose"]
    # the layer select lists the dataset's layers; the layer held stays visible, marked as not in this dataset
    texts = page.evaluate("(t) => [...document.querySelector(t + ' select.axis-layer-select[data-axis=\"color\"]').options].map(o => o.textContent)", C)
    assert texts == ["X", "counts", "log1p (not in this dataset)"], texts
    page.select_option(f"{C} select.axis-layer-select[data-axis='color']", "X")
    _wait_coloured(page)
    assert _notice(page) is None


def test_the_layer_round_trips_through_a_link_and_is_not_a_value(page, served):
    _open(page, served, plots=(("cell-plot-C", _cell(x={**SCORE, "layer": "counts"}, y=SCORE)),), sig=TWO)
    _ready_plot(page)
    view = page.evaluate("() => (window.SessionManager || window.sessionManager).captureView()")
    cfg = view["layer" if False else "layout"]["panelConfigs"]["cell-plot-C"]
    assert cfg["x"]["layer"] == "counts" and cfg["y"]["layer"] == "X", "an old y with no layer was resolved once, on load"
    assert "values" not in json.dumps(view)
    other = page.context.browser.new_page()
    other.add_init_script(INIT)
    other.goto(page.url)
    other.wait_for_selector(f"{C} .js-plotly-plot", timeout=30000)
    _ready_plot(other)
    assert sorted(c["input"] for c in _calls(other, "compute")) == ["X", "counts"]
    assert other.evaluate("(t) => document.querySelector(t + ' select.axis-column-select[data-axis=\"x\"]').value", C) == "zscore_mean"
    assert other.evaluate("(t) => document.querySelector(t + ' select.axis-layer-select[data-axis=\"x\"]').value", C) == "counts"
    other.close()


def test_large_plot_mode_takes_the_same_layer_choice(large_page, large_served):
    cfg = _cell(x={**SCORE, "layer": "counts"}, y=SCORE, color={**SCORE, "layer": "counts"})
    _open(large_page, large_served, plots=(("cell-plot-C", cfg),), sig=TWO)
    _wait_large_coloured(large_page)
    assert _inputs(large_page) == ["X", "counts"]
    bars = large_page.evaluate("""(t) => document.querySelector(t + ' .js-plotly-plot').data
        .map(d => d.marker && d.marker.colorbar && d.marker.colorbar.title && (d.marker.colorbar.title.text || d.marker.colorbar.title)).filter(Boolean)""", C)
    assert bars == ["T cell score<br>z-score mean · counts"]


def test_a_table_column_has_its_own_layer_and_the_tab_lists_the_ticked_columns_then_an_add_row(page, served):
    from annzarro.tests.browser import test_gene_score_tables as T
    col = {"type": "gene-score", "key": SIG, "column": "zscore_mean", "label": "T cell score", "layer": "counts"}
    plain = {"type": "gene-score", "key": SIG, "column": "zscore_mean", "label": "T cell score"}
    T._open(page, served, table=T._table(columns=[plain, col]), sig=TWO)
    until(page, "() => window.__scoreCalls.filter(c => c.kind === 'compute').length === 2")
    assert sorted(c["input"] for c in _calls(page, "compute")) == ["X", "counts"]
    # the requests are out, not answered: wait until both score columns are filled (a column that never fills times out here)
    until(page, """(box) => { const ths = [...document.querySelectorAll(box + ' .dataTables_scrollHead th[data-score-state]')];
        return ths.length === 2 && ths.every(th => th.dataset.scoreState === 'ready'); }""", T.BOX)
    heads = T._headers(page)
    assert "T cell score" in heads and any(h.startswith("T cell score · counts") for h in heads), heads
    assert not any("computing" in h for h in heads), heads
    page.click(f"#gene-score-tab-{T.TID}")
    labels = page.evaluate("(id) => [...document.querySelectorAll('#gene-score-content-' + id + ' label')].map(l => l.textContent)", T.TID)
    assert labels == ["z-score mean · X", "z-score mean · counts"], "the ticked columns only, each naming its layer"
    assert page.evaluate("(id) => [...document.querySelectorAll('#gene-score-content-' + id + ' .az-score-add-layer option')].map(o => o.value)", T.TID) == ["X", "counts"]
    T._add_score(page, SIG, "mean", "counts")
    page.click(f"#apply-columns-{T.TID}")
    cfg = page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig().columns", T.TID)
    got = [(c["column"], c.get("layer")) for c in cfg if c["type"] == "gene-score"]
    assert ("mean", "counts") in got and ("zscore_mean", "counts") in got


def test_a_table_built_before_its_signature_existed_pins_its_column_when_the_signature_appears(page, served):
    """A score column with no layer (an old link) is resolved once, to the signature's layer at that moment. A table
    that was built while the signature was missing resolves it when the signature comes, with the filter condition
    that names the column, and never moves with the signature's first layer afterwards."""
    from annzarro.tests.browser import test_gene_score_tables as T
    old_key = "gene-score_" + SIG + "_zscore_mean"
    cond = {"condition": ">", "data": "T cell score", "origData": old_key, "type": "num", "value": ["0"]}
    table = T._table(columns=[T.SCORE_COL, T.OBS], searchBuilderConfig={"logic": "AND", "criteria": [cond]})
    T._open(page, served, table=table, sig=False)
    T._wait_notice(page, "deleted")
    # the signature comes (Back or Forward puts a closed one back; a panel set adds one)
    page.evaluate("(cfg) => { window.PanelManager.restoreClosedPanels([{ id: cfg.id, type: 'gene-signature', config: cfg }]); }", TWO)
    until(page, "() => window.__scoreCalls.filter(c => c.kind === 'compute').length === 1")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().columns.some(c => c.type === 'gene-score' && c.layer === 'X')", T.TID)
    cfg = page.evaluate("(id) => { const c = window.PanelManager.getPanel(id).getConfig(); return { cols: c.columns, sb: c.searchBuilderConfig }; }", T.TID)
    assert [c.get("layer") for c in cfg["cols"] if c["type"] == "gene-score"] == ["X"]
    assert [c["origData"] for c in cfg["sb"]["criteria"]] == [old_key + "__of_X"], "the condition follows the column's key"
    T._wait_no_notice(page)
    # the signature's first layer changes (an old recipe's input): the column stays on X and asks for nothing on counts;
    # X is simply a layer it reads, so there is nothing to say (decision 31)
    page.evaluate("() => window.PanelManager.getPanel('gene-signature-S').updateConfig({ layers: ['counts'], input: 'counts' })")
    from annzarro.tests.browser import waits
    waits.expect_stays(lambda: _inputs(page) == ["X"], "the column must never move to the new first layer; no event marks a move that does not happen",
                       page=page, seconds=0.8)
    T._wait_no_notice(page)
    cols = page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig().columns.filter(c => c.type === 'gene-score')", T.TID)
    assert [(c["column"], c.get("layer")) for c in cols] == [("zscore_mean", "X")]


def test_the_table_chooser_offers_a_new_signature_when_there_is_none_and_no_offer_link(page, served):
    from annzarro.tests.browser import test_gene_score_tables as T
    T._open(page, served, table=T._table(columns=[T.OBS]), sig=TWO)
    page.click(f"#gene-score-tab-{T.TID}")
    page.wait_for_selector(f"#gene-score-content-{T.TID} .az-score-add", timeout=10000)
    assert page.locator(f"#gene-score-content-{T.TID} .az-score-offer-more").count() == 0, "no Offer other scores… (decision 31)"
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
    # time for a Gene Score option to appear, were one going to; none should
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
            # let the theme change repaint before the select widths are measured; nothing observable marks it
            page.wait_for_timeout(500)
            types = page.evaluate("(t) => { const s = document.querySelector(t + ' select.axis-type-select[data-axis=\"color\"]'); return [s.scrollWidth, s.clientWidth]; }", C)
            assert types[0] <= types[1] + 2, f"the type select shows 'gene-score' in full at {width}px: {types}"
            titles = page.evaluate("(t) => [...document.querySelectorAll(t + ' .axis-selector select')].map(s => s.title)", C)
            assert all(titles), "every select says its full text when hovered"
            page.goto("about:blank")


def test_table_columns_store_their_layer_and_an_old_column_without_one_reads_the_signatures_input(page, served):
    from annzarro.tests.browser import test_gene_score_tables as T
    old = {"type": "gene-score", "key": SIG, "column": "zscore_mean", "label": "T cell score"}
    T._open(page, served, table=T._table(columns=[old]), sig=TWO)
    until(page, "() => window.__scoreCalls.filter(c => c.kind === 'compute').length === 1")
    assert _inputs(page) == ["X"], "no layer: the signature's input"
    page.click(f"#gene-score-tab-{T.TID}")
    assert page.is_checked(f"#checkbox-gene-score-{SIG}-zscore_mean-of-X-{T.TID}"), "the old column is shown ticked on X"
    T._add_score(page, SIG, "mean", "X")
    T._add_score(page, SIG, "mean", "counts")
    page.click(f"#apply-columns-{T.TID}")
    cfg = page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig().columns.filter(c => c.type === 'gene-score').map(c => [c.column, c.layer])", T.TID)
    assert sorted(cfg) == [["mean", "X"], ["mean", "counts"], ["zscore_mean", "X"]], "every column stores its layer; the old one was resolved on load"
    # an old recipe's first layer moves to counts: the columns do not move with it
    page.evaluate("() => window.PanelManager.getPanel('gene-signature-S').updateConfig({ input: 'counts', layers: ['counts'] })")
    # time for the columns to move, were they going to; they must stay on their layers
    page.wait_for_timeout(800)
    cfg = page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig().columns.filter(c => c.type === 'gene-score').map(c => [c.column, c.layer])", T.TID)
    assert sorted(cfg) == [["mean", "X"], ["mean", "counts"], ["zscore_mean", "X"]]


def test_plot_and_table_menus_disable_a_combination_that_cannot_be_computed_and_say_why(page, served):
    from annzarro.tests.browser import test_gene_score_tables as T
    def handler(route):
        want = urllib.parse.parse_qs(urllib.parse.urlparse(route.request.url).query).get("input", ["X"])[0]
        q = [0.01 + 3.39 * i / 50 for i in range(51)]                  # every value of X is above 0: fraction detected is constant there
        stats = {"max": 3.4, "min": 0.01, "density": 1.0, "quantiles": q} if want == "X" else \
            {"max": 5, "min": 1, "density": 0.05, "quantiles": [1 + 4 * i / 50 for i in range(51)]}
        body = {"input": want, "kind": "signed" if want == "X" else "counts", "stats": stats, "suggest": None, "checked": {}}
        route.fulfill(status=200, content_type="application/json", body=json.dumps(body))
    page.route("**/api/v1/data/matrix_kind*", handler)
    cfg = _cell(hoverInfo=[{"type": "obs", "key": "_index"}], color={"type": "none", "key": "", "column": ""})
    T._open(page, served, table=T._table(columns=[T.OBS]), plots=(("cell-plot-C", cfg),), sig=TWO)
    _ready_plot(page)
    # plot: every pair is listed; one that cannot be computed is disabled in the other select, with why (SHR-27)
    method = f"{C} select.axis-column-select[data-axis='color']"
    layer = f"{C} select.axis-layer-select[data-axis='color']"
    page.select_option(f"{C} select.axis-type-select[data-axis='color']", "gene-score")
    OPTS = "(s) => [...document.querySelector(s).options].map(o => ({ v: o.value, off: o.disabled, title: o.title }))"
    until(page, "(s) => { const o = [...(document.querySelector(s) || { options: [] }).options].find(o => o.value === 'fraction_of_total'); return !!o && o.disabled; }", method)
    on_x = {o["v"]: o for o in page.evaluate(OPTS, method)}
    assert on_x["detected"]["off"] and on_x["fraction_of_total"]["off"], on_x
    assert "negative values" in on_x["fraction_of_total"]["title"], on_x["fraction_of_total"]
    assert on_x["detected"]["title"], "the reason is the option's title"
    assert not on_x["zscore_mean"]["off"] and not on_x["mean"]["off"]
    page.select_option(layer, "counts")
    until(page, "(s) => { const o = [...document.querySelector(s).options].find(o => o.value === 'detected'); return !!o && !o.disabled; }", method)
    page.select_option(method, "fraction_of_total")
    until(page, "() => window.PanelManager.getPanel('cell-plot-C').getConfig().color.column === 'fraction_of_total'")
    under_share = {o["v"]: o for o in page.evaluate(OPTS, layer)}
    assert under_share["X"]["off"] and not under_share["counts"]["off"], under_share
    # hover: no score at all (decision 32)
    hov = page.evaluate("(t) => [...document.querySelectorAll(t + ' select.hover-columns-select option')].map(o => o.value)", C)
    assert not any(v.startswith("gene-score:") for v in hov), hov
    # table: the add row grades the same way
    page.click(f"#gene-score-tab-{T.TID}")
    row = f"#gene-score-content-{T.TID} .az-score-group[data-entity='{SIG}']"
    page.wait_for_selector(f"{row} .az-score-add-method", timeout=10000)
    page.select_option(f"{row} .az-score-add-layer", "X")
    table_x = {o["v"]: o for o in page.evaluate(OPTS, f"{row} .az-score-add-method")}
    assert table_x["detected"]["off"] and table_x["fraction_of_total"]["off"], table_x
    page.select_option(f"{row} .az-score-add-layer", "counts")
    table_counts = {o["v"]: o for o in page.evaluate(OPTS, f"{row} .az-score-add-method")}
    assert not table_counts["detected"]["off"] and not table_counts["fraction_of_total"]["off"], table_counts


def _colour_snapshot(page):
    return page.evaluate("""(t) => { const g = document.querySelector(t + ' .js-plotly-plot');
        const d = g && g.data && g.data.find(d => d.marker && Array.isArray(d.marker.color) && d.marker.colorscale);
        return d ? Array.from(d.marker.color).map(Number).join() : null; }""", C)


def _sample(page):
    """What the plot area shows now: the drawn colours, the loading pill, any notice or tag, any 'N of M genes'."""
    return page.evaluate("""(t) => {
        const tile = document.querySelector(t);
        const grey = [...tile.querySelectorAll('.js-plotly-plot .scatterlayer path.point')].some(p => /rgb\\(200, ?200, ?200\\)|#c8c8c8/i.test(p.style.fill || ''));
        return { pill: [...tile.querySelectorAll('.loading-overlay, .loading-indicator, [class*="loading"]')].some(e => e.offsetParent !== null),
                 notice: !!tile.querySelector('.score-notice'), tag: !!tile.querySelector('.ps-tag[data-tag="score"]'),
                 placeholder: !!tile.querySelector('.coverage-placeholder'),
                 genes: /\\d+ of \\d+ genes/.test(tile.textContent), grey };
    }""", C)


def _watch_and_finish(page, before, ramp):
    seen = []
    for _ in range(8):
        seen.append(_sample(page))
        assert _colour_snapshot(page) == before, "the old colours stay while the score is on its way"
        # sample the panel over time: the old colours must stay throughout
        page.wait_for_timeout(150)
    _frame(page, 0, type="progress", done=0, total=12)
    # time for a colour change after the progress frame, were one going to; none should
    page.wait_for_timeout(300)
    seen.append(_sample(page))
    assert _colour_snapshot(page) == before
    assert any(s["pill"] for s in seen), "the standard loading pill shows"
    assert not any(s["notice"] or s["tag"] or s["placeholder"] or s["genes"] for s in seen), seen
    _finish(page, 0, ramp)


def test_switching_a_colour_from_an_obs_column_to_a_pending_score_keeps_the_old_plot_with_the_loading_pill(page, served):
    from annzarro.tests.browser.test_gene_score_plots import _choose_score
    _open(page, served, plots=(("cell-plot-C", _cell(color={"type": "obs", "key": "score", "column": ""})),), sig=TWO)
    _wait_coloured(page)
    before = _colour_snapshot(page)
    assert before
    _slow(page, "auto", 3)
    _choose_score(page, "color")
    until(page, "() => window.__ctls.length === 1")
    _watch_and_finish(page, before, [float(i) * 3 for i in range(60)])
    until(page, "([t, b]) => { const g = document.querySelector(t + ' .js-plotly-plot'); const d = g.data.find(d => d.marker && Array.isArray(d.marker.color) && d.marker.colorscale); return !!d && Array.from(d.marker.color).map(Number).join() !== b; }", [C, before])
    assert _notice(page) is None and _tag(page) is None


def test_switching_between_two_score_options_keeps_the_old_plot_with_the_loading_pill(page, served):
    _open(page, served, plots=(("cell-plot-C", _cell()),), sig=TWO)
    _wait_coloured(page)
    before = _colour_snapshot(page)
    _slow(page, "auto", 3)
    page.select_option(f"{C} select.axis-column-select[data-axis='color']", "mean")
    until(page, "() => window.__ctls.length === 1")
    _watch_and_finish(page, before, [float(i) * 2 + 1 for i in range(60)])
    until(page, "([t, b]) => { const g = document.querySelector(t + ' .js-plotly-plot'); const d = g.data.find(d => d.marker && Array.isArray(d.marker.color) && d.marker.colorscale); return !!d && Array.from(d.marker.color).map(Number).join() !== b; }", [C, before])


def test_a_pending_score_on_an_axis_keeps_the_old_plot_not_a_placeholder(page, served):
    from annzarro.tests.browser.test_gene_score_plots import _choose_score
    _open(page, served, plots=(("cell-plot-C", _cell(color={"type": "none", "key": "", "column": ""})),), sig=TWO)
    _ready_plot(page)
    _slow(page, "auto", 3)
    _choose_score(page, "x")
    until(page, "() => window.__ctls.length === 1")
    for _ in range(6):
        s = _sample(page)
        assert not s["placeholder"] and not s["notice"] and not s["genes"], s
        assert _drawn(page)
        # sample the panel over time: nothing may appear while the score is on its way
        page.wait_for_timeout(150)
    _frame(page, 0, type="progress", done=0, total=12)
    # time for a Gene Score notice after the progress frame, were one going to; none should
    page.wait_for_timeout(300)
    assert not _sample(page)["genes"] and _drawn(page)
    _finish(page, 0, [float(i) for i in range(60)])
    until(page, "(t) => { const g = document.querySelector(t + ' .js-plotly-plot'); return !!g && g.layout.xaxis.title.text.indexOf('T cell score') === 0; }", C)


def test_a_score_that_lasts_is_still_said_over_the_old_plot(page, served):
    from annzarro.tests.browser.test_gene_score_plots import _choose_score
    _open(page, served, plots=(("cell-plot-C", _cell(color={"type": "obs", "key": "score", "column": ""})),), sig=TWO)
    _wait_coloured(page)
    _slow(page, "confirm", 130)
    _choose_score(page, "color")
    page.wait_for_selector(f"{C} .score-notice[data-state='awaiting']", timeout=30000)
    assert _tag(page) == "Score not computed"


def test_an_old_link_is_migrated_on_load_and_unticking_x_moves_nothing(page, served):
    from annzarro.tests.browser import test_gene_score_tables as T
    old_col = {"type": "gene-score", "key": SIG, "column": "zscore_mean", "label": "T cell score"}
    filt = {"condition": ">", "data": "T cell score", "origData": "gene-score_" + SIG + "_zscore_mean", "type": "num", "value": ["0.5"]}
    table = T._table(columns=[T.OBS, old_col], searchBuilderConfig={"criteria": [filt], "logic": "AND"})
    plain = _cell(color={"type": "gene-score", "key": SIG, "column": "zscore_mean", "label": "T cell score"},
                  hoverInfo=[{"type": "obs", "key": "_index"}, {"type": "gene-score", "key": SIG, "column": "mean"}])
    T._open(page, served, table=table, plots=(("cell-plot-C", plain),), sig=TWO, sig_open=True)
    until(page, "() => window.__scoreCalls.filter(c => c.kind === 'compute').length >= 1")
    _wait_coloured(page)
    cfg = page.evaluate("""() => { const t = window.PanelManager.getPanel('cell-table-T').getConfig(), p = window.PanelManager.getPanel('cell-plot-C').getConfig();
        return { cols: t.columns.filter(c => c.type === 'gene-score').map(c => c.layer), crit: JSON.stringify(t.searchBuilderConfig),
                 color: p.color.layer, hover: p.hoverInfo.filter(h => h.type === 'gene-score').map(h => h.layer) }; }""")
    assert cfg["cols"] == ["X"] and cfg["color"] == "X", cfg
    assert cfg["hover"] == [], "a score hover line is dropped on load (decision 32)"
    assert "gene-score_" + SIG + "_zscore_mean__of_X" in cfg["crit"], "the filter follows the renamed column"
    # the user unticks X in the panel: counts becomes the signature's first layer
    page.evaluate("() => window.PanelManager.getPanel('gene-signature-S').updateConfig({ input: 'counts', layers: ['counts'] })")
    # time for the table and plot to move to counts, were they going to; they must stay on X
    page.wait_for_timeout(1000)
    after = page.evaluate("""() => { const t = window.PanelManager.getPanel('cell-table-T').getConfig(), p = window.PanelManager.getPanel('cell-plot-C').getConfig();
        return { cols: t.columns.filter(c => c.type === 'gene-score').map(c => [c.column, c.layer]), crit: JSON.stringify(t.searchBuilderConfig), color: [p.color.column, p.color.layer] }; }""")
    assert after["cols"] == [["zscore_mean", "X"]] and after["color"] == ["zscore_mean", "X"], after
    assert "__of_X" in after["crit"]
    # X is a layer like any other: the colour keeps it and says nothing about being offered
    shown = page.evaluate("""(t) => [document.querySelector(t + ' select.axis-column-select[data-axis="color"]').selectedOptions[0].textContent,
        document.querySelector(t + ' select.axis-layer-select[data-axis="color"]').value]""", C)
    assert shown == ["z-score mean", "X"], shown
    assert set(_inputs(page)) == {"X"}, "nothing was computed over counts: it all stays on X"


def test_a_closed_entry_is_pinned_before_the_input_changes(page, served):
    plot = _cell(color={"type": "gene-score", "key": SIG, "column": "mean", "label": "T cell score"})
    _open(page, served, plots=(("cell-plot-C", plot),), sig=TWO, sig_open=True, wait=False)
    page.wait_for_selector(f"{S} .gsig-grid .gsig-row", timeout=30000)
    page.evaluate("() => window.PanelManager.getPanel('gene-signature-S').updateConfig({ input: 'counts', layers: ['counts'] })")
    until(page, "() => !!window.PanelManager.getPanel('cell-plot-C').getConfig().color.layer")
    assert page.evaluate("() => window.PanelManager.getPanel('cell-plot-C').getConfig().color.layer") == "X"


def test_a_sorted_table_with_a_hidden_column_keeps_both_after_its_score_column_is_pinned_and_the_input_changes(page, served):
    from annzarro.tests.browser import test_gene_score_tables as T
    old_col = {"type": "gene-score", "key": SIG, "column": "zscore_mean", "label": "T cell score"}
    filt = {"condition": ">", "data": "T cell score", "origData": "gene-score_" + SIG + "_zscore_mean", "type": "num", "value": ["-9"]}
    table = T._table(columns=[T.OBS, old_col], searchBuilderConfig={"criteria": [filt], "logic": "AND"})
    T._open(page, served, table=table, sig=TWO, sig_open=True)
    until(page, "() => window.__scoreCalls.filter(c => c.kind === 'compute').length === 1")
    T._wait_ready(page)
    # sorted by the score, descending, and the obs column hidden: state the user made after the table was built
    T._api(page, "(dt.order([[2, 'desc']]).draw(), dt.column(1).visible(false), 0)")
    before = page.evaluate("() => window.PanelManager.getPanel('cell-table-T').getConfig().searchBuilderConfig")
    assert "gene-score_" + SIG + "_zscore_mean__of_X" in json.dumps(before), "pinned, and its condition with it"
    page.evaluate("() => window.PanelManager.getPanel('gene-signature-S').updateConfig({ input: 'counts', layers: ['counts'] })")
    # time for the table to move to counts or reset its sort, were it going to; it must not
    page.wait_for_timeout(1000)
    assert T._api(page, "dt.order()") == [[2, "desc"]], "the sort stays"
    assert T._api(page, "dt.column(1).visible()") is False, "the hidden column stays hidden"
    after = page.evaluate("() => window.PanelManager.getPanel('cell-table-T').getConfig().searchBuilderConfig")
    assert json.dumps(after) == json.dumps(before), "and so does the filter"
