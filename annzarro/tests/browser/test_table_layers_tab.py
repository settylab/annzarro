"""The Layers tab of the Cell Table and the Gene Table: the ticked columns and one add row (table-chooser-080.md 4).

The tab never lists the cross product. It shows the table's own layer columns grouped under their layer, then
`[item ▾] [layer ▾] Add column`: the item select lists the focused one, those fixed in plots and those the table
holds, each once; the layer select every layer. A column is stored as before, `{type, key: <layer>, column: <name>}`.

The store has six layers (X, counts, logged, scaled, spliced, unspliced), 60 cells c0 to c59 and 30 genes GENE000 to
GENE029. A table that holds two layer columns and has the focus on a third item: the old tab listed the focused item on
every layer, one checkbox each, beside the held ones. On the code before this change (run on 19f21a8e) the Layers tab
had 8 checkboxes in the Cell Table and 8 in the Gene Table (6 layers + the 2 held columns, 2 of them ticked); with
every plot-locked item and every layer it grows by a block of six per item (24 and 48 rows in the design's examples).

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import base64
import json
import os
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
GENES = [f"GENE{i:03d}" for i in range(30)]
LAYERS = ["counts", "logged", "scaled", "spliced", "unspliced"]


def _make_store(path):
    root = open_group(path)
    root.attrs.update({"encoding-type": "anndata", "encoding-version": "0.1.0"})
    x = (np.arange(N_OBS)[:, None] * 0.01 + np.arange(len(GENES))[None, :] * 0.001).astype(np.float32)
    _array(root, "X", x)
    layers = root.create_group("layers")
    for i, name in enumerate(LAYERS):
        _array(layers, name, x + i + 0.5)
    _array(root.create_group("obsm"), "X_umap", np.stack([np.arange(N_OBS), -np.arange(N_OBS)], 1).astype(np.float32))
    _dataframe(root, "obs", [f"c{i}" for i in range(N_OBS)], {"score": np.arange(N_OBS, dtype=np.float64)})
    _dataframe(root, "var", GENES, {"mean": np.arange(len(GENES), dtype=np.float64)})
    return str(path)


@pytest.fixture(scope="module")
def served(tmp_path_factory):
    original = _focus._make_store
    _focus._make_store = _make_store
    try:
        proc, root, store = _serve(tmp_path_factory, None)
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
            page = browser.new_page(viewport={"width": 1500, "height": 1000})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            yield page
            assert not errors, errors
        finally:
            browser.close()


# the two tables: the panel, its first column, what its Layers tab reads (genes in a Cell Table, cells in a Gene Table)
KINDS = {
    "cell": dict(tid="cell-table-T", first={"type": "obs", "key": "score", "column": ""}, items=["GENE001", "GENE002", "GENE003"],
                 focus="focusedGene", word="Gene"),
    "gene": dict(tid="gene-table-T", first={"type": "var", "key": "mean", "column": ""}, items=["c1", "c2", "c3"],
                 focus="focusedCell", word="Cell"),
}
BOTH = pytest.mark.parametrize("kind", ["cell", "gene"])


def _layer(key, column):
    return {"type": "layer", "key": key, "column": column}


def _open(page, served, kind, columns, focus=None):
    """A link with the table, its first column and `columns`, the focus on `focus` (the first of the kind's items)."""
    root, store = served
    k = KINDS[kind]
    cfg = {"id": k["tid"], "title": "Table 1", "columns": [k["first"], *columns]}
    view = {"v": 1, "layout": {"v": 1, "hierarchy": [{"type": "tile", "id": k["tid"], "controlsVisible": True}],
                               "controlState": {k["tid"]: True}, "panelConfigs": {k["tid"]: cfg}}}
    if focus:
        view["constants"] = {k["focus"]: focus}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    page.goto(f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={enc}")
    page.wait_for_selector(f"#table-container-{k['tid']} .dataTables_scrollBody", state="attached", timeout=30000)
    page.click(f"#layer-tab-{k['tid']}")
    page.wait_for_selector(f"#layer-content-{k['tid']}", state="visible")
    return k


def _pane(k):
    return f"#layer-content-{k['tid']}"


def _columns(page, k):
    return page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig().columns", k["tid"])


@BOTH
def test_no_cross_product(page, served, kind):
    """Two held layer columns and the focus on a third item: the tab lists the two ticked rows and one add row, not
    one checkbox per layer for the focused item (8 checkboxes on the code before this change, see the module doc)."""
    k = KINDS[kind]
    a, b, c = k["items"]
    _open(page, served, kind, [_layer("logged", a), _layer("counts", b)], focus=c)
    page.wait_for_selector(f"{_pane(k)} .az-score-add")
    boxes = page.locator(f"{_pane(k)} input.column-checkbox")
    assert boxes.count() <= 5, boxes.count()
    assert boxes.count() == 2 and page.locator(f"{_pane(k)} input.column-checkbox:checked").count() == 2
    heads = page.evaluate("(p) => [...document.querySelectorAll(p + ' .az-entity-group .az-score-group-title')].map(e => e.textContent)", _pane(k))
    layers = page.evaluate("(p) => [...document.querySelector(p + ' .az-entity-key').options].map(o => o.value)", _pane(k))
    assert sorted(layers) == sorted(["X", *LAYERS]) and layers[0] == "X", "every layer, X first"
    assert heads == [x for x in layers if x in ("counts", "logged")], "the layers that hold a column, in the dataset's order"


@BOTH
def test_add_focused_on_layer_stores_the_old_form(page, served, kind):
    """The add row starts on the focused item and X; one click on Add column, then Apply, stores {type, key, column}."""
    k = KINDS[kind]
    c = k["items"][2]
    _open(page, served, kind, [], focus=c)
    row = f"{_pane(k)} .az-score-add"
    assert page.input_value(f"{row} .az-entity-item") == c
    assert page.input_value(f"{row} .az-entity-key") == "X"
    page.select_option(f"{row} .az-entity-key", "logged")
    page.click(f"{row} .az-entity-add-btn")
    assert page.is_checked(f"#checkbox-layer-logged-{c}-{k['tid']}")
    page.click(f"#apply-columns-{k['tid']}")
    until(page, "([id, c]) => (window.PanelManager.getPanel(id).getConfig().columns || []).some(x => x.type === 'layer' && x.column === c)", [k["tid"], c])
    assert [x for x in _columns(page, k) if x["type"] == "layer"] == [{"type": "layer", "key": "logged", "column": c}]


@BOTH
def test_old_link_columns_are_ticked(page, served, kind):
    """A link made before this change: its layer columns are listed as ticked rows, X first (a placeholder column is
    pinned to a name when the panel is made, and an unpinned one is listed as such: tests/js/table-entity-choices)."""
    k = KINDS[kind]
    a, b, _ = k["items"]
    _open(page, served, kind, [_layer("logged", a), _layer("X", b)])
    assert page.is_checked(f"#checkbox-layer-logged-{a}-{k['tid']}")
    assert page.is_checked(f"#checkbox-layer-X-{b}-{k['tid']}")
    texts = page.evaluate("(p) => [...document.querySelectorAll(p + ' .form-check label')].map(l => l.textContent)", _pane(k))
    assert texts == [b, a], "X first, then the layers in the dataset's order"
    # the old form is read as it was: the same columns come back after Apply
    page.click(f"#apply-columns-{k['tid']}")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().columns.length === 3", k["tid"])
    assert sorted(x["key"] + x["column"] for x in _columns(page, k) if x["type"] == "layer") == sorted([f"logged{a}", f"X{b}"])


@BOTH
def test_item_listed_once_with_its_origin(page, served, kind):
    """An item that is focused and held on two layers is one entry of the item select, named by where it comes from."""
    k = KINDS[kind]
    a, b, _ = k["items"]
    _open(page, served, kind, [_layer("logged", a), _layer("counts", a), _layer("counts", b)], focus=a)
    options = page.evaluate("(p) => [...document.querySelector(p + ' .az-entity-item').options].map(o => o.textContent)", _pane(k))
    assert options == [f"{a} (focused)", f"{b} (in this table)"], options


@BOTH
def test_layers_tab_has_no_search_field(page, served, kind):
    """The layers tab lists ticked columns and one add row: a search field has nothing to find (the operator dropped it).
    obs and var, whose lists are long, keep theirs."""
    k = KINDS[kind]
    _open(page, served, kind, [_layer("logged", k["items"][0])], focus=k["items"][2])
    assert page.locator(f"#layer-content-{k['tid']} .column-search").count() == 0
    assert page.locator(f"#layer-content-{k['tid']} input[type=text], #layer-content-{k['tid']} input[type=search]").count() == 0


@BOTH
def test_layers_add_row_keeps_its_choice_when_the_chooser_is_rebuilt(page, served, kind):
    """The focus moving rebuilds the tab; the item and layer picked in the add row stay."""
    k = KINDS[kind]
    a, b, c = k["items"]
    _open(page, served, kind, [_layer("logged", a), _layer("counts", b)], focus=c)
    pane = _pane(k)
    page.select_option(f"{pane} .az-entity-item", b)
    page.select_option(f"{pane} .az-entity-key", "counts")
    page.evaluate("""async ([id, rows]) => { const T = await import('/static/js/panels/table-utilities/table-data.js');
        await T.refreshColumnChooser(window.PanelManager.getPanel(id).getConfig(), rows); }""", [k["tid"], "cells" if kind == "cell" else "genes"])
    kept = page.evaluate("(p) => [document.querySelector(p + ' .az-entity-item').value, document.querySelector(p + ' .az-entity-key').value]", pane)
    assert kept == [b, "counts"], kept
