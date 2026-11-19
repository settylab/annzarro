"""The Gene Signature panel in a real browser: building a gene list.

Step 3 of the gene-signature plan. A signature is a named recipe (genes plus
how to score them) that outlives its panel. This step builds the list; scoring
and the `gene-score` source come later. The store is generated: 60 cells and
3,000 genes (ACTB, CD3D, CD3E, CD3G, Cd3d, GAPDH, KLF1 and GENE0000 to
GENE2992), enough for a virtualised list and for the 2,000 gene limit.

1.  F1: a Gene Signature is added from the chooser, opens on the full gene list
    (3,000 rows in a virtualised grid), a gene is typed, Enter ticks it and the
    box keeps the focus, and the Gene Plot's own table filter selects it.
2.  F3: Add from a gene table adds the genes that pass its filter, says how
    many were already selected, and Undo takes the step back.
3.  The limit: 2,000 genes are allowed, 2,001 add nothing, and the message
    says so.
4.  The list is virtualised: a few dozen rows are in the page whatever the
    length, and the last row is reachable.
5.  Search: case, regular expression, an invalid pattern, Tick all, Enter.
6.  A Gene Plot filtered by a signature and a Gene Set Analysis reading one see
    the genes live, and still do when the signature is closed.
7.  Keyboard: the list, Space, Ctrl+Z, Escape in the box and in a menu.
8.  Link, panel set and history carry the recipe as configuration only.
9.  Close, then reopen with a new reopen call and no chooser tile in the page.
10. The administrator's switch removes the type from the menu and keeps a saved
    signature as a placeholder.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import base64
import json
import os
import time
import urllib.parse

import numpy as np
import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import test_focus_outside_subset as _focus  # noqa: E402
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402
from annzarro.tests.browser.test_names_dataset_scope import _serve  # noqa: E402
from annzarro.tests.server.test_focus_rows import _array, _dataframe  # noqa: E402
from annzarro.tests.zarr_compat import open_group  # noqa: E402

N_OBS = 60
SPECIAL = ["ACTB", "CD3D", "CD3E", "CD3G", "Cd3d", "GAPDH", "KLF1"]
GENES = SPECIAL + [f"GENE{i:04d}" for i in range(3000 - len(SPECIAL))]
SORTED = sorted(GENES)          # by code point, as the panel sorts

S = '.tile[data-tile-id="gene-signature-S"]'
P = '.tile[data-tile-id="gene-plot-P"]'
G = '.tile[data-tile-id="gene-set-G"]'
T = '.tile[data-tile-id="gene-table-T"]'
SIG = "gene-signature-S"
VAR_MEAN = {"type": "var", "key": "mean", "column": ""}


def _make_store(path):
    root = open_group(path)
    root.attrs.update({"encoding-type": "anndata", "encoding-version": "0.1.0"})
    n_var = len(GENES)
    x = (np.arange(N_OBS)[:, None] * 0.01 + np.arange(n_var)[None, :] * 0.001).astype(np.float32)
    _array(root, "X", x)
    _array(root.create_group("layers"), "counts", x + 0.5)
    _array(root.create_group("obsm"), "X_umap", np.stack([np.arange(N_OBS), -np.arange(N_OBS)], 1).astype(np.float32))
    _dataframe(root, "obs", [f"c{i}" for i in range(N_OBS)], {"score": np.arange(N_OBS, dtype=np.float64)})
    _dataframe(root, "var", GENES, {"mean": np.arange(n_var, dtype=np.float64)})
    return str(path)


@pytest.fixture(scope="module")
def served(tmp_path_factory):
    original = _focus._make_store
    _focus._make_store = _make_store
    try:
        proc, root, store = _serve(tmp_path_factory)
    finally:
        _focus._make_store = original
    yield root, store
    proc.terminate()
    proc.wait(10)


@pytest.fixture
def page(served):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1500, "height": 1100})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            yield page
            assert not errors, errors
        finally:
            browser.close()


# ------------------------------------------------------------------ helpers

def _plot_cfg(**extra):
    return {"id": "gene-plot-P", "title": "Gene Plot 1", "x": VAR_MEAN, "y": VAR_MEAN, "z": None, "color": VAR_MEAN,
            "removeNonTableEntries": True, **extra}


def _sig_cfg(genes=(), **extra):
    return {"id": SIG, "title": "T cell score", "genes": list(genes), **extra}


def _url(served, open_ids, configs):
    root, store = served
    tiles = [{"type": "tile", "id": i, "controlsVisible": True} for i in open_ids]

    def tree(nodes):
        # splits are binary: the first tile beside a split of the rest
        if len(nodes) == 1:
            return nodes[0]
        return {"type": "split", "direction": "horizontal", "panes": [{"percentage": 100 // len(nodes)}, {"percentage": 100 - 100 // len(nodes)}],
                "children": [nodes[0], tree(nodes[1:])]}
    hierarchy = [tree(tiles)]
    view = {"v": 1, "layout": {"v": 1, "hierarchy": hierarchy,
                               "controlState": {i: True for i in open_ids}, "panelConfigs": configs}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={enc}"


def _open_signature(page, served, genes=(), with_plot=False, plot_filtered=False, extra_open=(), extra_cfgs=None, **sig):
    open_ids = [SIG] + (["gene-plot-P"] if with_plot else []) + list(extra_open)
    cfgs = {SIG: _sig_cfg(genes, **sig)}
    if with_plot:
        cfgs["gene-plot-P"] = _plot_cfg(**({"tableFilter": SIG} if plot_filtered else {}))
    cfgs.update(extra_cfgs or {})
    page.goto(_url(served, open_ids, cfgs))
    page.wait_for_selector(f"{S} .gsig-grid .gsig-row", timeout=30000)
    if with_plot:
        page.wait_for_selector(f"{P} .js-plotly-plot", timeout=30000)


def _state(page):
    return page.evaluate("() => window.PanelManager.getPanel('gene-signature-S')._debugState()")


def _genes(page):
    return page.evaluate("() => window.PanelManager.getPanel('gene-signature-S').getRecipe().genes")


def _summary(page):
    return page.inner_text(f"{S} .gsig-summary")


def _message(page):
    return page.inner_text(f"{S} .gsig-message")


def _rows(page):
    return page.evaluate("""(sel) => [...document.querySelectorAll(sel + ' .gsig-row')].map(r => ({
        name: r.querySelector('.gsig-name').textContent, checked: r.querySelector('input').checked,
        index: r.getAttribute('aria-rowindex'), removed: r.classList.contains('is-removed') }))""", S)


def _row(page, name):
    return page.locator(f"{S} .gsig-row", has=page.locator(".gsig-name", has_text=name)).filter(
        has=page.locator(f"input[aria-label='{name}']"))


def _search(page, text):
    page.fill(f"{S} .gsig-search", text)
    # the search runs after a short pause
    until(page, "(t) => window.PanelManager.getPanel('gene-signature-S')._debugState().search.query === t", text)
    page.wait_for_timeout(200)


def _shown_on_plot(page):
    """The genes drawn on the Gene Plot, once the plot has settled."""
    page.wait_for_timeout(600)
    return page.evaluate("""() => {
        const gd = document.querySelector('%s .js-plotly-plot');
        if (!gd || !gd.data) return null;
        return gd.data.flatMap(t => Array.from(t.customdata || [])).map(v => Array.isArray(v) ? v[0] : v).map(String).sort();
    }""" % P)


def _add_from(page, label):
    page.click(f"{S} .gsig-addfrom")
    page.click(f".gsig-menu:not([hidden]) [role=menuitem]:has-text('{label}')")


# -------------------------------------------------------------------- tests

def test_f1_add_a_signature_type_a_gene_and_use_it(page, served):
    root, store = served
    page.goto(_url(served, ["gene-plot-P"], {"gene-plot-P": _plot_cfg()}))
    page.wait_for_selector(f"{P} .js-plotly-plot", timeout=30000)
    # the chooser: split the plot, pick Gene Signature
    page.click(f"{P} .tile-split-h")
    page.locator(".tile-selector .panel-type-option[data-type='gene-signature']").first.click()
    page.wait_for_selector('.tile[data-tile-id^="gene-signature-"] .gsig-grid .gsig-row', timeout=30000)
    sig_id = page.evaluate("() => window.PanelManager.getPanelsByType('gene-signature')[0].getId()")
    tile = f'.tile[data-tile-id="{sig_id}"]'

    # the first view: the full gene list, a default score, nothing to configure
    assert page.inner_text(f"{tile} .gsig-summary").startswith("Tick genes to build a score")
    assert "2,000" in page.inner_text(f"{tile} .gsig-summary"), "the limit is stated"
    assert "Z-score mean of X, clipped at ±10" in page.inner_text(f"{tile} .gsig-definition")
    assert page.get_attribute(f"{tile} .gsig-grid", "aria-rowcount") == "3000"
    assert page.inner_text(f"{tile} .gsig-viewswitch .active") == "All genes 3,000"
    assert page.locator(f"{tile} .gsig-usein").count() == 0, "no Use in menu: consumers choose the signature in their own source menus"
    assert page.locator(f"{tile} .gsig-clear").is_hidden()

    # type a gene, Enter: ticked, the box is cleared and keeps the focus
    page.fill(f"{tile} .gsig-search", "klf1")
    page.press(f"{tile} .gsig-search", "Enter")
    until(page, "() => window.PanelManager.getPanel('%s').getRecipe().genes.length === 1" % sig_id)
    assert page.evaluate("(id) => window.PanelManager.getPanel(id).getRecipe().genes", sig_id) == ["KLF1"]
    assert page.input_value(f"{tile} .gsig-search") == ""
    assert page.evaluate("() => document.activeElement.classList.contains('gsig-search')")
    assert page.inner_text(f"{tile} .gsig-summary") == "1 of 2,000 genes selected"
    # and a second one, in a row
    page.type(f"{tile} .gsig-search", "GENE0042")
    page.press(f"{tile} .gsig-search", "Enter")
    until(page, "(id) => window.PanelManager.getPanel(id).getRecipe().genes.length === 2", sig_id)

    # the Gene Plot's own table filter lists the signature; choosing it filters the plot
    page.select_option(f"{P} select.table-filter-select", sig_id)
    until(page, "(id) => window.PanelManager.getPanel('gene-plot-P').getConfig().tableFilter === id", sig_id)
    page.wait_for_timeout(800)
    assert _shown_on_plot(page) == ["GENE0042", "KLF1"]
    assert "Used by 1 plot" in page.inner_text(f"{tile} .gsig-usedby")


def test_f3_add_the_genes_of_a_gene_table_and_undo(page, served):
    table = {"id": "gene-table-T", "title": "DE genes", "searchText": "GENE00", "columns": [VAR_MEAN]}
    _open_signature(page, served, ["GENE0001", "GENE0002", "KLF1"], extra_open=["gene-table-T"], extra_cfgs={"gene-table-T": table})
    page.wait_for_selector(f"{T} .dataTables_scrollBody tbody tr", timeout=30000)
    until(page, "() => window.PanelManager.getPanel('gene-table-T').getConfig().currentEntries.length === 100")

    page.click(f"{S} .gsig-addfrom")
    items = page.locator(".gsig-menu:not([hidden]) [role=menuitem]").all_inner_texts()
    assert "DE genes · 100 genes" in items, items
    page.click(".gsig-menu:not([hidden]) [role=menuitem]:has-text('DE genes')")
    until(page, "() => window.PanelManager.getPanel('gene-signature-S').getRecipe().genes.length === 98 + 3")
    assert _message(page) == "Added 98 genes from DE genes. 2 were already selected."
    assert page.get_attribute(f"{S} .gsig-undo", "title") == "Undo: add 98 genes from DE genes"
    got = _genes(page)
    assert got == sorted(got) and len(got) == 101 and "KLF1" in got, "a copy: sorted, with what was there"

    # a table add is a copy: the table changing later does not change the signature
    page.fill(f'{T} input[type="search"]', "GENE001")
    page.wait_for_timeout(500)
    assert len(_genes(page)) == 101

    page.click(f"{S} .gsig-undo")
    assert _genes(page) == ["GENE0001", "GENE0002", "KLF1"]
    assert _message(page) == "Undone: add 98 genes from DE genes."
    assert page.locator(f"{S} .gsig-undo").is_disabled()


def test_focused_and_fixed_genes_are_listed_with_their_source(page, served):
    cells = {"id": "cell-plot-C", "title": "Cell Plot 2", "z": None,
             "x": {"type": "obsm", "key": "X_umap", "column": "0"}, "y": {"type": "obsm", "key": "X_umap", "column": "1"},
             "color": {"type": "layer", "key": "counts", "column": "KLF1", "locked": True}}
    page.goto(_url(served, [SIG, "cell-plot-C"], {SIG: _sig_cfg(), "cell-plot-C": cells}))
    page.wait_for_selector(f"{S} .gsig-grid .gsig-row", timeout=30000)
    page.evaluate("async () => { const { DataManager } = await import('/static/js/data-manager.js'); DataManager.setFocusedGene('GAPDH'); }")
    page.click(f"{S} .gsig-addfrom")
    items = page.locator(".gsig-menu:not([hidden]) [role=menuitem]").all_inner_texts()
    assert "GAPDH · focused" in items, items
    assert any(i.startswith("KLF1 · fixed in") for i in items), items
    page.click(".gsig-menu:not([hidden]) [role=menuitem]:has-text('GAPDH')")
    until(page, "() => window.PanelManager.getPanel('gene-signature-S').getRecipe().genes.length === 1")
    assert _genes(page) == ["GAPDH"]
    assert _message(page) == "Added GAPDH."


def test_the_limit_is_2000_and_one_more_adds_nothing(page, served):
    _open_signature(page, served)
    # 3,000 genes match: nothing is added
    page.click(f"{S} .gsig-toggle[title='Regular expression']")
    _search(page, ".")
    assert page.inner_text(f"{S} .gsig-tickall") == "Tick all 3,000"
    page.click(f"{S} .gsig-tickall")
    assert _genes(page) == []
    msg = _message(page)
    assert "A signature holds up to 2,000 genes. Nothing was added." in msg and "3,000" in msg, msg
    assert page.locator(f"{S} .gsig-undo").is_disabled(), "a refused add is not a step"

    # 1,000 + 993 + 6 = 1,999, then one more makes exactly 2,000, and one more is refused
    for pattern, expect in (("^GENE1", 1000), ("^GENE2", 1993), ("^(ACTB|CD3D|CD3E|CD3G|Cd3d|GAPDH)$", 1999), ("^KLF1$", 2000)):
        _search(page, pattern)
        page.click(f"{S} .gsig-tickall")
        until(page, "(n) => window.PanelManager.getPanel('gene-signature-S').getRecipe().genes.length === n", expect)
    assert _summary(page) == "2,000 of 2,000 genes selected"
    _search(page, "^GENE0000$")
    page.click(f"{S} .gsig-tickall")
    assert len(_genes(page)) == 2000
    assert "Nothing was added" in _message(page) and "2,001" in _message(page)
    # a single tick is refused the same way, and the box is unticked again
    _search(page, "")
    _row(page, "GENE0000").locator("input").click()
    page.wait_for_timeout(200)
    assert len(_genes(page)) == 2000
    assert not _row(page, "GENE0000").locator("input").is_checked()
    # the recipe the server reads has 2,000 genes and the route's fields
    body = page.evaluate("async () => { const m = await import('/static/js/utils/gene-signature.js'); return m.serverRecipe(window.PanelManager.getPanel('gene-signature-S').getRecipe()); }")
    assert sorted(body) == ["clip", "down", "genes", "input", "method", "seed", "version"] and len(body["genes"]) == 2000


def test_the_list_is_virtualised_and_the_last_row_is_reachable(page, served):
    _open_signature(page, served)
    s = _state(page)
    assert s["rows"] == 3000 and 0 < s["drawn"] < 60, s
    assert page.get_attribute(f"{S} .gsig-grid", "role") == "grid"
    first = _rows(page)[0]
    assert first["name"] == SORTED[0] == "ACTB" and first["index"] == "1"
    page.evaluate("(sel) => { const g = document.querySelector(sel + ' .gsig-grid'); g.scrollTop = g.scrollHeight; }", S)
    until(page, "(sel) => [...document.querySelectorAll(sel + ' .gsig-row')].some(r => r.getAttribute('aria-rowindex') === '3000')", S)
    last = _rows(page)[-1]
    assert last["name"] == SORTED[-1] and last["index"] == "3000"
    assert _state(page)["drawn"] < 60

    # the grid itself holds 300,000 rows with the same few in the page
    drawn = page.evaluate("""async () => {
        const { createGeneGrid } = await import('/static/js/utils/gene-grid.js');
        const host = document.createElement('div');
        host.style.cssText = 'height:300px;display:flex;flex-direction:column;position:fixed;left:0;top:0;width:300px;background:#fff';
        document.body.appendChild(host);
        const grid = createGeneGrid({ label: 'many', stateOf: () => ({ checked: false }), onToggle: () => {} });
        host.appendChild(grid.element);
        grid.element.style.flex = '1';
        const names = Array.from({ length: 300000 }, (_, i) => 'G' + i);
        grid.setRows(names);
        grid.element.scrollTop = 150000 * 28;
        await new Promise(r => setTimeout(r, 200));
        const out = { drawn: grid.drawnCount(), rowcount: grid.element.getAttribute('aria-rowcount') };
        host.remove();
        return out;
    }""")
    assert drawn["rowcount"] == "300000" and drawn["drawn"] < 60, drawn


def test_search_case_regex_and_tick_all(page, served):
    _open_signature(page, served)
    _search(page, "cd3")
    assert page.inner_text(f"{S} .gsig-viewswitch .active") == "All genes 4 matches"
    assert [r["name"] for r in _rows(page)] == ["CD3D", "CD3E", "CD3G", "Cd3d"]
    # Match case
    page.click(f"{S} .gsig-toggle[title='Match case']")
    until(page, "() => window.PanelManager.getPanel('gene-signature-S')._debugState().search.matchCase")
    page.wait_for_timeout(250)
    assert _rows(page) == [] and page.is_visible(f"{S} .gsig-empty")
    _search(page, "Cd3")
    assert [r["name"] for r in _rows(page)] == ["Cd3d"]
    assert page.get_attribute(f"{S} .gsig-toggle[title='Match case']", "aria-pressed") == "true"
    # regular expression; case still matters
    page.click(f"{S} .gsig-toggle[title='Regular expression']")
    _search(page, "^CD3[DE]$")
    assert [r["name"] for r in _rows(page)] == ["CD3D", "CD3E"]
    page.click(f"{S} .gsig-toggle[title='Match case']")
    page.wait_for_timeout(250)
    assert [r["name"] for r in _rows(page)] == ["CD3D", "CD3E", "Cd3d"], "case ignored again"
    page.click(f"{S} .gsig-toggle[title='Match case']")
    page.wait_for_timeout(250)
    assert page.inner_text(f"{S} .gsig-tickall") == "Tick all 2"
    # an invalid pattern says so and keeps the last results
    _search(page, "CD3(")
    assert page.inner_text(f"{S} .gsig-searchnote") == "Not a valid pattern"
    assert [r["name"] for r in _rows(page)] == ["CD3D", "CD3E"]
    _search(page, "^CD3[DE]$")
    assert page.inner_text(f"{S} .gsig-searchnote") == ""
    # Tick all: one undoable step, focus stays in the box's neighbourhood
    page.click(f"{S} .gsig-tickall")
    assert _genes(page) == ["CD3D", "CD3E"]
    assert page.get_attribute(f"{S} .gsig-undo", "title") == 'Undo: tick 2 genes matching "^CD3[DE]$"'
    assert _message(page) == 'Ticked 2 genes matching "^CD3[DE]$".'
    # Selected: only the selected genes; the view switch
    page.click(f"{S} .gsig-seg:has-text('Selected')")
    assert [r["name"] for r in _rows(page)] == ["CD3D", "CD3E"]
    _search(page, "CD3G")
    assert "CD3G is not selected" in page.inner_text(f"{S} .gsig-empty")
    page.click(f"{S} .gsig-empty button:has-text('Search all genes')")
    until(page, "() => window.PanelManager.getPanel('gene-signature-S')._debugState().view === 'all'")


def test_unticking_in_selected_strikes_the_row_through_and_keeps_it(page, served):
    _open_signature(page, served, ["CD3D", "CD3E", "KLF1"])
    # a saved signature opens on Selected
    assert _state(page)["view"] == "selected"
    assert [r["name"] for r in _rows(page)] == ["CD3D", "CD3E", "KLF1"]
    _row(page, "CD3E").locator("input").uncheck()
    until(page, "() => window.PanelManager.getPanel('gene-signature-S').getRecipe().genes.length === 2")
    rows = _rows(page)
    assert [r["name"] for r in rows] == ["CD3D", "CD3E", "KLF1"], "the rows do not jump"
    assert [r["removed"] for r in rows] == [False, True, False]
    # to the other view and back: the row is gone
    page.click(f"{S} .gsig-seg:has-text('All genes')")
    page.click(f"{S} .gsig-seg:has-text('Selected')")
    assert [r["name"] for r in _rows(page)] == ["CD3D", "KLF1"]
    # genes not in this dataset stay in the recipe, greyed and labelled
    page.evaluate("() => window.PanelManager.getPanel('gene-signature-S').updateConfig({ genes: ['CD3D', 'NOTAGENE'] })")
    page.wait_for_timeout(300)
    assert _genes(page) == ["CD3D", "NOTAGENE"]
    note = page.locator(f"{S} .gsig-row.is-missing")
    assert note.count() == 1 and "not in this dataset" in note.inner_text()
    assert "1 not in this dataset" in page.inner_text(f"{S} .gsig-definition")


def test_a_gene_plot_and_a_gene_set_panel_follow_a_signature_open_and_closed(page, served):
    gene_set = {"id": "gene-set-G", "title": "Gene Set Analysis 1", "tableFilter": SIG, "autoUpdate": False}
    _open_signature(page, served, ["GENE0001", "GENE0002", "GENE0003"], with_plot=True, plot_filtered=True,
                    extra_open=["gene-set-G"], extra_cfgs={"gene-set-G": gene_set})
    page.wait_for_selector(f"{G} .gs-controls", timeout=30000)
    until(page, "() => window.PanelManager.getPanel('gene-set-G')._debugState().source.count === 3")
    assert _shown_on_plot(page) == ["GENE0001", "GENE0002", "GENE0003"]
    src = page.evaluate("() => window.PanelManager.getPanel('gene-set-G')._debugState().source")
    assert src["status"] == "open" and src["title"] == "T cell score"

    # a tick is seen by both, live
    page.fill(f"{S} .gsig-search", "")
    page.click(f"{S} .gsig-seg:has-text('All genes')")
    _row(page, "GENE0004").locator("input").check()
    until(page, "() => window.PanelManager.getPanel('gene-set-G')._debugState().source.count === 4")
    assert _shown_on_plot(page) == ["GENE0001", "GENE0002", "GENE0003", "GENE0004"]

    # the plot's and the analysis' menus list the signature, with no "(closed)" suffix when it closes
    page.click(f"{S} .tile-close")
    page.wait_for_selector(S, state="detached")
    panel_open = page.evaluate("() => window.PanelManager.getActivePanels().some(p => p.getId() === 'gene-signature-S')")
    assert panel_open is False
    options = page.evaluate("() => [...document.querySelectorAll('%s select.table-filter-select option')].map(o => o.textContent)" % P)
    assert "T cell score" in options, options
    gs_options = page.evaluate("() => [...document.querySelectorAll('%s select option')].map(o => o.textContent)" % G)
    assert "T cell score" in gs_options and not any("(closed)" in o for o in gs_options if "T cell" in o), gs_options
    # closed, it still filters, with no computation and no waiting state
    assert _shown_on_plot(page) == ["GENE0001", "GENE0002", "GENE0003", "GENE0004"]
    assert page.locator(f"{P} .filter-notice").count() == 0
    src = page.evaluate("() => window.PanelManager.getPanel('gene-set-G')._debugState().source")
    assert src["status"] == "open" and src["count"] == 4
    assert "closed" not in page.inner_text(f"{G} .gs-bar__text").lower()


def test_a_gene_set_panel_takes_a_signature_from_its_source_menu(page, served):
    gene_set = {"id": "gene-set-G", "title": "Gene Set Analysis 1", "autoUpdate": False}
    _open_signature(page, served, ["GENE0001", "GENE0002"], extra_open=["gene-set-G"], extra_cfgs={"gene-set-G": gene_set})
    page.wait_for_selector(f"{G} .gs-controls", timeout=30000)
    page.select_option(f"{G} select[id^='gs-source-']", SIG)
    until(page, "() => window.PanelManager.getPanel('gene-set-G').getConfig().tableFilter === 'gene-signature-S'")
    until(page, "() => window.PanelManager.getPanel('gene-set-G')._debugState().source.count === 2")
    assert "Used by 1 Gene Set Analysis" in page.inner_text(f"{S} .gsig-usedby")


def test_keyboard_use(page, served):
    _open_signature(page, served)
    page.focus(f"{S} .gsig-search")
    page.type(f"{S} .gsig-search", "gene000")
    page.wait_for_timeout(300)
    # Down moves into the list, on the first row's tick
    page.press(f"{S} .gsig-search", "ArrowDown")
    assert page.evaluate("() => document.activeElement.getAttribute('aria-label')") == "GENE0000"
    page.keyboard.press("ArrowDown")
    page.keyboard.press("ArrowDown")
    assert page.evaluate("() => document.activeElement.getAttribute('aria-label')") == "GENE0002"
    page.keyboard.press("Space")
    until(page, "() => window.PanelManager.getPanel('gene-signature-S').getRecipe().genes.length === 1")
    assert _genes(page) == ["GENE0002"]
    # focus stayed on the row
    assert page.evaluate("() => document.activeElement.getAttribute('aria-label')") == "GENE0002"
    page.keyboard.press("End")
    assert page.evaluate("() => document.activeElement.getAttribute('aria-label')") == "GENE0009"
    page.keyboard.press("Home")
    assert page.evaluate("() => document.activeElement.getAttribute('aria-label')") == "GENE0000"
    page.keyboard.press("ArrowUp")
    assert page.evaluate("() => document.activeElement.getAttribute('aria-label')") == "GENE0000", "stays at the top"
    # exactly one row is in the tab order
    assert page.evaluate("(sel) => [...document.querySelectorAll(sel + ' .gsig-row input')].filter(i => i.tabIndex === 0).length", S) == 1
    # Ctrl+Z outside a text field undoes the last change; two ticks close together are one step
    page.keyboard.press("Space")
    until(page, "() => window.PanelManager.getPanel('gene-signature-S').getRecipe().genes.length === 2")
    page.keyboard.press("Control+z")
    until(page, "() => window.PanelManager.getPanel('gene-signature-S').getRecipe().genes.length === 0")
    assert _message(page) == "Undone: change 2 genes."
    # Escape in the box clears it
    page.focus(f"{S} .gsig-search")
    page.keyboard.press("Escape")
    assert page.input_value(f"{S} .gsig-search") == ""
    # a menu opens on the keyboard, moves with the arrows and closes with Escape back on its button
    page.focus(f"{S} .gsig-addfrom")
    page.keyboard.press("Enter")
    assert page.get_attribute(f"{S} .gsig-addfrom", "aria-expanded") == "true"
    page.keyboard.press("Escape")
    assert page.get_attribute(f"{S} .gsig-addfrom", "aria-expanded") == "false"
    assert page.evaluate("() => document.activeElement.classList.contains('gsig-addfrom')")
    # the buttons are named, and the view switch is a radio group
    assert page.get_attribute(f"{S} .gsig-viewswitch", "role") == "radiogroup"
    assert page.get_attribute(f"{S} .gsig-toggle[title='Match case']", "aria-pressed") == "false"
    assert page.get_attribute(f"{S} .gsig-search", "aria-label") == "Search genes"
    assert page.get_attribute(f"{S} .gsig-message", "role") == "status"


# ----------------------------------------------------- link, set and history

def _captured_url(page, root, store):
    payload = page.evaluate("""async () => {
        const { encodeViewPayload } = await import('/static/js/utils/deeplink.js');
        return await encodeViewPayload(window.sessionManager.captureView());
    }""")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={payload}"


def test_link_round_trip_carries_the_recipe_and_nothing_computed(page, served):
    root, store = served
    _open_signature(page, served, ["GENE0001", "GENE0002", "KLF1"], with_plot=True, plot_filtered=True, clip=4)
    view = page.evaluate("() => window.sessionManager.captureView()")
    cfg = view["layout"]["panelConfigs"][SIG]
    assert cfg["genes"] == ["GENE0001", "GENE0002", "KLF1"] and cfg["clip"] == 4 and cfg["method"] == "zscore_mean"
    assert cfg["version"] == 1 and cfg["down"] == [] and cfg["input"] == "X" and cfg["seed"] is None
    assert "currentEntries" not in cfg and "closedSelection" not in cfg, sorted(cfg)
    assert set(cfg) <= {"id", "title", "genes", "down", "input", "method", "clip", "seed", "version", "controlsVisible"}
    recipe_hash = page.evaluate("() => window.PanelManager.getPanel('gene-signature-S').getRecipeHash()")

    # the plot's filter was saved by id; closed, the signature goes into the link too
    page.evaluate("() => window.PanelManager.closePanel('gene-signature-S')")
    page.wait_for_timeout(300)
    link = _captured_url(page, root, store)
    page.goto("about:blank")
    page.goto(link)
    page.wait_for_selector(f"{P} .js-plotly-plot", timeout=30000)
    panels = page.evaluate("""() => { const open = new Set(window.PanelManager.getActivePanels().map(p => p.getId()));
        return Object.fromEntries(window.PanelManager.getAllPanels().map(p => [p.getId(), { type: p.getType(), open: open.has(p.getId()), title: p.getTitle() }])); }""")
    assert panels[SIG] == {"type": "gene-signature", "open": False, "title": "T cell score"}
    assert page.evaluate("() => window.PanelManager.getPanel('gene-signature-S').getRecipeHash()") == recipe_hash
    assert page.evaluate("() => window.PanelManager.getPanel('gene-signature-S').getRecipe().clip") == 4
    # the plot kept its filter (it was not reset to None) and shows the three genes, computed from the recipe alone
    assert page.evaluate("() => document.querySelector('%s select.table-filter-select').value" % P) == SIG
    assert _shown_on_plot(page) == ["GENE0001", "GENE0002", "KLF1"]
    assert page.locator(f"{P} .filter-notice").count() == 0
    # and it is in the chooser's closed list, with its name
    closed = page.evaluate("() => [...document.querySelectorAll('.source-panel-option.closed-panel')].map(e => e.dataset.id)")
    assert SIG in closed


def test_panel_set_round_trip(page, served):
    root, store = served
    _open_signature(page, served, ["GENE0001", "KLF1"], with_plot=True, plot_filtered=True)
    # open in the set, and then closed in the set
    for close in (False, True):
        if close:
            page.evaluate("() => window.PanelManager.closePanel('gene-signature-S')")
            page.wait_for_timeout(300)
        name = f"signature-set-{int(time.time())}-{close}"
        saved = page.evaluate("(n) => window.sessionManager.saveSession(n)", name)
        assert saved["status"] == "success", saved
        page.goto(root)
        page.wait_for_function("() => window.sessionManager && window.PanelManager")
        loaded = page.evaluate("(n) => window.sessionManager.loadSession(n)", name)
        assert loaded["status"] == "success", loaded
        page.wait_for_selector(f"{P} .js-plotly-plot", timeout=30000)
        assert page.evaluate("() => window.PanelManager.getPanel('gene-signature-S').getRecipe().genes") == ["GENE0001", "KLF1"]
        assert page.evaluate("() => window.PanelManager.getActivePanels().some(p => p.getId() === 'gene-signature-S')") is (not close)
        assert page.evaluate("() => document.querySelector('%s select.table-filter-select').value" % P) == SIG
        assert _shown_on_plot(page) == ["GENE0001", "KLF1"]
        if not close:
            page.wait_for_selector(f"{S} .gsig-grid .gsig-row")


def test_back_and_forward_restore_the_genes(page, served):
    _open_signature(page, served, ["GENE0001"], with_plot=True, plot_filtered=True)
    page.wait_for_timeout(2500)
    before = page.evaluate("() => history.length")
    page.fill(f"{S} .gsig-search", "")
    page.click(f"{S} .gsig-seg:has-text('All genes')")
    _row(page, "GENE0002").locator("input").check()
    until(page, "() => window.PanelManager.getPanel('gene-signature-S').getRecipe().genes.length === 2")
    page.wait_for_timeout(2500)
    assert page.evaluate("() => history.length") == before + 1
    page.go_back()
    until(page, "() => JSON.stringify(window.PanelManager.getPanel('gene-signature-S')?.getRecipe().genes) === '[\"GENE0001\"]'")
    assert _shown_on_plot(page) == ["GENE0001"]
    page.go_forward()
    until(page, "() => JSON.stringify(window.PanelManager.getPanel('gene-signature-S')?.getRecipe().genes) === '[\"GENE0001\",\"GENE0002\"]'")
    assert _shown_on_plot(page) == ["GENE0001", "GENE0002"]


# ---------------------------------------------------------- close and reopen

def test_close_then_reopen_with_the_reopen_call_and_no_chooser_tile(page, served):
    _open_signature(page, served, ["GENE0001", "KLF1"], with_plot=True, plot_filtered=True)
    page.click(f"{S} .tile-close")
    page.wait_for_selector(S, state="detached")
    # no chooser tile for the closed panel is needed: remove every chooser from the page
    page.evaluate("() => document.querySelectorAll('.tile-selector').forEach(e => e.remove())")
    assert page.locator('.panel-closed-btn[data-id="gene-signature-S"]').count() == 0
    opened = page.evaluate("""() => { const p = window.PanelManager.reopenClosedPanel('gene-signature-S', { nextTo: 'gene-plot-P' });
        return p ? p.getId() : null; }""")
    assert opened == SIG
    page.wait_for_selector(f"{S} .gsig-grid .gsig-row", timeout=30000)
    assert _genes(page) == ["GENE0001", "KLF1"]
    assert page.evaluate("() => window.PanelManager.getPanel('gene-signature-S').getTitle()") == "T cell score"
    # same id: the plot's filter still means it, and the tile sits beside the plot
    assert page.evaluate("() => document.querySelector('%s select.table-filter-select').value" % P) == SIG
    assert page.evaluate("() => !!document.querySelector('%s').closest('.split-container')" % S)
    assert _shown_on_plot(page) == ["GENE0001", "KLF1"]
    # opened, it starts on Selected; a panel that is open cannot be reopened
    assert _state(page)["view"] == "selected"
    assert page.evaluate("() => window.PanelManager.reopenClosedPanel('gene-signature-S')") is None
    assert page.evaluate("() => window.PanelManager.reopenClosedPanel('no-such-panel-1')") is None
    # the chooser's own Reopen still works for a signature
    page.click(f"{S} .tile-close")
    page.wait_for_selector(S, state="detached")
    page.click(f"{P} .tile-split-h")
    page.wait_for_selector(".tile-selector .source-panel-option.closed-panel")
    assert page.evaluate("() => [...document.querySelectorAll('.tile-selector .source-panel-option.closed-panel')].map(e => e.dataset.id)") == [SIG]
    page.click(f'.tile-selector .panel-closed-btn[data-id="{SIG}"]')
    page.wait_for_selector(f"{S} .gsig-grid .gsig-row", timeout=30000)
    assert _genes(page) == ["GENE0001", "KLF1"]


# ------------------------------------------------------------- the policy

def test_the_administrator_can_switch_the_panel_off(page, served):
    stub = {"version": "v1", "values": {"panel.gene-signature.enabled": False}}
    page.route("**/api/v1/policy/effective*", lambda route: route.fulfill(
        status=200, body=json.dumps(stub), headers={"Content-Type": "application/json", "X-AnnZarro-Policy": "v1"}))
    root, store = served
    page.goto(_url(served, ["gene-plot-P"], {"gene-plot-P": _plot_cfg(), SIG: _sig_cfg(["KLF1"])}))
    page.wait_for_selector(f"{P} .js-plotly-plot", timeout=30000)
    # not in the panel menu
    page.click(f"{P} .tile-split-h")
    page.wait_for_selector(".tile-selector .panel-type-option")
    types = page.locator(".tile-selector .panel-type-option").evaluate_all("els => els.map(e => e.dataset.type)")
    assert "gene-signature" not in types and "gene-set" in types, types
    # a saved one is kept: the stand-in holds the settings
    page.goto("about:blank")
    page.goto(_url(served, [SIG], {SIG: _sig_cfg(["KLF1"], futureField=[1, 2])}))
    until(page, "() => !!document.querySelector('.panel-no-data[data-disabled-by-policy]')")
    saved = page.evaluate("() => window.PanelManager.saveLayout().panelConfigs['gene-signature-S']")
    assert saved["genes"] == ["KLF1"] and saved["futureField"] == [1, 2]
    assert page.locator(".gsig-grid").count() == 0


def test_the_menu_offers_the_panel_when_nothing_is_switched_off(page, served):
    root, store = served
    page.goto(f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}")
    page.wait_for_selector(".panel-type-option[data-type='gene-signature']", timeout=30000)
    types = page.locator(".panel-type-option").evaluate_all("els => els.map(e => e.dataset.type)")
    assert types[-1] == "gene-signature" and "gene-set" in types


def test_a_new_dataset_keeps_the_recipe_and_recounts_the_missing_genes(page, served):
    _open_signature(page, served, ["ACTB", "CD3D", "KLF1"])
    assert "not in this dataset" not in page.inner_text(f"{S} .gsig-definition")
    # the dataset's genes change (a switch to another store): the recipe is untouched, the count is new
    page.evaluate("""async () => {
        const { DataManager } = await import('/static/js/data-manager.js');
        DataManager.getGenes = () => ['ACTB', 'GAPDH', 'OTHER1'];
        await window.PanelManager.notifyPanels('datasetChanged', { dataset: 'x' });
    }""")
    until(page, "() => /2 not in this dataset/.test(document.querySelector('%s .gsig-definition').textContent)" % S)
    assert _genes(page) == ["ACTB", "CD3D", "KLF1"]
    # Selected lists the recipe, the two absent genes greyed; All genes lists only the new dataset's
    assert page.locator(f"{S} .gsig-row.is-missing").count() == 2
    page.click(f"{S} .gsig-seg:has-text('All genes')")
    assert page.get_attribute(f"{S} .gsig-grid", "aria-rowcount") == "3"
    assert page.locator(f"{S} .gsig-row.is-missing").count() == 0


POPOVER_BOX = """() => {
    const m = [...document.querySelectorAll('.gsig-menu')].find(e => !e.hidden);
    if (!m) return null;
    const r = m.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const corners = [[r.left + 1, r.top + 1], [r.right - 2, r.top + 1], [r.left + 1, r.bottom - 2], [r.right - 2, r.bottom - 2]]
        .map(([x, y]) => { const e = document.elementFromPoint(x, y); return !!e && m.contains(e); });
    return { inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, topmost: !!hit && m.contains(hit),
             corners, w: r.width, h: r.height, inBody: m.parentElement === document.body };
}"""


def test_add_from_popover_is_fully_visible_and_topmost_beside_a_plot(page, served):
    _open_signature(page, served, [], with_plot=True)
    page.click(f"{S} .gsig-addfrom")
    box = page.evaluate(POPOVER_BOX)
    assert box and box["w"] > 20 and box["h"] > 10, box
    assert box["inside"] and box["topmost"] and all(box["corners"]) and box["inBody"], box
    # Esc closes it and the focus returns to the button
    page.keyboard.press("Escape")
    assert page.evaluate(POPOVER_BOX) is None
    assert page.evaluate("() => document.activeElement.classList.contains('gsig-addfrom')")
    # an outside click closes it
    page.click(f"{S} .gsig-addfrom")
    assert page.evaluate(POPOVER_BOX)
    page.click(f"{P} .tile-title")
    assert page.evaluate(POPOVER_BOX) is None
    # a narrow window: the popover slides back into the viewport
    page.set_viewport_size({"width": 420, "height": 700})
    page.click(f"{S} .gsig-addfrom")
    box = page.evaluate(POPOVER_BOX)
    assert box and box["inside"] and box["topmost"], box


def test_the_focused_gene_is_one_click_away(page, served):
    _open_signature(page, served, ["KLF1"])
    btn = f"{S} .gsig-focused"
    page.evaluate("async () => { const { DataManager } = await import('/static/js/data-manager.js'); DataManager.setFocusedGene('GAPDH'); }")
    until(page, "(b) => { const e = document.querySelector(b); return e && !e.hidden && e.textContent === '+ GAPDH (focused)'; }", btn)
    assert not page.locator(btn).is_disabled()
    page.click(btn)
    until(page, "() => window.PanelManager.getPanel('gene-signature-S').getRecipe().genes.length === 2")
    assert _genes(page) == ["GAPDH", "KLF1"]
    assert _message(page) == "Added GAPDH."
    # already in the list: disabled, with the reason
    assert page.locator(btn).is_disabled() and "already in the list" in page.get_attribute(btn, "title")
    # one undo step; the button comes back
    page.click(f"{S} .gsig-undo")
    assert _genes(page) == ["KLF1"]
    assert not page.locator(btn).is_disabled()
    # follows the focus
    page.evaluate("async () => { const { DataManager } = await import('/static/js/data-manager.js'); DataManager.setFocusedGene('CD3D'); }")
    until(page, "(b) => document.querySelector(b).textContent === '+ CD3D (focused)'", btn)
    # a focused gene absent from the dataset cannot be added
    page.evaluate("async () => { const { DataManager } = await import('/static/js/data-manager.js'); DataManager.setFocusedGene('NOT_A_GENE'); }")
    until(page, "(b) => document.querySelector(b).textContent === '+ NOT_A_GENE (focused)'", btn)
    assert page.locator(btn).is_disabled() and "not in this dataset" in page.get_attribute(btn, "title")
