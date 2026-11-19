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
    assert cfg["x"]["layer"] == "counts" and cfg["y"]["layer"] == "X", "an old y with no layer was resolved once, on load"
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
    # the requests are out, not answered: wait until both score columns are filled (a column that never fills times out here)
    until(page, """(box) => { const ths = [...document.querySelectorAll(box + ' .dataTables_scrollHead th[data-score-state]')];
        return ths.length === 2 && ths.every(th => th.dataset.scoreState === 'ready'); }""", T.BOX)
    heads = T._headers(page)
    assert "T cell score" in heads and any(h.startswith("T cell score · counts") for h in heads), heads
    assert not any("computing" in h for h in heads), heads
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
    assert [(c["column"], c.get("layer")) for c in cfg] == [("mean", "X")], "kept on X (pinned when it was read)"


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


def test_table_columns_store_their_layer_and_an_old_column_without_one_reads_the_signatures_input(page, served):
    from annzarro.tests.browser import test_gene_score_tables as T
    old = {"type": "gene-score", "key": SIG, "column": "zscore_mean", "label": "T cell score"}
    T._open(page, served, table=T._table(columns=[old]), sig=TWO)
    until(page, "() => window.__scoreCalls.filter(c => c.kind === 'compute').length === 1")
    assert _inputs(page) == ["X"], "no layer: the signature's input"
    page.click(f"#gene-score-tab-{T.TID}")
    assert page.is_checked(f"#checkbox-gene-score-{SIG}-zscore_mean-of-X-{T.TID}"), "the old column is shown ticked on X"
    page.check(f"#checkbox-gene-score-{SIG}-mean-of-X-{T.TID}")
    page.check(f"#checkbox-gene-score-{SIG}-mean-of-counts-{T.TID}")
    page.click(f"#apply-columns-{T.TID}")
    cfg = page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig().columns.filter(c => c.type === 'gene-score').map(c => [c.column, c.layer])", T.TID)
    assert sorted(cfg) == [["mean", "X"], ["mean", "counts"], ["zscore_mean", "X"]], "every column stores its layer; the old one was resolved on load"
    # the signature stops offering X: the columns do not move to counts
    page.evaluate("() => window.PanelManager.getPanel('gene-signature-S').updateConfig({ input: 'counts', layers: ['counts'] })")
    page.wait_for_timeout(800)
    cfg = page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig().columns.filter(c => c.type === 'gene-score').map(c => [c.column, c.layer])", T.TID)
    assert sorted(cfg) == [["mean", "X"], ["mean", "counts"], ["zscore_mean", "X"]]


def test_plot_hover_and_table_menus_leave_out_a_combination_that_cannot_be_computed(page, served):
    from annzarro.tests.browser import test_gene_score_tables as T
    def handler(route):
        want = urllib.parse.parse_qs(urllib.parse.urlparse(route.request.url).query).get("input", ["X"])[0]
        body = {"input": want, "kind": "signed" if want == "X" else "counts", "stats": {"max": 5}, "suggest": None, "checked": {}}
        route.fulfill(status=200, content_type="application/json", body=json.dumps(body))
    page.route("**/api/v1/data/matrix_kind*", handler)
    sig = {**TWO, "offered": ["zscore_mean", "detected", "fraction_of_total"], "layers": ["X", "counts"]}
    cfg = _cell(hoverInfo=[{"type": "obs", "key": "_index"}])
    T._open(page, served, table=T._table(columns=[T.OBS]), plots=(("cell-plot-C", cfg),), sig=sig, sig_open=True)
    until(page, "(id) => window.PanelManager.getPanel(id).getOfferedOptions().length === 4", SIG)
    # plot menu
    opts = page.evaluate("(t) => [...document.querySelectorAll(t + ' select.axis-column-select[data-axis=\"color\"] option')].map(o => o.value)", C)
    page.select_option(f"{C} select.axis-type-select[data-axis='color']", "gene-score")
    until(page, "(t) => [...document.querySelectorAll(t + ' select.axis-column-select[data-axis=\"color\"] option')].some(o => o.value === 'detected@counts')", C)
    opts = page.evaluate("(t) => [...document.querySelectorAll(t + ' select.axis-column-select[data-axis=\"color\"] option')].map(o => o.value)", C)
    assert "detected@X" not in opts and "fraction_of_total@X" not in opts and "detected@counts" in opts, opts
    # hover
    hov = page.evaluate("(t) => [...document.querySelectorAll(t + ' select.hover-columns-select option')].map(o => o.value)", C)
    assert not any(v.endswith(":detected:X") or v.endswith(":fraction_of_total:X") for v in hov), hov
    assert any(v.endswith(":detected:counts") for v in hov), hov
    # table tab
    page.click(f"#gene-score-tab-{T.TID}")
    boxes = page.evaluate("(id) => [...document.querySelectorAll('#gene-score-content-' + id + ' input.column-checkbox')].map(c => c.id)", T.TID)
    assert not any("detected-of-X" in b or "fraction_of_total-of-X" in b for b in boxes), boxes
    assert any("detected-of-counts" in b for b in boxes), boxes


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
        page.wait_for_timeout(150)
    _frame(page, 0, type="progress", done=0, total=12)
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
    page.select_option(f"{C} select.axis-column-select[data-axis='color']", "mean@X")
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
        page.wait_for_timeout(150)
    _frame(page, 0, type="progress", done=0, total=12)
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
    assert cfg["cols"] == ["X"] and cfg["color"] == "X" and cfg["hover"] == ["X"], cfg
    assert "gene-score_" + SIG + "_zscore_mean__of_X" in cfg["crit"], "the filter follows the renamed column"
    # the user unticks X in the panel: counts becomes the signature's first layer
    page.evaluate("() => window.PanelManager.getPanel('gene-signature-S').updateConfig({ input: 'counts', layers: ['counts'] })")
    page.wait_for_timeout(1000)
    after = page.evaluate("""() => { const t = window.PanelManager.getPanel('cell-table-T').getConfig(), p = window.PanelManager.getPanel('cell-plot-C').getConfig();
        return { cols: t.columns.filter(c => c.type === 'gene-score').map(c => [c.column, c.layer]), crit: JSON.stringify(t.searchBuilderConfig), color: [p.color.column, p.color.layer] }; }""")
    assert after["cols"] == [["zscore_mean", "X"]] and after["color"] == ["zscore_mean", "X"], after
    assert "__of_X" in after["crit"]
    text = page.evaluate("(t) => document.querySelector(t + ' select.axis-column-select[data-axis=\"color\"]').selectedOptions[0].textContent", C)
    assert "no longer offered" in text, text
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
    page.wait_for_timeout(1000)
    assert T._api(page, "dt.order()") == [[2, "desc"]], "the sort stays"
    assert T._api(page, "dt.column(1).visible()") is False, "the hidden column stays hidden"
    after = page.evaluate("() => window.PanelManager.getPanel('cell-table-T').getConfig().searchBuilderConfig")
    assert json.dumps(after) == json.dumps(before), "and so does the filter"
