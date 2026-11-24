"""SO-3 (decisions 31 and 32): every consumer of a gene score picks a method, then a layer, in a real browser.

The store is the grouping fixture (tests/core/grouping_store.py): X scaled and signed, ``logged`` log-normalised,
``counts`` integers, so % of total cannot be computed on X. The signature stays closed: nothing here opens a panel.

1.  Cell Plot colour moves from z-score mean · X to % of total · counts in two clicks (layer, then method), with no
    panel opened. On X, % of total is listed and disabled, with why.
2.  Under % of total the layer select lists X disabled, with the reason as its title; every method and every layer
    are listed, never a method x layer pair, and nothing says "offered".
3.  A Cell Table adds `mean · logged` through the add row, without the chooser listing pairs.
4.  The Cell Plot Hover picker lists no gene score (decision 32), and an old link that stored one loads without an
    error, drops it, and asks for no score for it.
5.  A Cell Grouping's Score factor is chosen with the same two selects.
6.  A Count Plot measure on a score has the layer select beside the method.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import base64
import json
import os
import urllib.parse

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_cell_gene_panel import served, GENES  # noqa: E402,F401
from annzarro.tests.browser import waits  # noqa: E402
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

SIG = "gene-signature-S1"
PLOT = "cell-plot-C"
TABLE = "cell-table-T"
GROUPING = "cell-grouping-G"
COUNT = "cell-count-N"
C = f'.tile[data-tile-id="{PLOT}"]'
UMAP_X = {"type": "obsm", "key": "X_umap", "column": "0"}
UMAP_Y = {"type": "obsm", "key": "X_umap", "column": "1"}
SCORE = {"type": "gene-score", "key": SIG, "label": "B cell markers", "column": "zscore_mean", "layer": "X"}
METHOD = f"{C} select.axis-column-select[data-axis='color']"
LAYER = f"{C} select.axis-layer-select[data-axis='color']"
OPTIONS = "(s) => [...document.querySelector(s).options].map(o => ({ value: o.value, text: o.textContent, disabled: o.disabled, title: o.title }))"


OPAQUE = """(el) => { for (let e = el; e; e = e.parentElement) { if (getComputedStyle(e).opacity !== '1') return false; }
    return true; }"""


def _shot(locator, name):
    """A screenshot for a review, only when ANNZARRO_SHOTS names a folder."""
    folder = os.environ.get("ANNZARRO_SHOTS")
    if folder:
        os.makedirs(folder, exist_ok=True)
        # a tab fades in: shoot once it and every box around it are fully opaque
        locator.wait_for(state="visible")
        locator.page.wait_for_function(OPAQUE, arg=locator.element_handle())
        locator.screenshot(path=os.path.join(folder, name))


def _sig():
    return {"id": SIG, "title": "B cell markers", "genes": GENES[0:6]}


def _cell(**extra):
    return {"id": PLOT, "title": "Cell Plot 1", "x": UMAP_X, "y": UMAP_Y, "z": None, "color": SCORE, "pointSize": 6, "pointOpacity": 1,
            **extra}


def _url(served, open_ids, configs):
    root, store = served
    tiles = [{"type": "tile", "id": i, "controlsVisible": True} for i in open_ids]

    def tree(nodes):
        if len(nodes) == 1:
            return nodes[0]
        return {"type": "split", "direction": "horizontal", "panes": [{"percentage": 100 // len(nodes)}, {"percentage": 100 - 100 // len(nodes)}],
                "children": [nodes[0], tree(nodes[1:])]}
    view = {"v": 1, "layout": {"v": 1, "hierarchy": [tree(tiles)], "controlState": {i: True for i in open_ids}, "panelConfigs": configs}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={enc}"


@pytest.fixture
def page(served):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1500, "height": 1000})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.scores = []
            page.on("request", lambda r: page.scores.append(json.loads(r.post_data or "{}"))
                    if "/data/gene_score" in r.url and r.method == "POST" else None)
            yield page
            assert not errors, errors
        finally:
            browser.close()


def _active(page):
    return page.evaluate("() => window.PanelManager.getActivePanels().map(p => p.getId()).sort()")


def _color(page):
    return page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig().color", PLOT)


def _coloured(page):
    until(page, """(t) => { const gd = document.querySelector(t + ' .js-plotly-plot');
        return !!(gd && gd.data && gd.data.some(d => d.marker && (Array.isArray(d.marker.color) || ArrayBuffer.isView(d.marker.color)) && d.marker.colorscale)); }""",
          C, timeout=60)


def _x_graded(page):
    """Wait until the page knows X is signed: % of total is then disabled on it."""
    until(page, "(s) => { const o = [...document.querySelector(s).options].find(o => o.value === 'fraction_of_total'); return !!o && o.disabled; }",
          METHOD, timeout=30)


def test_cell_plot_colour_on_pct_of_total_counts_in_two_clicks_with_no_panel_opened(page, served):
    page.goto(_url(served, [PLOT], {PLOT: _cell(), SIG: _sig()}))
    page.wait_for_selector(LAYER, timeout=30000)
    _coloured(page)
    before = _active(page)
    assert before == [PLOT], "the signature is closed"
    _x_graded(page)
    # on X, % of total is listed and disabled, with why
    share = next(o for o in page.evaluate(OPTIONS, METHOD) if o["value"] == "fraction_of_total")
    assert share["disabled"] and "negative values" in share["title"], share
    # click 1: the layer; click 2: the method
    page.select_option(LAYER, "counts")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().color.layer === 'counts'", PLOT)
    page.select_option(METHOD, "fraction_of_total")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().color.column === 'fraction_of_total'", PLOT)
    color = _color(page)
    assert (color["column"], color["layer"]) == ("fraction_of_total", "counts")
    assert page.locator(f"{C} .axis-pair-note").count() == 0, "nothing moved, so nothing is said"
    until(page, """(s) => [...document.querySelectorAll(s + ' .js-plotly-plot')].some(gd => (gd.data || []).some(d => d.marker && d.marker.colorbar
        && JSON.stringify(d.marker.colorbar.title || '').includes('% of total · counts')))""", C, timeout=60)
    assert any((b.get("recipe") or {}).get("method") == "fraction_of_total" and (b.get("recipe") or {}).get("input") == "counts"
               for b in page.scores), [b.get("recipe", {}).get("method") for b in page.scores]
    assert _active(page) == before, "no panel was opened"
    _shot(page.locator(f"{C} .plot-controls").first, "cell-plot-colour-method-layer.png")


def test_x_is_disabled_in_the_layer_select_under_pct_of_total_with_the_reason_as_title(page, served):
    page.goto(_url(served, [PLOT], {PLOT: _cell(color={**SCORE, "column": "fraction_of_total", "layer": "counts"}), SIG: _sig()}))
    page.wait_for_selector(LAYER, timeout=30000)
    until(page, "(s) => { const o = [...document.querySelector(s).options].find(o => o.value === 'X'); return !!o && o.disabled; }", LAYER, timeout=30)
    layers = page.evaluate(OPTIONS, LAYER)
    assert [o["value"] for o in layers] == ["X", "counts", "logged"]
    x = layers[0]
    assert x["disabled"] is True and "negative values" in x["title"], x
    assert not layers[2]["disabled"]
    methods = page.evaluate(OPTIONS, METHOD)
    assert [o["value"] for o in methods] == ["zscore_mean", "mean", "sum", "control_adjusted", "detected", "fraction_of_total"]
    assert [o["text"] for o in methods] == ["z-score mean", "mean", "sum", "control-adjusted", "fraction detected", "% of total"]
    assert all("@" not in o["value"] and "·" not in o["text"] for o in methods), "no method x layer pair"
    assert "Reads the whole matrix once." in next(o for o in methods if o["value"] == "fraction_of_total")["title"]
    text = page.evaluate("(s) => [...document.querySelector(s).closest('.axis-selector').querySelectorAll('option')].map(o => o.textContent).join('|')", LAYER)
    assert "offer" not in text.lower(), text
    page.locator(LAYER).focus()
    _shot(page.locator(f"{C} .plot-controls").first, "cell-plot-layer-select.png")


def test_a_cell_table_adds_mean_logged_without_the_chooser_listing_pairs(page, served):
    table = {"id": TABLE, "title": "Cell Table 1", "columns": [{"type": "obs", "key": "cell_type", "column": ""}]}
    page.goto(_url(served, [TABLE], {TABLE: table, SIG: _sig()}))
    page.wait_for_selector(f"#table-container-{TABLE} .dataTables_scrollBody", state="attached", timeout=30000)
    page.click(f"#gene-score-tab-{TABLE}")
    group = f"#gene-score-content-{TABLE} .az-score-group[data-entity='{SIG}']"
    page.wait_for_selector(f"{group} .az-score-add", timeout=10000)
    assert page.locator(f"{group} input.column-checkbox").count() == 0, "nothing ticked: no method x layer pair is listed"
    methods = page.evaluate("(s) => [...document.querySelector(s).options].map(o => o.value)", f"{group} .az-score-add-method")
    layers = page.evaluate("(s) => [...document.querySelector(s).options].map(o => o.value)", f"{group} .az-score-add-layer")
    assert len(methods) == 6 and layers == ["X", "counts", "logged"]
    assert page.locator(f"#gene-score-content-{TABLE} .az-score-offer-more").count() == 0
    page.select_option(f"{group} .az-score-add-method", "mean")
    page.select_option(f"{group} .az-score-add-layer", "logged")
    page.click(f"{group} .az-score-add-btn")
    box = f"#checkbox-gene-score-{SIG}-mean-of-logged-{TABLE}"
    assert page.is_checked(box)
    assert page.locator(f"{group} input.column-checkbox").count() == 1, "only the column added is listed"
    _shot(page.locator(group), "cell-table-add-row.png")
    page.click(f"#apply-columns-{TABLE}")
    until(page, "(id) => (window.PanelManager.getPanel(id).getConfig().columns || []).some(c => c.type === 'gene-score')", TABLE)
    cols = page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig().columns", TABLE)
    score = [c for c in cols if c["type"] == "gene-score"]
    assert [(c["key"], c["column"], c["layer"]) for c in score] == [(SIG, "mean", "logged")], score
    until(page, """(box) => [...document.querySelectorAll(box + ' .dataTables_scrollHead th')].some(th => /B cell markers/.test(th.textContent)
        && /logged/.test(th.textContent))""", f"#table-container-{TABLE}", timeout=60)
    assert _active(page) == [TABLE], "no panel was opened"


def test_the_cell_plot_hover_picker_lists_no_gene_score(page, served):
    page.goto(_url(served, [PLOT], {PLOT: _cell(), SIG: _sig()}))
    page.wait_for_selector(f"{C} select.hover-columns-select", state="attached", timeout=30000)
    _coloured(page)
    picker = page.evaluate("""(t) => { const s = document.querySelector(t + ' select.hover-columns-select');
        return { groups: [...s.querySelectorAll('optgroup')].map(g => g.label), values: [...s.options].map(o => o.value) }; }""", C)
    assert "Gene scores" not in picker["groups"], picker["groups"]
    assert not any(v.startswith("gene-score:") for v in picker["values"]), picker["values"]
    # a score is still a source of the plot's axes and colour
    assert "gene-score" in page.evaluate("(t) => [...document.querySelectorAll(t + ' select.axis-type-select[data-axis=\"color\"] option')].map(o => o.value)", C)


def test_an_old_link_with_a_score_hover_column_loads_without_error_and_drops_it(page, served):
    hover = [{"type": "obs", "key": "_index"}, {"type": "obs", "key": "cell_type"},
             {"type": "gene-score", "key": SIG, "column": "mean", "layer": "counts", "label": "B cell markers"}]
    page.goto(_url(served, [PLOT], {PLOT: _cell(color={"type": "obs", "key": "cell_type", "column": ""}, hoverInfo=hover), SIG: _sig()}))
    until(page, "(t) => { const gd = document.querySelector(t + ' .js-plotly-plot'); return !!(gd && gd.data && gd.data.length); }", C, timeout=60)
    info = page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig().hoverInfo", PLOT)
    assert info == hover[:2], info
    waits.expect_stays(lambda: page.scores == [] and page.locator(f"{C} .score-notice").count() == 0,
                       "a dropped hover line asks for no score and says nothing; no event marks its absence", page=page, seconds=1.5)
    # the plot's hover still lists what it kept
    assert page.evaluate("(t) => [...document.querySelector(t + ' select.hover-columns-select').selectedOptions].map(o => o.value)", C) == ["cell_type"]


def test_a_cell_grouping_score_factor_is_chosen_with_method_and_layer_selects(page, served):
    grouping = {"id": GROUPING, "title": "Grouping 1", "version": 1, "partitionings": []}
    page.goto(_url(served, [GROUPING], {GROUPING: grouping, SIG: _sig()}))
    tile = f'.tile[data-tile-id="{GROUPING}"]'
    page.wait_for_selector(f"{tile} .cgrp-add", timeout=30000)
    page.click(f"{tile} .cgrp-add")
    page.click(f"{tile} .cgrp-add-menu [data-entry='score']")
    row = f"{tile} .cgrp-addrow"
    page.wait_for_selector(f"{row} select.cgrp-addrow__method", timeout=10000)
    methods = page.evaluate("(s) => [...document.querySelector(s).options].map(o => o.value)", f"{row} select.cgrp-addrow__method")
    layers = page.evaluate("(s) => [...document.querySelector(s).options].map(o => o.value)", f"{row} select.cgrp-addrow__layer")
    assert len(methods) == 6 and layers == ["X", "counts", "logged"]
    assert page.evaluate("(s) => document.querySelector(s).value", f"{row} select.cgrp-addrow__method") == "zscore_mean"
    assert page.evaluate("(s) => document.querySelector(s).value", f"{row} select.cgrp-addrow__layer") == "X"
    page.select_option(f"{row} select.cgrp-addrow__method", "mean")
    page.select_option(f"{row} select.cgrp-addrow__layer", "logged")
    _shot(page.locator(row), "cell-grouping-score-row.png")
    page.click(f"{row} .cgrp-addrow__ok")
    until(page, "(id) => (window.PanelManager.getPanel(id).getRecipe().partitionings || []).length === 1", GROUPING)
    src = page.evaluate("(id) => window.PanelManager.getPanel(id).getRecipe().partitionings[0].source", GROUPING)
    assert (src.get("key"), src.get("column"), src.get("layer")) == (SIG, "mean", "logged"), src




def test_a_count_plot_measure_on_a_score_has_the_layer_select_beside_the_method(page, served):
    tile = f'.tile[data-tile-id="{COUNT}"]'
    count = {"id": COUNT, "title": "Count 1", "version": 1, "mode": "bar", "x": {"source": {"type": "obs", "key": "cell_type"}},
             "value": {"kind": "measure"}, "measure": {"stat": "mean", "source": {"type": "gene-score", "key": SIG, "column": "mean", "layer": "X"}}}
    page.goto(_url(served, [COUNT], {COUNT: count, SIG: _sig()}))
    row = f"{tile} [data-row='measure']"
    page.wait_for_selector(f"{row} select.axis-layer-select", timeout=30000)
    assert page.evaluate("(s) => [...document.querySelector(s).options].map(o => o.value)", f"{row} select.axis-layer-select") == ["X", "counts", "logged"]
    assert len(page.evaluate("(s) => [...document.querySelector(s).options].map(o => o.value)", f"{row} select.axis-column-select")) == 6
    page.select_option(f"{row} select.axis-layer-select", "logged")
    until(page, "(id) => { const s = window.PanelManager.getPanel(id).getConfig().measure.source; return s.layer === 'logged' && s.column === 'mean'; }", COUNT)
    _shot(page.locator(row), "count-plot-measure-row.png")
