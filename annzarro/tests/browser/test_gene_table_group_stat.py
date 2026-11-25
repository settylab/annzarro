"""A group's statistic as a column of a Gene Table (T2 of table-chooser-080), in a real browser against the real
cell_groups route (`shape: "genes"`).

The "Cell groupings" tab lists every grouping, open or closed, by its title; under it the table's columns of that
grouping, then one add row `[group] [layer] [aggregation] [Add column]`. A column is the Gene Plot's own setting, one number
per gene, filled in place when the moments arrive. Columns of one group and layer share one request.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import json
import os

import numpy as np
import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import waits  # noqa: E402
from annzarro.tests.browser.test_cell_gene_panel import DATA, GENES, _url, page, served  # noqa: E402,F401
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

TID, GA, GB = "gene-table-T", "cell-grouping-A", "cell-grouping-B"
T = f'.tile[data-tile-id="{TID}"]'
BOX = f"#table-container-{TID}"
TAB = f"#group-stat-tab-{TID}"
PANE = f"#group-stat-content-{TID}"
CELL_TYPE = {"source": {"type": "obs", "key": "cell_type"}}
CONDITION = {"source": {"type": "obs", "key": "condition"}}
B_KEY = json.dumps(["c:B cell"], separators=(",", ":"))
B = (DATA.obs["cell_type"] == "B cell").to_numpy()
AGG = "[data-popover='aggregation']"


def _grouping(pid=GA, title="Cell types", parts=(CELL_TYPE,)):
    return {"id": pid, "title": title, "version": 1, "partitionings": list(parts)}


def _table(columns=(), **extra):
    return {"id": TID, "title": "Gene Table 1", "columns": list(columns), **extra}


def _column(stat="mean", layer="logged", group_key=B_KEY, grouping=GA, was=("B cell",)):
    return {"type": "group-stat", "key": grouping, "column": group_key, "stat": stat, "layer": layer, "groupWas": list(was),
            "label": "Cell types"}


def _open(page, served, columns=(), groupings=None, open_ids=None, **extra):
    groupings = groupings if groupings is not None else {GA: _grouping()}
    configs = {TID: _table(columns, pageLength=100, **extra), **groupings}
    page.goto(_url(served, open_ids if open_ids is not None else [TID], configs))
    page.wait_for_selector(f"{BOX} .dataTables_scrollBody", state="attached", timeout=30000)


def _genes(page):
    return [c for c in page.calls if c.get("shape") == "genes"]


def _headers(page):
    return page.evaluate("""(box) => [...document.querySelectorAll(box + ' .dataTables_scrollHead th')].map(th => th.textContent.replace(/\\s+/g, ' ').trim())""", BOX)


def _values(page, index):
    return page.evaluate("""([box, i]) => [...document.querySelectorAll(box + ' .dataTables_scrollBody tbody tr')]
        .map(tr => (tr.children[i] || {}).textContent).map(t => (t || '').trim())""", [BOX, index])


def _group_group(entity=GA):
    return f"{PANE} .az-score-group[data-entity='{entity}']"


def _open_tab(page, entity=GA):
    page.click(TAB)
    page.wait_for_selector(f"{_group_group(entity)} .az-score-add-btn", timeout=30000)
    until(page, "(s) => [...document.querySelector(s).options].some(o => o.value)", f"{_group_group(entity)} .az-score-add-group", timeout=30)
    until(page, "(s) => [...document.querySelector(s).options].some(o => o.value === 'logged')", f"{_group_group(entity)} .az-score-add-layer", timeout=30)


def _pick_agg(page, entity, stat):
    page.click(f"{_group_group(entity)} .az-score-add-agg")
    page.locator(AGG).wait_for(state="visible")
    page.click(f"{AGG} [data-agg='{stat}']")


def _agg_entries(page, entity=GA):
    page.click(f"{_group_group(entity)} .az-score-add-agg")
    page.locator(AGG).wait_for(state="visible")
    rows = page.evaluate("""() => [...document.querySelectorAll("[data-popover='aggregation'] [data-agg]")].map(r => ({ v: r.dataset.agg,
        off: r.disabled, title: r.title, name: r.querySelector('.axis-agg-name').textContent }))""")
    page.keyboard.press("Escape")
    page.locator(AGG).wait_for(state="hidden")
    return rows


def _add(page, stat="mean", layer="logged", entity=GA, group=None):
    """Choose the group, layer and statistic in the add row and press Add column."""
    g = _group_group(entity)
    if group is not None:
        page.select_option(f"{g} .az-score-add-group", group)
    page.select_option(f"{g} .az-score-add-layer", layer)
    _pick_agg(page, entity, stat)
    page.click(f"{g} .az-score-add-btn")


def _apply(page):
    page.click(f"#apply-columns-{TID}")


def _gene_names(page):
    return _values(page, 0)


def _zmeans():
    x = DATA.logged.astype(np.float64)
    sd = x.std(axis=0)
    z = np.clip((x - x.mean(axis=0)) / np.where(sd > 0, sd, 1), -10, 10)
    return z[B].mean(axis=0)


def _numbers(stat, layer="logged", threshold=0.0):
    x = DATA.layer(layer)[B].astype(np.float64)
    above = x > threshold
    return {"mean": x.mean(axis=0), "sum": x.sum(axis=0), "sd": x.std(axis=0), "fraction_of_cells": above.mean(axis=0)}[stat]


def _wait_column(page, header_part):
    """The column is there and every column of the table is filled (none is computing)."""
    until(page, """([box, part]) => { const h = [...document.querySelectorAll(box + ' .dataTables_scrollHead th')].map(th => th.textContent);
        return h.some(t => t.includes(part)) && !h.some(t => t.includes('(computing)')); }""", [BOX, header_part], timeout=60)


def _column_values(page, header_part):
    heads = _headers(page)
    i = next(k for k, h in enumerate(heads) if header_part in h)
    names, vals = _gene_names(page), _values(page, i)
    return dict(zip(names, vals))


# ------------------------------------------------------------------ the tab

def test_tab_lists_groupings_open_and_closed_by_title(page, served):
    _open(page, served, groupings={GA: _grouping(), GB: _grouping(GB, "Condition", [CONDITION])})
    labels = page.evaluate("(t) => [...document.querySelectorAll(t + ' .nav-tabs .nav-link')].map(b => b.textContent.trim())", T)
    assert labels == ["var", "varm", "varp", "layers", "Cell groupings"], labels
    page.click(TAB)
    page.wait_for_selector(f"{PANE} .az-score-group", timeout=30000)
    titles = page.eval_on_selector_all(f"{PANE} .az-score-group-title", "els => els.map(e => e.textContent)")
    assert titles == ["Cell types", "Condition"], "both groupings are closed (only the table is open), listed by title"
    assert page.locator(f"{PANE} .column-search").count() == 0, "no search field on this tab"


def test_add_row_is_group_layer_aggregation_then_add(page, served):
    _open(page, served)
    _open_tab(page)
    g = _group_group()
    order = page.evaluate("(g) => [...document.querySelector(g + ' .az-score-add').children].map(e => e.className.split(' ').filter(c => c.startsWith('az-score-add-'))[0])", g)
    assert order == ["az-score-add-group", "az-score-add-layer", "az-score-add-agg", "az-score-add-btn"], order
    groups = page.eval_on_selector_all(f"{g} .az-score-add-group option", "os => os.map(o => [o.value, o.textContent, o.disabled])")
    assert groups[1] == [B_KEY, "B cell", False] and len(groups) == 7, groups
    names = [e["name"] for e in _agg_entries(page)]
    assert names == ["Z-score mean", "Mean", "Fraction of cells", "Mean of expressing cells", "Sum", "SD"]


# ------------------------------------------------------------------ the values

def test_add_column_values_equal_gene_plot_color(page, served):
    """The same group, statistic and layer as the Gene Plot's colour: the same number per gene (the test of the Gene Plot
    computes it by NumPy from the dataset)."""
    _open(page, served)
    _open_tab(page)
    _add(page, "mean", "logged")
    _apply(page)
    _wait_column(page, "B cell: mean")
    got = _column_values(page, "B cell: mean")
    want = dict(zip(GENES, _numbers("mean")))
    assert len(got) == len(GENES)
    for gene, v in want.items():
        assert float(got[gene]) == pytest.approx(v, rel=1e-3, abs=1e-4), gene
    assert len(_genes(page)) == 1 and _genes(page)[0]["group"] == ["c:B cell"] and _genes(page)[0]["layer"] == "logged"


def test_second_statistic_sends_no_request(page, served):
    """A second statistic of the same group and layer reads the moments already held; z-score mean is a request of its
    own (the server z-scores each gene over all cells), by design."""
    _open(page, served, columns=[_column("mean")])
    _wait_column(page, "B cell: mean")
    assert len(_genes(page)) == 1
    _open_tab(page)
    _add(page, "sum", "logged")
    _apply(page)
    _wait_column(page, "B cell: sum")
    assert len(_genes(page)) == 1, "sum reads the held moments"
    _add(page, "fraction_of_cells", "logged")
    _apply(page)
    _wait_column(page, "B cell: fraction of cells")
    assert len(_genes(page)) == 1
    _add(page, "zscore_mean", "logged")
    _apply(page)
    _wait_column(page, "B cell: z-score mean")
    z = [c for c in _genes(page) if c.get("transform") == "zscore"]
    assert len(_genes(page)) == 2 and len(z) == 1, "z-score mean: one request of its own"
    got = _column_values(page, "B cell: z-score mean")
    for gene, v in zip(GENES, _zmeans()):
        if got[gene] != "N/A":                                   # a gene with no spread has no z-score
            assert float(got[gene]) == pytest.approx(v, rel=1e-3, abs=1e-4), gene
    assert got[GENES[3]] == "N/A", "GENE003 is zero in every cell: no z-score"


def test_column_names(page, served):
    _open(page, served, columns=[_column("mean"), _column("fraction_of_cells", "counts")])
    _wait_column(page, "B cell: fraction of cells")
    heads = _headers(page)
    assert "B cell: mean · logged" in heads and "B cell: fraction of cells · counts" in heads, heads
    exported = page.evaluate("(box) => [...document.querySelectorAll(box + ' .dataTables_scrollHead th')].map(th => th.dataset.exportTitle || '')", BOX)
    assert "Cell types › B cell: mean · logged" in exported, exported
    _open_tab(page)
    rows = page.eval_on_selector_all(f"{_group_group()} .form-check label", "ls => ls.map(l => l.textContent)")
    assert rows == ["B cell: mean · logged", "B cell: fraction of cells · counts"], rows


def test_sorting_by_the_column_keeps_values_with_their_genes(page, served):
    _open(page, served, columns=[_column("mean")])
    _wait_column(page, "B cell: mean")
    heads = _headers(page)
    i = next(k for k, h in enumerate(heads) if "B cell: mean" in h)
    page.click(f"{BOX} .dataTables_scrollHead th:nth-child({i + 1})")
    page.click(f"{BOX} .dataTables_scrollHead th:nth-child({i + 1})")           # descending
    until(page, "([box]) => document.querySelector(box + ' .dataTables_scrollHead th.sorting_desc') !== null", [BOX])
    got = _column_values(page, "B cell: mean")
    want = dict(zip(GENES, _numbers("mean")))
    top = sorted(want, key=want.get, reverse=True)[0]
    names = _gene_names(page)
    assert names[0] == top, (names[:3], top)
    for gene, v in got.items():
        assert float(v) == pytest.approx(want[gene], rel=1e-3, abs=1e-4), gene


def test_link_round_trip_and_one_undo_step(page, served):
    _open(page, served)
    _open_tab(page)
    _add(page, "mean", "logged")
    _apply(page)
    _wait_column(page, "B cell: mean")
    cfg = page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig().columns", TID)
    assert cfg == [_column("mean", "logged")], cfg
    page.click(f"{T} .table-undo")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().columns.length === 0", TID)


# ------------------------------------------------------------------ z-score mean by layout

MENUS = """async ([layout]) => {
    const R = await import('/static/js/utils/source-registry.js');
    const m = R.getSource('group-stat').table.chooser.add.menus({ id: 'cell-grouping-A', title: 'Cell types' }, { method: 'mean', layer: 'logged' });
    const z = m.methods.find(o => o.value === 'zscore_mean');
    return layout === 'any' ? z : (z.disabled ? false : z);
}"""


def test_zscore_mean_available_on_csc(page, served):
    _open(page, served)
    _open_tab(page)
    until(page, MENUS, ["csc"], timeout=60)
    z = {e["v"]: e for e in _agg_entries(page)}["zscore_mean"]
    assert z["off"] is False


@pytest.fixture(scope="module")
def served_csr(tmp_path_factory):
    from annzarro.tests.browser import test_focus_outside_subset as focus
    from annzarro.tests.browser.test_names_dataset_scope import _serve
    from annzarro.tests.core import grouping_store as gstore
    original = focus._make_store
    focus._make_store = lambda path: (gstore.make_store(str(path), "csr", "zarr", data=DATA), str(path))[1]
    try:
        proc, root, store = _serve(tmp_path_factory)
    finally:
        focus._make_store = original
    yield root, store
    proc.terminate()
    proc.wait(10)


def test_zscore_mean_greyed_on_csr(page, served_csr):
    _open(page, served_csr)
    _open_tab(page)
    until(page, """async () => {
        const R = await import('/static/js/utils/source-registry.js');
        const m = R.getSource('group-stat').table.chooser.add.menus({ id: 'cell-grouping-A', title: 'Cell types' }, { method: 'mean', layer: 'logged' });
        const z = m.methods.find(o => o.value === 'zscore_mean');
        return z.disabled && z.title.includes('stored by gene (CSC)');
    }""", timeout=60)
    z = {e["v"]: e for e in _agg_entries(page)}["zscore_mean"]
    assert z["off"] is True and "stored by gene (CSC)" in z["title"]


# ------------------------------------------------------------------ states of a column

NOTICE = """(box) => { const el = document.querySelector(box + ' .score-notice');
    return el ? { state: el.dataset.state, text: el.textContent.replace(/\\s+/g, ' ').trim(),
        actions: [...el.querySelectorAll('[data-ps-action]')].map(b => b.dataset.psAction + '|' + b.textContent.trim()) } : null; }"""


def _wait_notice(page, state):
    until(page, """([box, state]) => { const el = document.querySelector(box + ' .score-notice'); return !!el && el.dataset.state === state; }""", [BOX, state], timeout=60)
    return page.evaluate(NOTICE, BOX)


def test_gone_group_sends_nothing(page, served):
    gone = _column(group_key=json.dumps(["c:No such cells"], separators=(",", ":")), was=("No such cells",))
    _open(page, served, columns=[gone])
    notice = _wait_notice(page, "gone")
    assert "score-remove|Remove column" in notice["actions"], notice
    assert not _genes(page), "a group that is gone asks for no moments"


def test_deleted_grouping_column_says_so_and_can_be_removed(page, served):
    orphan = _column(grouping="cell-grouping-Z")
    _open(page, served, columns=[orphan])
    notice = _wait_notice(page, "deleted")
    assert "score-remove|Remove column" in notice["actions"], notice
    assert not _genes(page)
    page.click(f"{BOX} [data-ps-action='score-remove']")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().columns.length === 0", TID)


def test_changed_group_offers_keep_or_remove(page, served):
    """The group is still there but not called what the column says it was: it still draws, and the notice offers Keep."""
    changed = _column(was=("Old name",))
    _open(page, served, columns=[changed])
    notice = _wait_notice(page, "changed")
    assert "group-keep|Keep" in notice["actions"], notice
    page.click(f"{BOX} [data-ps-action='group-keep']")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().columns[0].groupWas[0] === 'B cell'", TID)
    until(page, "(box) => !document.querySelector(box + ' .score-notice')", BOX)


def test_tab_has_no_search_field(page, served):
    """Replaces the search tests: the tab lists ticked columns and one add row, so there is nothing to search."""
    _open(page, served)
    _open_tab(page)
    assert page.locator(f"{PANE} input[type=text], {PANE} .column-search").count() == 0
    assert page.locator(f"#var-content-{TID} .column-search").count() == 1, "var keeps its search"


def test_grouping_rename_follows_in_the_tab_and_the_export_name(page, served):
    _open(page, served, columns=[_column("mean")], open_ids=[TID, GA])
    _wait_column(page, "B cell: mean")
    page.evaluate("(id) => window.PanelManager.getPanel(id).setTitle('Renamed types')", GA)
    until(page, """(box) => [...document.querySelectorAll(box + ' .dataTables_scrollHead th')].some(th => (th.dataset.exportTitle || '') === 'Renamed types \\u203a B cell: mean \\u00b7 logged')""", BOX)
    page.click(TAB)
    until(page, "(pane) => [...document.querySelectorAll(pane + ' .az-score-group-title')].some(e => e.textContent === 'Renamed types')", PANE)


def test_loop_grouping_not_filterable_with_note(page, served):
    """A grouping built from this table (its score factor reads the table's genes) can be shown in it, never filtered on."""
    loop = _grouping(GB, "Scored", [{"source": {"type": "gene-score", "key": TID, "column": "zscore_mean", "layer": "logged"},
                                     "binning": {"method": "equal_count", "bins": 3}}])
    _open(page, served, groupings={GA: _grouping(), GB: loop})
    page.click(TAB)
    page.wait_for_selector(f"{PANE} .az-score-group", timeout=30000)
    notes = page.eval_on_selector_all(f"{PANE} .az-entity-note", "els => els.map(e => e.closest('.az-score-group').dataset.entity + '|' + e.textContent)")
    assert notes == [f"{GB}|Can't be filtered here: Scored depends on this table"], notes
    assert page.evaluate("""async ([a, b, t]) => { const R = await import('/static/js/utils/source-registry.js');
        const half = R.getSource('group-stat').table;
        return [half.filterable({ key: a }, t), half.filterable({ key: b }, t)]; }""", [GA, GB, TID]) == [True, False]


NK_KEY = json.dumps(["c:NK cell"], separators=(",", ":"))


def test_add_row_survives_a_panels_changed_event_mid_pick(page, served):
    """The page says "panels changed" for many reasons. One that changes nothing here leaves the tab as it is; one that does
    (a grouping renamed) builds it again with the group, layer and statistic chosen kept."""
    _open(page, served)
    _open_tab(page)
    g = _group_group()
    page.select_option(f"{g} .az-score-add-group", NK_KEY)
    page.select_option(f"{g} .az-score-add-layer", "counts")
    _pick_agg(page, GA, "sum")
    read = """(g) => { const row = document.querySelector(g + ' .az-score-add');
        window.__addRow = window.__addRow || row;
        return { same: window.__addRow === row, group: row.querySelector('.az-score-add-group').value,
            layer: row.querySelector('.az-score-add-layer').value, agg: row.querySelector('.az-score-add-agg').getAttribute('aria-label') }; }"""
    page.evaluate(read, g)                                                          # remembers this row
    page.evaluate("() => document.dispatchEvent(new CustomEvent('annzarro:panels-changed'))")
    same = page.evaluate(read, g)
    assert same["same"] is True, "nothing changed: the tab is left alone"
    page.evaluate("(id) => { window.PanelManager.getPanel(id).setTitle('Renamed'); document.dispatchEvent(new CustomEvent('annzarro:panels-changed')); }", GA)
    now = page.evaluate(read, f"{PANE} .az-score-group[data-entity='{GA}']")
    assert now["same"] is False, "the grouping was renamed: the tab is built again"
    assert now["group"] == NK_KEY and now["layer"] == "counts" and "Sum" in now["agg"], now
    page.click(f"{_group_group()} .az-score-add-btn")
    assert page.locator("input[data-type='group-stat'][data-layer='counts']:checked").count() == 1


def test_gene_table_tab_order(page, served):
    _open(page, served)
    tabs = page.evaluate("(t) => [...document.querySelectorAll(t + ' .nav-tabs .nav-link')].map(b => b.textContent.trim())", T)
    assert tabs == ["var", "varm", "varp", "layers", "Cell groupings"], tabs
