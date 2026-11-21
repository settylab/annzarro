"""The Cell Grouping panel in a real browser, against the real cell_groups route (G9a).

The store is the grouping fixture (tests/core/grouping_store.py): 1,200 cells, cell_type with 6 levels (one of 5 cells,
under the small-group threshold), condition, sample, depth, a 50-wide obsm, layers, an obsp matrix.

1.  Job 2, "cell type by condition": the empty state, Add factor twice, the status and the cards; every edit is one
    undoable step (GRP-2, GRP-3, GRP-4, GRP-7, GRP-10).
2.  A card: move, duplicate, remove with Undo, keyboard reorder, unticked levels left out, "in no group" as a button
    that lists the reasons, a level renamed with no request (GRP-4, GRP-8, SHR-2).
3.  Job 1, "my filtered cells against the rest": a table factor follows the table's filter (GRP-15).
4.  Job 5: a link carries the recipe and nothing computed; closed, it is restored from the link; a panel set round
    trip, and a set added beside open panels remaps the grouping's table (PER-1, PER-5, CAT-9).
5.  Close and reopen with the same id; a dataset switch keeps the recipe and names what is missing (GRP-13, GRP-14).
6.  Settings: the small-groups choice (keep, collect, hide) and its status line; a separator edit asks for nothing
    (SHR-12, GRP-8).
7.  Cell names as a factor: one group per cell (SHR-6).
8.  The states of UX 2.6 that this store cannot reach by itself (slow, asks first, too many groups, obsm in the Update
    tier), from the route's own replies with the estimate or the result rewritten.
9.  Loops: a menu option that would close a loop is unavailable with its reason; a loop from a link names the panels;
    a loop made by the last edit offers Undo (operator decisions 15 and 16).

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import base64
import json
import os
import time
import urllib.parse

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import test_focus_outside_subset as _focus  # noqa: E402
from annzarro.tests.browser import waits  # noqa: E402
from annzarro.tests.browser.test_names_dataset_scope import _serve  # noqa: E402
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402
from annzarro.tests.core import grouping_store as gstore  # noqa: E402

GA = "cell-grouping-A"
GB = "cell-grouping-B"
TA = "cell-table-T"
A = f'.tile[data-tile-id="{GA}"]'
B = f'.tile[data-tile-id="{GB}"]'
T = f'.tile[data-tile-id="{TA}"]'
CELL_TYPE = {"source": {"type": "obs", "key": "cell_type"}}
CONDITION = {"source": {"type": "obs", "key": "condition"}}
DATA = gstore.make_data()
N = gstore.N_OBS


def _make_store(path):
    gstore.make_store(str(path), "csc", "zarr", data=DATA)
    return str(path)


@pytest.fixture(scope="module")
def served(tmp_path_factory):
    # the server of test_focus_outside_subset (the code under test first on its path), on the grouping fixture
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
            page.calls = []
            page.on("request", lambda r: page.calls.append(json.loads(r.post_data or "{}"))
                    if "/data/cell_groups" in r.url and r.method == "POST" else None)
            yield page
            assert not errors, errors
        finally:
            browser.close()


# ------------------------------------------------------------------ helpers

def _grouping(pid=GA, title="Grouping 1", partitionings=(), **extra):
    return {"id": pid, "title": title, "version": 1, "partitionings": list(partitionings), **extra}


def _table(title="Table 1"):
    return {"id": TA, "title": title, "columns": [{"type": "obs", "key": "cell_type", "column": ""}]}


def _url(served, open_ids, configs):
    root, store = served
    tiles = [{"type": "tile", "id": i, "controlsVisible": True} for i in open_ids]

    def tree(nodes):
        if len(nodes) == 1:
            return nodes[0]
        return {"type": "split", "direction": "horizontal", "panes": [{"percentage": 100 // len(nodes)}, {"percentage": 100 - 100 // len(nodes)}],
                "children": [nodes[0], tree(nodes[1:])]}
    view = {"v": 1, "layout": {"v": 1, "hierarchy": [tree(tiles)] if tiles else [],
                               "controlState": {i: True for i in open_ids}, "panelConfigs": configs}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={enc}"


def _open(page, served, configs, open_ids=(GA,), sel=A):
    page.goto(_url(served, list(open_ids), configs))
    page.wait_for_selector(f"{sel} .cgrp-panel .cgrp-status[data-state]", timeout=30000)


def _status(page, sel=A):
    return page.evaluate("""(s) => { const e = document.querySelector(s + ' .cgrp-status');
        return { state: e.dataset.state, text: e.querySelector('.cgrp-status__text').textContent,
                 actions: [...e.querySelectorAll('.cgrp-action')].map(b => b.textContent),
                 small: (e.querySelector('.cgrp-small:not([hidden])') || {}).textContent || null,
                 noGroup: (e.querySelector('.cgrp-nogroup:not([hidden])') || {}).textContent || null,
                 usedBy: (e.querySelector('.cgrp-usedby:not([hidden])') || {}).textContent || null }; }""", sel)


def _ready(page, sel=A, text=None):
    """Wait for the status to be ready (and to say `text`), and return it."""
    until(page, """([s, t]) => { const e = document.querySelector(s + ' .cgrp-status');
        return e && e.dataset.state === 'ready' && (!t || e.querySelector('.cgrp-status__text').textContent === t); }""", [sel, text])
    return _status(page, sel)


def _state(page, pid=GA):
    return page.evaluate("(id) => window.PanelManager.getPanel(id)._debugState()", pid)


def _recipe(page, pid=GA):
    return page.evaluate("(id) => window.PanelManager.getPanel(id).getRecipe()", pid)


def _cards(page, sel=A):
    return page.evaluate("""(s) => [...document.querySelectorAll(s + ' .cgrp-card')].map(c => ({
        title: c.querySelector('.cgrp-card__title').textContent, summary: c.querySelector('.cgrp-card__summary').textContent,
        preview: (c.querySelector('.cgrp-card__preview') || {}).textContent || '',
        note: (c.querySelector('.cgrp-card__note:not([hidden])') || {}).textContent || '' }))""", sel)


def _add(page, entry, *, type_=None, key=None, column=None, gene=None, sel=A):
    page.click(f"{sel} .cgrp-add")
    page.click(f"{sel} .cgrp-add-menu [data-entry='{entry}']")
    row = f"{sel} .cgrp-addrow"
    page.wait_for_selector(row)
    if type_ is not None:
        page.select_option(f"{row} .cgrp-addrow__type", type_)
    if key is not None:
        page.select_option(f"{row} .cgrp-addrow__key", key)
    if column is not None:
        page.select_option(f"{row} .cgrp-addrow__column", column)
    if gene is not None:
        page.fill(f"{row} .cgrp-addrow__gene", gene)
    page.click(f"{row} .cgrp-addrow__ok")


def _groups_of(*columns, rows=None):
    obs = DATA.obs if rows is None else DATA.obs.iloc[rows]
    return int(obs.groupby(list(columns), observed=True).size().shape[0])


def _requests(page):
    return [c for c in page.calls if not c.get("estimate_only")]


# ------------------------------------------------------------------ 1. job 2

def test_job2_cell_type_by_condition_with_an_undo_per_edit(page, served):
    _open(page, served, {GA: _grouping()})
    assert _status(page)["state"] == "empty"
    empty = page.inner_text(f"{A} .cgrp-empty")
    assert "Add a factor to divide the cells into groups." in empty
    assert "A factor is a column, a gene in bins, a score in bins or a cell table." in empty
    assert page.locator(f"{A} .cgrp-undo").is_disabled()
    assert not _requests(page), "an empty grouping asks for nothing"

    _add(page, "column", type_="obs", key="cell_type")
    st = _ready(page, text=f"6 groups · {N:,} of {N:,} cells in a group")
    assert st["small"] == "1 small group (under 10 cells), kept"
    assert st["noGroup"] is None
    assert _cards(page)[0]["title"] == "cell_type"
    assert _cards(page)[0]["summary"] == "categorical · 6 levels"
    assert _cards(page)[0]["preview"] == "B cell 500 · T cell 300 · +4"

    _add(page, "column", type_="obs", key="condition")
    both = _groups_of("cell_type", "condition")
    _ready(page, text=f"{both} groups · {N:,} of {N:,} cells in a group")
    assert [c["title"] for c in _cards(page)] == ["cell_type", "condition"]
    assert _recipe(page)["partitionings"] == [CELL_TYPE, CONDITION]

    # one undo per edit; the second is the empty grouping again
    assert page.get_attribute(f"{A} .cgrp-undo", "title") == "Undo: add factor condition"
    page.click(f"{A} .cgrp-undo")
    _ready(page, text=f"6 groups · {N:,} of {N:,} cells in a group")
    # Ctrl+Z in the panel is the same undo
    page.focus(f"{A} .cgrp-add")
    page.keyboard.press("Control+z")
    until(page, "(s) => document.querySelector(s + ' .cgrp-status').dataset.state === 'empty'", A)
    assert _recipe(page)["partitionings"] == []
    assert page.locator(f"{A} .cgrp-undo").is_disabled()


# ------------------------------------------------------------------ 2. a card

def test_a_card_moves_duplicates_removes_and_renames_with_no_request(page, served):
    _open(page, served, {GA: _grouping(partitionings=[CELL_TYPE, CONDITION])})
    _ready(page)
    # Move down from the card's menu; Alt+Up on the header moves it back, announced
    page.click(f"{A} .cgrp-card[data-index='0'] .cgrp-card__more")
    page.click(f"{A} .cgrp-card[data-index='0'] [data-op='down']")
    until(page, "(s) => document.querySelector(s + ' .cgrp-card .cgrp-card__title').textContent === 'condition'", A)
    page.focus(f"{A} .cgrp-card[data-index='1'] .cgrp-card__head")
    page.keyboard.press("Alt+ArrowUp")
    until(page, "(s) => document.querySelector(s + ' .cgrp-card .cgrp-card__title').textContent === 'cell_type'", A)
    assert page.inner_text(f"{A} .cgrp-message") == "cell_type moved to position 1 of 2"
    # Duplicate, then Remove with its Undo in the message
    page.click(f"{A} .cgrp-card[data-index='1'] .cgrp-card__more")
    page.click(f"{A} .cgrp-card[data-index='1'] [data-op='duplicate']")
    until(page, "(s) => document.querySelectorAll(s + ' .cgrp-card').length === 3", A)
    page.click(f"{A} .cgrp-card[data-index='2'] .cgrp-card__more")
    page.click(f"{A} .cgrp-card[data-index='2'] [data-op='remove']")
    until(page, "(s) => document.querySelectorAll(s + ' .cgrp-card').length === 2", A)
    assert page.inner_text(f"{A} .cgrp-message").startswith("Removed factor condition.")
    page.click(f"{A} .cgrp-message .cgrp-message__undo")
    until(page, "(s) => document.querySelectorAll(s + ' .cgrp-card').length === 3", A)
    page.click(f"{A} .cgrp-undo")
    until(page, "(s) => document.querySelectorAll(s + ' .cgrp-card').length === 2", A)
    _ready(page)

    # untick T cell and leave the rest out of every group: 300 cells in no group, and the button says why
    page.click(f"{A} .cgrp-card[data-index='0'] .cgrp-card__head")
    page.uncheck(f"{A} .cgrp-card[data-index='0'] .cgrp-level[data-id='c:T cell'] input[type=checkbox]")
    page.check(f"{A} .cgrp-card[data-index='0'] input.cgrp-rest[value='exclude']")
    st = _ready(page, text=f"{_groups_of('cell_type', 'condition') - 2} groups · {N - 300:,} of {N:,} cells in a group")
    assert st["noGroup"] == "300 in no group"
    page.click(f"{A} .cgrp-nogroup")
    assert page.inner_text(f"{A} .cgrp-reasons") == "300 are in no ticked level of cell_type"
    assert page.get_attribute(f"{A} .cgrp-nogroup", "aria-expanded") == "true"
    assert _recipe(page)["partitionings"][0] == {**CELL_TYPE, "levels": ["c:B cell", "c:NK cell", "c:Monocyte", "c:Dendritic", "c:Platelet"],
                                                "rest": "exclude"}

    # a rename recomputes nothing and keeps the key; the hover says what it was
    asked = len(_requests(page))
    estimates = len(page.calls)
    page.click(f"{A} .cgrp-card[data-index='0'] .cgrp-level[data-id='c:B cell'] .cgrp-level__rename")
    page.fill(f"{A} .cgrp-card[data-index='0'] .cgrp-level[data-id='c:B cell'] input.cgrp-level__name", "B lymphocyte")
    page.keyboard.press("Enter")
    until(page, """(s) => document.querySelector(s + " .cgrp-level[data-id='c:B cell'] .cgrp-level__label").textContent === 'B lymphocyte'""", A)
    assert page.get_attribute(f"{A} .cgrp-level[data-id='c:B cell'] .cgrp-level__label", "title") == "Was: B cell"
    assert _recipe(page)["partitionings"][0]["labels"] == {"c:B cell": "B lymphocyte"}
    waits.expect_stays(lambda: len(_requests(page)) == asked and len(page.calls) == estimates,
                       "a rename asks for nothing: past the live delay a recompute would have been asked", page=page, seconds=0.8)
    assert _status(page)["state"] == "ready"


# ------------------------------------------------------------------ 3. job 1

def test_job1_a_table_factor_follows_its_tables_filter(page, served):
    _open(page, served, {GA: _grouping(), TA: _table()}, open_ids=(GA, TA))
    page.wait_for_selector(f"{T} .dataTables_scrollBody tbody tr", timeout=30000)
    _add(page, "table", key=TA)
    _ready(page, text=f"1 group · {N:,} of {N:,} cells in a group")
    assert _cards(page)[0]["title"] == "in Table 1"
    assert _cards(page)[0]["summary"] == "table · 2 levels"
    page.fill(f'{T} input[type="search"]', "Monocyte")
    st = _ready(page, text=f"2 groups · {N:,} of {N:,} cells in a group")
    assert _cards(page)[0]["preview"] == "in Table 1 150 · not in Table 1 1,050"
    # keep only "in": the rest are in no group, and say so
    page.click(f"{A} .cgrp-card[data-index='0'] .cgrp-card__head")
    page.uncheck(f"{A} .cgrp-card[data-index='0'] input.cgrp-keepout")
    st = _ready(page, text=f"1 group · 150 of {N:,} cells in a group")
    page.click(f"{A} .cgrp-nogroup")
    assert page.inner_text(f"{A} .cgrp-reasons") == "1,050 are not in Table 1"
    assert st["noGroup"] == "1,050 in no group"


# ------------------------------------------------------------------ 4. job 5

def _captured_url(page, served):
    root, store = served
    payload = page.evaluate("""async () => {
        const { encodeViewPayload } = await import('/static/js/utils/deeplink.js');
        return await encodeViewPayload(window.sessionManager.captureView());
    }""")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={payload}"


def test_job5_a_link_carries_the_recipe_and_nothing_computed_open_and_closed(page, served):
    renamed = {**CELL_TYPE, "labels": {"c:T cell": "T lymphocyte"}}
    _open(page, served, {GA: _grouping(partitionings=[renamed, CONDITION], separator=" / ", small={"mode": "collect"}), TA: _table()},
          open_ids=(GA, TA))
    _ready(page)
    cfg = page.evaluate("() => window.sessionManager.captureView()")["layout"]["panelConfigs"][GA]
    assert set(cfg) <= {"id", "title", "version", "partitionings", "separator", "small", "offered", "layers", "detect_above",
                        "controlsVisible"}, sorted(cfg)
    assert cfg["partitionings"] == [renamed, CONDITION] and cfg["separator"] == " / " and cfg["small"] == {"mode": "collect"}
    assert "groups" not in json.dumps(cfg) and "n_shown" not in json.dumps(cfg)

    link = _captured_url(page, served)
    page.goto("about:blank")
    page.goto(link)
    page.wait_for_selector(f"{A} .cgrp-status[data-state]", timeout=30000)
    assert _recipe(page)["partitionings"] == [renamed, CONDITION]
    _ready(page)
    # closed, it is in the link and restored closed, with its recipe
    page.evaluate(f"() => window.PanelManager.closePanel('{GA}')")
    until(page, f"() => !window.PanelManager.getActivePanels().some(p => p.getId() === '{GA}')")
    link = _captured_url(page, served)
    page.goto("about:blank")
    page.goto(link)
    until(page, f"() => !!window.PanelManager && !!window.PanelManager.getPanel('{GA}')")
    got = page.evaluate(f"""() => {{ const p = window.PanelManager.getPanel('{GA}');
        return {{ open: window.PanelManager.getActivePanels().includes(p), title: p.getTitle(), recipe: p.getRecipe() }}; }}""")
    assert got["open"] is False and got["title"] == "Grouping 1"
    assert got["recipe"]["partitionings"] == [renamed, CONDITION]


def _save_set(page, name):
    page.click("#btn-save-session")
    page.fill("#session-name", name)
    page.click("#btn-confirm-session")
    page.wait_for_function("() => document.getElementById('session-modal').offsetParent === null")
    page.wait_for_selector(".modal-backdrop", state="detached")


def test_job5_a_panel_set_round_trip_and_a_set_added_beside_open_panels_remaps_the_table(page, served):
    root, _ = served
    _open(page, served, {GA: _grouping(partitionings=[{"source": {"type": "table", "key": TA}}, CELL_TYPE]), TA: _table()},
          open_ids=(GA, TA))
    _ready(page)
    name = f"grouping-set-{int(time.time() * 1000)}"
    _save_set(page, name)
    page.goto(root)
    page.wait_for_function("() => window.sessionManager && window.PanelManager")
    loaded = page.evaluate("(n) => window.sessionManager.loadSession(n)", name)
    assert loaded["status"] == "success", loaded
    page.wait_for_selector(f"{A} .cgrp-status[data-state]", timeout=30000)
    assert _recipe(page)["partitionings"] == [{"source": {"type": "table", "key": TA}}, CELL_TYPE]
    _ready(page)
    # the same set added beside the open panels: new ids, and the added grouping reads the added table
    page.click("#btn-load-session")
    page.locator(f".session-card[data-session-name='{name}'] .session-add-closed").first.click()
    page.wait_for_function("() => PanelManager.getAllPanels().length === 4", timeout=30000)
    got = page.evaluate("""() => PanelManager.getAllPanels().map(p => [p.getType(), p.getId(),
        p.getType() === 'cell-grouping' ? p.getRecipe().partitionings[0].source.key : null])""")
    tables = [g[1] for g in got if g[0] == "cell-table"]
    groupings = [g for g in got if g[0] == "cell-grouping"]
    assert len(tables) == 2 and len(groupings) == 2
    added_table = [t for t in tables if t != TA][0]
    added = [g for g in groupings if g[1] != GA][0]
    assert added[2] == added_table, "the added grouping reads the added table, not the one that was open"
    assert [g for g in groupings if g[1] == GA][0][2] == TA


# ------------------------------------------------------------------ 5. close, reopen, dataset switch

def test_close_and_reopen_with_the_same_id_and_a_dataset_switch_keeps_the_recipe(page, served):
    _open(page, served, {GA: _grouping(partitionings=[CELL_TYPE, CONDITION])})
    _ready(page)
    page.click(f"{A} .tile-close")
    page.wait_for_selector(A, state="detached")
    opened = page.evaluate(f"() => {{ const p = window.PanelManager.reopenClosedPanel('{GA}'); return p ? p.getId() : null; }}")
    assert opened == GA
    _ready(page)
    assert _recipe(page)["partitionings"] == [CELL_TYPE, CONDITION]
    assert page.evaluate(f"() => window.PanelManager.getPanel('{GA}').getTitle()") == "Grouping 1"

    # another dataset without condition: the recipe stays, the factor is marked, nothing is computed
    asked = len(page.calls)
    page.evaluate("""async () => {
        const { DataManager } = await import('/static/js/data-manager.js');
        const real = DataManager.getDatasetStructure;
        DataManager.getDatasetStructure = async (...a) => { const s = JSON.parse(JSON.stringify(await real(...a)));
            s.obs.columns = s.obs.columns.filter(c => c !== 'condition'); delete s.obs.columns_info.condition; return s; };
        await window.PanelManager.notifyPanels('datasetChanged', { dataset: 'x' });
    }""")
    until(page, "(s) => document.querySelector(s + ' .cgrp-status').dataset.state === 'missing'", A)
    st = _status(page)
    assert st["text"] == "Nothing computed until condition is replaced or removed."
    assert [c["title"] for c in _cards(page)] == ["cell_type", "condition (not in this dataset)"]
    assert _recipe(page)["partitionings"] == [CELL_TYPE, CONDITION]
    waits.expect_stays(lambda: len(page.calls) == asked,
                       "nothing is asked while a factor is missing: past the live delay a request would have gone", page=page, seconds=0.8)
    # removing it computes again
    page.click(f"{A} .cgrp-card[data-index='1'] .cgrp-card__more")
    page.click(f"{A} .cgrp-card[data-index='1'] [data-op='remove']")
    _ready(page, text=f"6 groups · {N:,} of {N:,} cells in a group")


def test_back_and_forward_restore_the_recipe(page, served):
    _open(page, served, {GA: _grouping(partitionings=[CELL_TYPE])})
    _ready(page, text=f"6 groups · {N:,} of {N:,} cells in a group")
    # a grouping at rest makes no history step (computing is not an edit); this also outwaits the history's merge
    # window (url-history.js MERGE_MS), so the next edit starts its own entry
    before = page.evaluate("() => history.length")
    waits.expect_stays(lambda: page.evaluate("() => history.length") == before,
                       "computing groups is no history step; nothing else marks the merge window's end", page=page, seconds=1.5)
    _add(page, "column", type_="obs", key="condition")
    _ready(page, text=f"{_groups_of('cell_type', 'condition')} groups · {N:,} of {N:,} cells in a group")
    until(page, "(b) => history.length >= b + 1", before)
    page.go_back()
    until(page, "(id) => window.PanelManager.getPanel(id)?.getRecipe().partitionings.length === 1", GA)
    _ready(page, text=f"6 groups · {N:,} of {N:,} cells in a group")
    page.go_forward()
    until(page, "(id) => window.PanelManager.getPanel(id)?.getRecipe().partitionings.length === 2", GA)
    _ready(page, text=f"{_groups_of('cell_type', 'condition')} groups · {N:,} of {N:,} cells in a group")


def test_a_closed_grouping_used_by_an_open_one_is_computed_for_it(page, served):
    # PER-5, PER-6: the closed grouping is restored from the link and computed because a dependant on screen needs it
    configs = {GA: _grouping(partitionings=[CELL_TYPE]),
               GB: _grouping(GB, "Grouping 2", partitionings=[{"source": {"type": "cell-group", "key": GA}}])}
    _open(page, served, configs, open_ids=(GB,), sel=B)
    _ready(page, sel=B, text=f"6 groups · {N:,} of {N:,} cells in a group")
    assert page.evaluate(f"() => window.PanelManager.getActivePanels().some(p => p.getId() === '{GA}')") is False
    assert _cards(page, B)[0]["title"] == "Grouping 1"
    assert _cards(page, B)[0]["preview"] == "B cell 500 · T cell 300 · +4", "the levels of a grouping are its groups' names"


# ------------------------------------------------------------------ 6. settings

def test_settings_small_groups_keep_collect_hide_and_a_separator_that_asks_for_nothing(page, served):
    _open(page, served, {GA: _grouping(partitionings=[CELL_TYPE])})
    _ready(page, text=f"6 groups · {N:,} of {N:,} cells in a group")
    assert page.inner_text(f"{A} .cgrp-settings__summary") == 'Separator " | " · small groups under 10 cells kept'
    page.click(f"{A} .cgrp-settings__head")
    assert page.get_attribute(f"{A} .cgrp-settings__head", "aria-expanded") == "true"
    page.check(f"{A} input.cgrp-smallmode[value='collect']")
    # the same number of groups: wait for the small-groups line to say so
    until(page, "(s) => /collected/.test(document.querySelector(s + ' .cgrp-small').textContent)", A)
    st = _ready(page, text=f"6 groups · {N:,} of {N:,} cells in a group")
    assert st["small"] == '1 small group (under 10 cells), collected into "Small groups (under 10 cells)"'
    page.check(f"{A} input.cgrp-smallmode[value='hide']")
    st = _ready(page, text=f"5 groups · {N - 5:,} of {N:,} cells in a group")
    assert st["small"] == "1 small group (under 10 cells), hidden: their cells are in no group"
    page.click(f"{A} .cgrp-nogroup")
    assert page.inner_text(f"{A} .cgrp-reasons") == "1 small group (under 10 cells) is hidden"
    # a threshold of 46 makes Dendritic (45) small too
    page.fill(f"{A} input.cgrp-threshold", "46")
    page.keyboard.press("Enter")
    _ready(page, text=f"4 groups · {N - 50:,} of {N:,} cells in a group")
    assert _recipe(page)["small"] == {"threshold": 46, "mode": "hide"}
    # an invalid threshold keeps the last valid value and says why
    page.fill(f"{A} input.cgrp-threshold", "0")
    page.keyboard.press("Enter")
    assert page.input_value(f"{A} input.cgrp-threshold") == "46"
    assert page.inner_text(f"{A} .cgrp-settings__problem") == "Enter a whole number of cells, 1 or more."
    asked = len(page.calls)
    page.fill(f"{A} input.cgrp-separator", " / ")
    page.keyboard.press("Enter")
    until(page, "(s) => document.querySelector(s + ' .cgrp-settings__summary').textContent.startsWith('Separator \" / \"')", A)
    waits.expect_stays(lambda: len(page.calls) == asked,
                       "a separator changes no number: past the live delay a request would have gone", page=page, seconds=0.8)
    assert page.inner_text(f"{A} .cgrp-settings__summary") == 'Separator " / " · small groups under 46 cells hidden'


# ------------------------------------------------------------------ 7. cell names

def test_cell_names_make_one_group_per_cell(page, served):
    _open(page, served, {GA: _grouping()})
    _add(page, "cells")
    _ready(page, text=f"{N:,} groups · {N:,} of {N:,} cells in a group")
    assert _recipe(page)["partitionings"] == [{"source": {"type": "obs", "key": "_index"}}]
    assert _cards(page)[0]["summary"] == f"categorical · {N:,} levels"


def test_a_gene_and_a_score_in_bins(page, served):
    sig = {"id": "gene-signature-S", "title": "B score", "genes": [gstore.gene(i) for i in range(12)]}
    _open(page, served, {GA: _grouping(), "gene-signature-S": sig})
    _add(page, "gene", key="logged", gene=gstore.gene(1))
    _ready(page)
    # a gene with at least 25% zeros gets the zero bin once its card has the preview (SHR-15, the binning control)
    until(page, "(id) => !!window.PanelManager.getPanel(id).getRecipe().partitionings[0].binning.zero_bin", GA)
    assert _recipe(page)["partitionings"] == [{"source": {"type": "layer", "key": "logged", "column": gstore.gene(1)},
                                               "binning": {"method": "equal_count", "zero_bin": True}}]
    assert _cards(page)[0]["title"] == gstore.gene(1)
    assert _cards(page)[0]["summary"].startswith("binned · Equal count · ")
    # a gene the dataset lacks is refused in the row, with the reason
    page.click(f"{A} .cgrp-add")
    page.click(f"{A} .cgrp-add-menu [data-entry='gene']")
    page.fill(f"{A} .cgrp-addrow__gene", "NOGENE")
    page.click(f"{A} .cgrp-addrow__ok")
    assert page.inner_text(f"{A} .cgrp-addrow__note") == "NOGENE is not in this dataset."
    page.click(f"{A} .cgrp-addrow__cancel")
    # a closed signature's score, its recipe inline in the request
    _add(page, "score", key="gene-signature-S")
    until(page, """(s) => { const c = document.querySelectorAll(s + ' .cgrp-card .cgrp-card__summary');
        return c.length === 2 && / levels$/.test(c[1].textContent); }""", A)
    _ready(page)
    score = _recipe(page)["partitionings"][1]
    assert score["source"]["type"] == "gene-score" and score["source"]["key"] == "gene-signature-S"
    assert score["binning"] == {"method": "equal_count"}
    sent = [c for c in _requests(page) if any(p["source"]["type"] == "gene-score" for p in c.get("partitionings", []))]
    assert sent and sent[-1]["partitionings"][1]["source"]["recipe"]["genes"] == sig["genes"], [json.dumps(c)[:300] for c in page.calls]
    assert _cards(page)[1]["title"] == "B score"


# ------------------------------------------------------------------ 8. states from rewritten replies

def _rewrite_estimate(page, seconds, tier="live"):
    def handler(route):
        body = json.loads(route.request.post_data or "{}")
        if not body.get("estimate_only"):
            return route.continue_()
        reply = route.fetch().json()
        reply["estimate"] = {**reply.get("estimate", {}), "seconds": seconds, "tier": tier, "live_max_s": 5}
        route.fulfill(status=200, body=json.dumps(reply), headers={"Content-Type": "application/json"})
    page.route("**/api/v1/data/cell_groups*", handler)


def test_a_slow_edit_waits_for_update_groups_and_asks_first_when_large(page, served):
    _open(page, served, {GA: _grouping(partitionings=[CELL_TYPE])})
    _ready(page)
    _rewrite_estimate(page, 40)
    _add(page, "column", type_="obs", key="condition")
    until(page, "(s) => document.querySelector(s + ' .cgrp-status').dataset.state === 'held'", A)
    st = _status(page)
    assert st["text"] == "1 change not applied. About 40 s." and st["actions"] == ["Update groups"]
    page.click(f"{A} .cgrp-action[data-action='update']")
    _ready(page, text=f"{_groups_of('cell_type', 'condition')} groups · {N:,} of {N:,} cells in a group")
    # an estimate in the confirm tier asks first
    page.unroute("**/api/v1/data/cell_groups*")
    _rewrite_estimate(page, 120, tier="confirm")
    page.evaluate("() => window.PanelManager.getPanel('%s').addFactor({source: {type: 'obs', key: 'is_doublet'}})" % GA)
    until(page, "(s) => ['held', 'awaiting'].includes(document.querySelector(s + ' .cgrp-status').dataset.state)", A)
    if _status(page)["state"] == "held":
        page.click(f"{A} .cgrp-action[data-action='update']")
    until(page, "(s) => document.querySelector(s + ' .cgrp-status').dataset.state === 'awaiting'", A)
    st = _status(page)
    assert st["text"] == f"Grouping {N:,} cells will take about 2 minutes." and st["actions"] == ["Compute", "Not now"]
    page.click(f"{A} .cgrp-action[data-action='compute']")
    _ready(page)


def test_an_obsm_factor_in_the_update_tier_says_it_reads_the_whole_matrix(page, served):
    _open(page, served, {GA: _grouping(partitionings=[CELL_TYPE])})
    _ready(page)
    _rewrite_estimate(page, 20)
    _add(page, "column", type_="obsm", key="X_wide", column="3")
    until(page, "(s) => document.querySelector(s + ' .cgrp-status').dataset.state === 'held'", A)
    assert _status(page)["text"] == "X_wide 3 reads all 50 columns of X_wide: about 20 s."


def test_too_many_groups_is_refused_with_the_count_and_the_way_out(page, served):
    def handler(route):
        body = json.loads(route.request.post_data or "{}")
        if body.get("estimate_only"):
            return route.continue_()
        frame = {"type": "result", "version": 1, "shape": "grouping", "n_shown": N,
                 "refused": {"reason": "too_many_groups", "count": 6840, "limit": 2000, "levels": [6, 1140]}, "blocks": []}
        route.fulfill(status=200, body=json.dumps({"type": "start", "entries_done": 0, "entries_total": 0}) + "\n" + json.dumps(frame) + "\n",
                      headers={"Content-Type": "application/x-ndjson"})
    page.route("**/api/v1/data/cell_groups*", handler)
    _open(page, served, {GA: _grouping(partitionings=[CELL_TYPE, {"source": {"type": "obs", "key": "many"}}])})
    until(page, "(s) => document.querySelector(s + ' .cgrp-status').dataset.state === 'refused'", A)
    st = _status(page)
    assert st["text"] == "6,840 groups: a grouping holds up to 2,000. Nothing was computed. many has 1,140 levels."
    assert st["actions"] == ["Choose levels of many"]
    page.click(f"{A} .cgrp-action[data-action='levels:1']")
    assert page.get_attribute(f"{A} .cgrp-card[data-index='1'] .cgrp-card__head", "aria-expanded") == "true"


# ------------------------------------------------------------------ 9. loops

def test_a_menu_option_that_would_close_a_loop_is_unavailable_with_its_reason(page, served):
    configs = {GA: _grouping(partitionings=[CELL_TYPE]),
               GB: _grouping(GB, "Grouping 2", partitionings=[{"source": {"type": "cell-group", "key": GA}}])}
    _open(page, served, configs, open_ids=(GA, GB))
    _ready(page)
    assert _status(page)["usedBy"] == "Used by 1 grouping"
    page.click(f"{A} .cgrp-add")
    page.click(f"{A} .cgrp-add-menu [data-entry='column']")
    page.select_option(f"{A} .cgrp-addrow__type", "obs")
    opt = page.evaluate("""(s) => { const o = [...document.querySelectorAll(s + ' .cgrp-addrow__key optgroup[label="Groupings"] option')];
        return o.map(x => ({ value: x.value, text: x.textContent, disabled: x.disabled, title: x.title })); }""", A)
    assert opt == [{"value": f"cell-group:{GB}", "text": "Grouping 2", "disabled": True,
                    "title": "Uses Grouping 2, which depends on this grouping"}]
    # in B's menu, A is available
    page.click(f"{B} .cgrp-add")
    page.click(f"{B} .cgrp-add-menu [data-entry='column']")
    page.select_option(f"{B} .cgrp-addrow__type", "obs")
    opt = page.evaluate("""(s) => [...document.querySelectorAll(s + ' .cgrp-addrow__key optgroup[label="Groupings"] option')]
        .map(x => [x.value, x.disabled])""", B)
    assert opt == [[f"cell-group:{GA}", False]]


def test_a_loop_from_a_link_names_the_panels_and_one_made_by_the_last_edit_offers_undo(page, served):
    ring = {GA: _grouping(partitionings=[{"source": {"type": "cell-group", "key": GB}}]),
            GB: _grouping(GB, "Grouping 2", partitionings=[{"source": {"type": "cell-group", "key": GA}}])}
    _open(page, served, ring, open_ids=(GA, GB))
    until(page, "(s) => document.querySelector(s + ' .cgrp-status').dataset.state === 'cycle'", A)
    st = _status(page)
    assert st["text"] == "Grouping 1 and Grouping 2 depend on each other." and st["actions"] == ["Open Grouping 2"]
    assert not _requests(page), "a loop computes nothing"

    # a loop the user's last edit made (through the panel's API: the menus prevent it) offers Undo
    line = {GA: _grouping(partitionings=[CELL_TYPE]),
            GB: _grouping(GB, "Grouping 2", partitionings=[{"source": {"type": "cell-group", "key": GA}}])}
    _open(page, served, line, open_ids=(GA, GB))
    _ready(page)
    page.evaluate("() => window.PanelManager.getPanel('%s').addFactor({source: {type: 'cell-group', key: '%s'}})" % (GA, GB))
    until(page, "(s) => document.querySelector(s + ' .cgrp-status').dataset.state === 'cycle'", A)
    assert _status(page)["actions"] == ["Undo", "Open Grouping 2"]
    page.click(f"{A} .cgrp-action[data-action='undo']")
    _ready(page, text=f"6 groups · {N:,} of {N:,} cells in a group")
    _ready(page, sel=B)


# ------------------------------------------------------------------ 10. a new panel's title

def test_a_new_grouping_is_titled_grouping_1_and_other_types_keep_their_label(page, served):
    _open(page, served, {GA: _grouping(title="Mine")})
    got = page.evaluate("""() => ['cell-grouping', 'cell-grouping', 'cell-table'].map(t => window.PanelManager.createPanelInLayout(t, {}).getTitle())""")
    assert got == ["Grouping 1", "Grouping 2", "Cell Table 1"]


# ------------------------------------------------------------------ 11. Toggle Controls

def test_toggle_controls_hides_and_shows_the_grouping_bar_and_a_table_still_toggles(page, served):
    _open(page, served, {GA: _grouping(partitionings=[CELL_TYPE]), TA: _table()}, open_ids=(GA, TA))
    _ready(page)
    page.wait_for_selector(f"{T} .table-controls", timeout=30000)
    shown = "(s) => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none' && !e.closest('[hidden]'); }"
    assert page.evaluate(shown, f"{A} .cgrp-controls") and page.evaluate(shown, f"{A} .cgrp-settings-zone")
    page.click(f"{A} .tile-toggle-controls")
    until(page, f"() => !({shown})('{A} .cgrp-controls')")
    assert not page.evaluate(shown, f"{A} .cgrp-settings-zone"), "Settings hide with the controls (UX 2.1)"
    assert page.evaluate(shown, f"{A} .cgrp-status") and page.evaluate(shown, f"{A} .cgrp-card"), "the status and the cards stay"
    assert page.evaluate(f"() => window.PanelManager.getPanel('{GA}').getConfig().controlsVisible") is False
    page.click(f"{A} .tile-toggle-controls")
    until(page, f"() => ({shown})('{A} .cgrp-controls')")
    assert page.evaluate(shown, f"{A} .cgrp-settings-zone")
    # a table toggles as before
    page.click(f"{T} .tile-toggle-controls")
    until(page, f"() => !({shown})('{T} .table-controls')")
    page.click(f"{T} .tile-toggle-controls")
    until(page, f"() => ({shown})('{T} .table-controls')")


# ------------------------------------------------------------------ 12. delete from the panel menu

SIG = "gene-signature-S"
PLOT = "cell-plot-P"


def _chooser(page, served):
    sig = {"id": SIG, "title": "T cell score", "genes": [gstore.gene(i) for i in range(12, 24)]}
    plot = {"id": PLOT, "title": "Cell Plot 1", "x": {"type": "obsm", "key": "X_umap", "column": "0"},
            "y": {"type": "obsm", "key": "X_umap", "column": "1"}, "z": None,
            "color": {"type": "gene-score", "key": SIG, "column": ""}}
    lonely = {"id": "cell-table-L", "title": "Lonely table", "columns": [{"type": "obs", "key": "cell_type", "column": ""}]}
    page.goto(_url(served, [PLOT], {PLOT: plot, SIG: sig, "cell-table-L": lonely}))
    page.wait_for_selector(f'.tile[data-tile-id="{PLOT}"] .js-plotly-plot', timeout=30000)
    page.click(f'.tile[data-tile-id="{PLOT}"] .tile-split-h')
    page.wait_for_selector(f".tile-selector .delete-panel-btn[data-id='{SIG}']")


def test_a_panel_in_use_is_deleted_on_a_second_press_that_the_button_asks_for(page, served):
    _chooser(page, served)
    btn = f".tile-selector .delete-panel-btn[data-id='{SIG}']"
    question = "Delete 'T cell score'? 1 plot uses it."
    page.click(btn)
    assert page.inner_text(btn) == "Delete?" and page.get_attribute(btn, "aria-label") == question
    assert "tile-delete-armed" in page.get_attribute(btn, "class") and not page.get_attribute(btn, "style")
    badge = f".tile-selector .source-panel-option[data-id='{SIG}'] .panel-closed-btn"
    hidden = "(s) => [...document.querySelectorAll(s)].some(e => e.offsetParent && getComputedStyle(e).visibility === 'hidden')"
    # the badge's own 0.2 s transition holds visibility until it ends: wait for it
    until(page, f"() => ({hidden})({json.dumps(badge)})")
    assert page.inner_text(f".tile-selector .source-panel-option[data-id='{SIG}'] .delete-panel-question") == question
    assert page.evaluate(f"() => !!window.PanelManager.getPanel('{SIG}')"), "the first press deletes nothing"
    # Escape puts the button back; a focus move does too
    page.focus(btn)
    page.keyboard.press("Escape")
    assert page.inner_text(btn) == "×" and page.locator(".delete-panel-question").count() == 0
    assert "tile-delete-armed" not in page.get_attribute(btn, "class")
    until(page, f"() => !({hidden})({json.dumps(badge)})")
    page.focus(btn)
    page.keyboard.press("Enter")
    assert page.inner_text(btn) == "Delete?"
    page.keyboard.press("Tab")
    assert page.inner_text(btn) == "×"
    # Enter twice deletes
    page.focus(btn)
    page.keyboard.press("Enter")
    page.keyboard.press("Enter")
    until(page, f"() => !window.PanelManager.getPanel('{SIG}')")


def test_a_panel_nothing_uses_is_deleted_on_the_first_press(page, served):
    _chooser(page, served)
    page.click(".tile-selector .delete-panel-btn[data-id='cell-table-L']")
    until(page, "() => !window.PanelManager.getPanel('cell-table-L')")
    assert page.locator(".delete-panel-question").count() == 0


def test_a_card_has_the_header_chevron_as_its_own_named_control(page, served):
    _open(page, served, {GA: _grouping(partitionings=[CELL_TYPE])})
    _ready(page)
    t = f"{A} .cgrp-card[data-index='0'] .cgrp-card__toggle"
    assert page.get_attribute(t, "aria-expanded") == "false" and page.get_attribute(t, "aria-label") == "Expand cell_type"
    assert page.locator(f"{t} i.fa-chevron-down").count() == 1
    page.click(t)
    assert page.get_attribute(t, "aria-expanded") == "true" and page.get_attribute(t, "aria-label") == "Collapse cell_type"
    assert page.locator(f"{t} i.fa-chevron-up").count() == 1
    assert page.locator(f"{A} .cgrp-card[data-index='0'] .cgrp-card__body").count() == 1
