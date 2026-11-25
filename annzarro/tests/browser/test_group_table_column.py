"""A Cell Grouping as a column of a Cell Table (G10), in a real browser against the real cell_groups route.

The store is the grouping fixture (tests/core/grouping_store.py): 1,200 cells, cell_type with 6 levels in the order
B cell, T cell, NK cell, Monocyte, Dendritic, Platelet (500, 300, 200, 150, 45, 5 cells), condition with 2.

1.  The column chooser has a `cell-group` tab listing every grouping; a ticked one is a column named by the grouping's
    title (CAT-6, CAT-8).
2.  The column shows each cell's group by name and "Not in any group" for a cell in no group, and sorts in group order,
    not by name (CAT-6).
3.  A condition's "Equals" lists the groups, and filters the rows (CAT-6).
4.  While the groups are being computed the rows of a table that filters on the column are held, in a grouping's words,
    and appear when the groups are there (CAT-6, GS 7.4).
5.  A table that filters on a group column is a binary partitioning for another grouping (CAT-7).
6.  A grouping built from this table can be shown in it (no loop) and says it cannot be filtered on there; the
    condition builder leaves it out (operator decision 15).
7.  A table that filters on a grouping built from that table, from a crafted link: the cycle state names the panels,
    nothing is computed, the rows are held; Remove this filter ends the loop and keeps the column (SHR-34, decisions 16
    and 18).
8.  Light and dark screenshots of the column and of the cycle state, when ANNZARRO_THEME_SHOTS names a directory.
9.  A link's condition that names a value the cells shown don't have keeps it and shows no rows (search-builder.js
    fastSelectInit, which also keeps a grouping's link condition while the groups are computed).

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import json
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import waits  # noqa: E402
from annzarro.tests.browser.test_cell_grouping_panel import served, _url, N, DATA  # noqa: E402,F401
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402
from annzarro.tests.core import grouping_store as gstore  # noqa: E402

GA, GB = "cell-grouping-A", "cell-grouping-B"
TA = "cell-table-T"
BOX = f"#table-container-{TA}"
T = f'.tile[data-tile-id="{TA}"]'
A = f'.tile[data-tile-id="{GA}"]'
B = f'.tile[data-tile-id="{GB}"]'
CELL_TYPE = {"source": {"type": "obs", "key": "cell_type"}}
CONDITION = {"source": {"type": "obs", "key": "condition"}}
TYPES = [name for name, _ in gstore.CELL_TYPES]
SIZES = dict(gstore.CELL_TYPES)
OBS_TYPE = {"type": "obs", "key": "cell_type", "column": ""}
ROUTE = "**/api/v1/data/cell_groups*"
DATA_OBS_NAMES = list(DATA.obs.index)
DATA_CELL_TYPE = [str(v) for v in DATA.obs["cell_type"]]


def by(pid):
    return {"type": "cell-group", "key": pid, "column": ""}


def key_of(pid):
    """The column's data key (utils/column-key.js): what a filter's condition names it by."""
    return f"cell-group_{pid}_main"


def equals(pid, title, value):
    return {"logic": "AND", "criteria": [{"condition": "=", "data": title, "origData": key_of(pid), "type": "string", "value": [value]}]}


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

def _grouping(pid=GA, title="Grouping 1", partitionings=(CELL_TYPE,), **extra):
    return {"id": pid, "title": title, "version": 1, "partitionings": list(partitionings), **extra}


def _table(columns=(OBS_TYPE,), title="Table 1", **extra):
    return {"id": TA, "title": title, "columns": list(columns), **extra}


def _open(page, served, configs, open_ids=(TA,)):
    page.goto(_url(served, list(open_ids), configs))
    page.wait_for_selector(f"{BOX} .dataTables_scrollBody", state="attached", timeout=30000)


def _headers(page):
    return page.evaluate("""(box) => [...document.querySelectorAll(box + ' .dataTables_scrollHead th')]
        .map(th => th.textContent.replace(/\\s+/g, ' ').trim())""", BOX)


def _index(page, title):
    """The position of the column named `title` (its header may still say its state in brackets)."""
    heads = _headers(page)
    return next(i for i, h in enumerate(heads) if h == title or h.startswith(title + " ("))


def _column(page, index):
    return page.evaluate("""([box, i]) => [...document.querySelectorAll(box + ' .dataTables_scrollBody tbody tr')]
        .map(tr => ((tr.children[i] || {}).textContent || '').trim())""", [BOX, index])


def _all(page, index, kind="display"):
    """Every row's cell of a column in the table's current order and filter, as DataTables renders it."""
    return page.evaluate("""([box, i, kind]) => { const dt = $(box + ' .dataTables_scrollBody table').DataTable();
        return dt.rows({ order: 'applied', search: 'applied' }).indexes().toArray()
            .map(r => String(dt.cell(r, i).render(kind)).replace(/<[^>]+>/g, '').trim()); }""", [BOX, index, kind])


def _api(page, expr):
    return page.evaluate(f"() => {{ const dt = $('{BOX} .dataTables_scrollBody table').DataTable(); return ({expr}); }}")


def _notice(page):
    return page.evaluate("""(box) => { const el = document.querySelector(box + ' .score-notice');
        if (!el) return null;
        return { state: el.dataset.state, text: el.textContent.replace(/\\s+/g, ' ').trim(),
                 actions: [...el.querySelectorAll('[data-ps-action]')].map(b => b.dataset.psAction + '|' + b.textContent.trim()) }; }""", BOX)


def _held(page):
    return page.evaluate("""(box) => { const el = document.querySelector(box + ' .az-score-held-note');
        return el ? el.textContent.replace(/\\s+/g, ' ').trim() : null; }""", BOX)


def _filled(page, index=1):
    """Wait until the column shows groups (no cell still waiting for them)."""
    until(page, """([box, i]) => { const c = [...document.querySelectorAll(box + ' .dataTables_scrollBody tbody tr')]
        .map(tr => ((tr.children[i] || {}).textContent || '').trim());
        return c.length > 0 && c.every(t => t !== '' && !/computing|no groups/.test(t)); }""", [BOX, index])


def _computes(page):
    return [c for c in page.calls if not c.get("estimate_only")]


def _status(page, sel=A):
    return page.evaluate("""(s) => { const e = document.querySelector(s + ' .cgrp-status');
        return e ? { state: e.dataset.state, text: e.querySelector('.cgrp-status__text').textContent } : null; }""", sel)


def _shot(page, name, sel=T):
    """Screenshots for looking: only when ANNZARRO_THEME_SHOTS names a directory (as test_dark_theme.py)."""
    out = os.environ.get("ANNZARRO_THEME_SHOTS")
    if out:
        os.makedirs(out, exist_ok=True)
        page.locator(sel).screenshot(path=os.path.join(out, name + ".png"))


def _theme(page, mode):
    page.click(f'#theme-toggle button[data-theme-mode="{mode}"]')
    page.wait_for_function("(m) => document.documentElement.getAttribute('data-theme') === m", arg=mode, timeout=5000)


def _open_chooser(page):
    """Show the column chooser's cell-group tab."""
    page.click(f"#cell-group-tab-{TA}")
    page.wait_for_selector(f"#cell-group-content-{TA}.show .az-score-group", state="visible")
    page.wait_for_function("(id) => getComputedStyle(document.getElementById('cell-group-content-' + id)).opacity === '1'", arg=TA)


# ------------------------------------------------------------------ 1. the chooser

def test_the_chooser_has_a_cell_group_tab_and_a_ticked_grouping_is_a_column_named_by_its_title(page, served):
    configs = {TA: _table(), GA: _grouping(), GB: _grouping(GB, "Grouping 2", [CONDITION])}
    _open(page, served, configs, open_ids=(TA, GA))
    until(page, "(id) => !!document.querySelector('#cell-group-content-' + id + ' .column-checkbox')", TA)
    tabs = page.evaluate("(t) => [...document.querySelectorAll(t + ' .data-type-tabs .nav-tabs button')].map(b => b.textContent.trim())", T)
    assert "Cell groupings" in tabs and "cell-group" not in tabs and "gene-score" not in tabs, tabs
    boxes = page.evaluate("""(id) => [...document.querySelectorAll('#cell-group-content-' + id + ' .column-checkbox')]
        .map(b => [b.dataset.type, b.dataset.key, b.checked, b.disabled, b.nextElementSibling.textContent])""", TA)
    assert sorted(boxes) == [["cell-group", GA, False, False, "Grouping 1"], ["cell-group", GB, False, False, "Grouping 2"]], \
        "every grouping, open or closed, by its title"
    page.evaluate("(id) => { const b = document.querySelector('#cell-group-content-' + id + ' .column-checkbox[data-key=\"%s\"]'); b.click(); }" % GA, TA)
    # the grouping's own panel is open: its groups (and the focused gene's statistics, G9c) are asked without codes, in
    # requests whose order against the table's depends on timing alone, so the table's request is told by what it asks
    before = len(_computes(page))
    assert not any(c["want"]["codes"] for c in _computes(page)), "no one reads the codes before the table has the column"
    page.click(f"#apply-columns-{TA}")
    until(page, "([box]) => [...document.querySelectorAll(box + ' .dataTables_scrollHead th')].some(th => th.textContent.trim().startsWith('Grouping 1'))", [BOX])
    cols = page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig().columns.map(c => [c.type, c.key, c.label || null])", TA)
    assert ["cell-group", GA, "Grouping 1"] in cols
    _filled(page, _index(page, "Grouping 1"))
    assert any(c["want"]["codes"] is True for c in _computes(page)[before:]), "a table reads the codes"


# ------------------------------------------------------------------ 2. cells and sort

def test_the_column_names_each_cells_group_and_sorts_in_group_order(page, served):
    _open(page, served, {TA: _table([OBS_TYPE, by(GA)]), GA: _grouping()})
    _filled(page, 2)
    until(page, "(box) => [...document.querySelectorAll(box + ' .dataTables_scrollHead th')].some(th => th.textContent.trim() === 'Grouping 1')", BOX)
    assert _headers(page)[:3] == ["Cell ID", "cell_type", "Grouping 1"], _headers(page)
    page.evaluate(f"""() => {{ const dt = $('{BOX} .dataTables_scrollBody table').DataTable(); dt.order([2, 'asc']).draw(); }}""")
    shown = _all(page, 2)
    assert len(shown) == N
    runs = [g for i, g in enumerate(shown) if i == 0 or shown[i - 1] != g]
    assert runs == TYPES, f"sorted in group order, not by name: {runs}"
    assert [shown.count(t) for t in TYPES] == [SIZES[t] for t in TYPES]
    # each row's group is its own cell_type
    assert _all(page, 1) == shown
    page.evaluate(f"""() => {{ const dt = $('{BOX} .dataTables_scrollBody table').DataTable(); dt.order([2, 'desc']).draw(); }}""")
    shown = _all(page, 2)
    assert [g for i, g in enumerate(shown) if i == 0 or shown[i - 1] != g] == TYPES[::-1]


def test_cells_in_no_group_read_not_in_any_group_and_sort_last(page, served):
    two = {**CELL_TYPE, "levels": ["c:B cell", "c:T cell"], "rest": "exclude"}
    _open(page, served, {TA: _table([OBS_TYPE, by(GA)]), GA: _grouping(partitionings=[two])})
    _filled(page, 2)
    page.evaluate(f"""() => {{ const dt = $('{BOX} .dataTables_scrollBody table').DataTable(); dt.order([2, 'asc']).draw(); }}""")
    shown = _all(page, 2)
    runs = [g for i, g in enumerate(shown) if i == 0 or shown[i - 1] != g]
    assert runs == ["B cell", "T cell", "Not in any group"], runs
    assert shown.count("Not in any group") == N - 800
    # the table's search finds them by name
    page.evaluate(f"""() => {{ $('{BOX} .dataTables_scrollBody table').DataTable().search('Not in any group').draw(); }}""")
    assert set(_all(page, 2)) == {"Not in any group"}


# ------------------------------------------------------------------ 3. the filter

def test_a_conditions_equals_lists_the_groups_and_filters_the_rows(page, served):
    _open(page, served, {TA: _table([OBS_TYPE, by(GA)], searchBuilderConfig=equals(GA, "Grouping 1", "NK cell")), GA: _grouping()})
    until(page, "(box) => !document.querySelector(box + ' .az-score-held-note')", BOX)
    until(page, "(box) => $(box + ' .dataTables_scrollBody table').DataTable().rows({search: 'applied'}).count() === %d" % SIZES["NK cell"], BOX)
    assert set(_all(page, 2)) == {"NK cell"}
    assert _all(page, 1) == ["NK cell"] * SIZES["NK cell"]
    assert page.evaluate("(box) => document.querySelector(box + ' .dtsb-criteria select.dtsb-value').value", BOX) == "NK cell"
    # a new condition on the column: its value is a list of the groups (categorical conditions), not a typed box
    _builder_columns(page)
    page.evaluate("""(box) => { const sels = document.querySelectorAll(box + ' .dtsb-criteria select.dtsb-data'); const sel = sels[sels.length - 1];
        sel.value = [...sel.options].find(o => o.textContent.trim() === 'Grouping 1').value; $(sel).trigger('change'); }""", BOX)
    page.wait_for_function("""(box) => { const c = document.querySelectorAll(box + ' .dtsb-criteria'); const last = c[c.length - 1];
        return !!last.querySelector('select.dtsb-condition') && last.querySelector('select.dtsb-condition').options.length > 1; }""", arg=BOX)
    page.evaluate("""(box) => { const c = document.querySelectorAll(box + ' .dtsb-criteria'); const sel = c[c.length - 1].querySelector('select.dtsb-condition');
        sel.value = '='; $(sel).trigger('change'); }""", BOX)
    page.wait_for_function("(box) => { const c = document.querySelectorAll(box + ' .dtsb-criteria'); return !!c[c.length - 1].querySelector('select.dtsb-value'); }", arg=BOX)
    options = page.evaluate("""(box) => { const c = document.querySelectorAll(box + ' .dtsb-criteria');
        return [...c[c.length - 1].querySelector('select.dtsb-value').options].filter(o => !o.disabled && o.value !== '').map(o => o.textContent); }""", BOX)
    assert sorted(options) == sorted(TYPES), options


# ------------------------------------------------------------------ 4. held rows

def test_the_rows_are_held_while_the_groups_are_computed_and_appear_with_them(page, served):
    held = []
    gate = {"open": False}

    def hold(route):
        if gate["open"]:
            route.continue_()
        else:
            held.append(route)

    page.route(ROUTE, hold)
    _open(page, served, {TA: _table([OBS_TYPE, by(GA)], searchBuilderConfig=equals(GA, "Grouping 1", "T cell")), GA: _grouping()})
    until(page, "(box) => !!document.querySelector(box + ' .az-score-held-note')", BOX)
    assert _held(page) == "Filter on 'Grouping 1' not applied yet. Rows appear when the groups are ready."
    assert "Grouping 1 (computing)" in _headers(page)
    assert page.evaluate("(box) => document.querySelector(box).classList.contains('az-score-held')", BOX), "the rows are held"
    assert page.evaluate("(id) => window.PanelManager.getPanel(id).isReady()", TA) is False, "no row is reported as passing"
    _shot(page, "g10-held-rows-light")
    gate["open"] = True
    for route in held:
        route.continue_()
    until(page, "(box) => !document.querySelector(box + ' .az-score-held-note')", BOX)
    until(page, "(box) => $(box + ' .dataTables_scrollBody table').DataTable().rows({search: 'applied'}).count() === %d" % SIZES["T cell"], BOX)
    assert set(_all(page, 2)) == {"T cell"}
    assert "Grouping 1" in _headers(page)


# ------------------------------------------------------------------ 5. a filtered table as a factor

def test_a_table_filtering_on_a_group_column_is_a_factor_of_another_grouping(page, served):
    configs = {TA: _table([OBS_TYPE, by(GA)], searchBuilderConfig=equals(GA, "Grouping 1", "Monocyte")), GA: _grouping(),
               GB: _grouping(GB, "Grouping 2", [{"source": {"type": "table", "key": TA}}])}
    _open(page, served, configs, open_ids=(TA, GB))
    until(page, "(box) => $(box + ' .dataTables_scrollBody table').DataTable().rows({search: 'applied'}).count() === %d" % SIZES["Monocyte"], BOX)
    until(page, "(s) => { const e = document.querySelector(s + ' .cgrp-status'); return !!e && e.dataset.state === 'ready'; }", B)
    assert _status(page, B)["text"] == f"2 groups · {N:,} of {N:,} cells in a group", _status(page, B)


# ------------------------------------------------------------------ 6. the menu and the condition builder

def _builder_columns(page, keyboard=False):
    """The columns a new condition of the filter can name: SearchBuilder's column list of a condition just added, by a
    click or by Enter on the focused Add condition button."""
    before = page.locator(f"{BOX} .dtsb-criteria select.dtsb-data").count()
    add = page.locator(f"{BOX} .dtsb-searchBuilder .dtsb-add").first
    if keyboard:
        add.focus()
        page.keyboard.press("Enter")
    else:
        add.click()
    until(page, "([box, n]) => document.querySelectorAll(box + ' .dtsb-criteria select.dtsb-data').length > n", [BOX, before])
    return page.evaluate("""(box) => { const sels = document.querySelectorAll(box + ' .dtsb-criteria select.dtsb-data');
        const sel = sels[sels.length - 1];
        return [...sel.options].filter(o => !o.disabled && o.value !== '').map(o => o.textContent.trim()); }""", BOX)


def test_a_grouping_built_from_this_table_can_be_shown_but_not_filtered_on_here(page, served):
    configs = {TA: _table(), GA: _grouping(partitionings=[{"source": {"type": "table", "key": TA}}, CELL_TYPE]),
               GB: _grouping(GB, "Grouping 2", [CONDITION])}
    _open(page, served, configs, open_ids=(TA, GA))
    until(page, "(id) => document.querySelectorAll('#cell-group-content-' + id + ' .column-checkbox').length === 2", TA)
    got = page.evaluate("""(id) => [...document.querySelectorAll('#cell-group-content-' + id + ' .form-check')].map(row => {
        const b = row.querySelector('.column-checkbox'); const note = row.querySelector('.az-option-note');
        return [b.dataset.key, b.disabled, note ? note.textContent : null,
                note ? b.getAttribute('aria-describedby') === note.id : null]; })""", TA)
    assert sorted(got, key=lambda r: r[0]) == [[GA, False, "Can't be filtered here: Grouping 1 depends on this table", True],
                                              [GB, False, None, None]], got
    _open_chooser(page)
    _shot(page, "g10-menu-loop-light")
    # it can be shown: each cell's group beside its row, with no loop
    for key in (GA, GB):
        page.evaluate("([id, k]) => document.querySelector('#cell-group-content-' + id + ' .column-checkbox[data-key=\"' + k + '\"]').click()", [TA, key])
    page.click(f"#apply-columns-{TA}")
    until(page, "(box) => ['Grouping 1', 'Grouping 2'].every(t => [...document.querySelectorAll(box + ' .dataTables_scrollHead th')].some(th => th.textContent.trim().startsWith(t)))", BOX)
    _filled(page, _index(page, "Grouping 1"))
    _filled(page, _index(page, "Grouping 2"))
    assert set(_all(page, _index(page, "Grouping 1"))) == {f"in Table 1 | {t}" for t in TYPES}
    assert _notice(page) is None
    assert _status(page)["state"] == "ready"
    n = len(_computes(page))
    waits.expect_stays(lambda: len(_computes(page)) == n, "showing the column must not set off computations; there is no event for none", page=page)
    # it is absent from the condition builder (by keyboard: Enter on Add condition); the other grouping is there
    names = _builder_columns(page, keyboard=True)
    assert "Grouping 2" in names and "cell_type" in names, names
    assert "Grouping 1" not in names, names
    assert "Grouping 1" not in _builder_columns(page), "by mouse as well"


# ------------------------------------------------------------------ 7. a loop from a link

def test_a_table_filtering_on_a_grouping_built_from_it_shows_the_cycle_state_from_a_link(page, served):
    ring = {TA: _table([OBS_TYPE, by(GA)], searchBuilderConfig=equals(GA, "Grouping 1", "in Table 1 | B cell")),
            GA: _grouping(partitionings=[{"source": {"type": "table", "key": TA}}, CELL_TYPE])}
    _open(page, served, ring, open_ids=(TA, GA))
    until(page, "(box) => { const el = document.querySelector(box + ' .score-notice'); return !!el && el.dataset.state === 'cycle'; }", BOX)
    note = _notice(page)
    assert note["text"].startswith("'Grouping 1' and 'Table 1' depend on each other."), note
    assert note["actions"] == ["score-open|Open grouping", "score-unfilter|Remove this filter"], note
    assert _held(page) == "Filter on 'Grouping 1' not applied. 'Grouping 1' and 'Table 1' depend on each other."
    assert "Grouping 1 (no groups)" in _headers(page)
    assert "no groups" in _api(page, "dt.cell(0, 2).render('display')"), "a cell says the column has no groups"
    assert page.evaluate("(box) => document.querySelector(box).classList.contains('az-score-held')", BOX), "the rows are held"
    assert page.evaluate("(id) => window.PanelManager.getPanel(id).isReady()", TA) is False, "no row is reported as passing"
    until(page, "(s) => { const e = document.querySelector(s + ' .cgrp-status'); return !!e && e.dataset.state === 'cycle'; }", A)
    assert _status(page)["text"] == "Grouping 1 and Table 1 depend on each other."
    waits.expect_stays(lambda: not _computes(page), "a loop must never reach the route; there is no event for nothing sent", page=page)
    _shot(page, "g10-cycle-light")
    _theme(page, "dark")
    _shot(page, "g10-cycle-dark")
    _theme(page, "light")
    # Remove this filter ends the loop: the conditions on the column go, the column stays, and the grouping computes
    page.click(f"{BOX} .score-notice [data-ps-action='score-unfilter']")
    until(page, "(box) => !document.querySelector(box + ' .score-notice') && !document.querySelector(box + ' .az-score-held-note')", BOX)
    cfg = page.evaluate("(id) => JSON.stringify(window.PanelManager.getPanel(id).getConfig().searchBuilderConfig || {})", TA)
    assert key_of(GA) not in cfg, cfg
    until(page, "(s) => document.querySelector(s + ' .cgrp-status').dataset.state === 'ready'", A)
    assert _computes(page), "the grouping computes once the loop is gone"
    assert "Grouping 1" in _headers(page), "the column stays"
    _filled(page, 2)
    assert set(_all(page, 2)) == {f"in Table 1 | {t}" for t in TYPES}
    assert "Grouping 1" not in _builder_columns(page), "and a condition on it cannot be made again"


# ------------------------------------------------------------------ 8. both themes

def test_the_column_reads_in_both_themes(page, served):
    two = {**CELL_TYPE, "levels": ["c:B cell", "c:T cell"], "rest": "exclude"}
    _open(page, served, {TA: _table([OBS_TYPE, by(GA)]), GA: _grouping(partitionings=[two])})
    _filled(page, 2)
    _theme(page, "light")
    colour = "(box) => getComputedStyle(document.querySelector(box + ' .dataTables_scrollBody tbody td:nth-child(3)')).color"
    light = page.evaluate(colour, BOX)
    _shot(page, "g10-column-light")
    _theme(page, "dark")
    until(page, "([box, was]) => getComputedStyle(document.querySelector(box + ' .dataTables_scrollBody tbody td:nth-child(3)')).color !== was", [BOX, light])
    _shot(page, "g10-column-dark")
    assert _headers(page)[2] == "Grouping 1"


# ------------------------------------------------------------------ 9. a saved value no row has now (hunk H)

def _subset_without(served, level, n=50):
    """A random subset of the link's form ({n, seed}) whose cells hold no `level` of cell_type, and its cell count."""
    from annzarro.tests.browser.test_focus_outside_subset import _api
    root, store = served
    kind = dict(zip(DATA_OBS_NAMES, DATA_CELL_TYPE))
    for seed in range(50):
        spec = {"n": n, "seed": seed}
        cells = _api(root, "cells", dataset_path=store, subset=json.dumps(spec))["cells"]
        if len(cells) == n and all(kind[c] != level for c in cells):
            return spec
    raise AssertionError(f"no seed below 50 gives {n} cells without {level}")


def test_a_saved_value_no_row_has_now_is_kept_and_shows_no_rows(page, served):
    import base64
    import urllib.parse
    spec = _subset_without(served, "Platelet")
    sb = {"logic": "AND", "criteria": [{"condition": "=", "data": "cell_type", "origData": "obs_cell_type_main", "type": "string",
                                        "value": ["Platelet"]}]}
    root, store = served
    tiles = [{"type": "tile", "id": TA, "controlsVisible": True}]
    view = {"v": 1, "subset": spec, "layout": {"v": 1, "hierarchy": tiles, "controlState": {TA: True},
                                               "panelConfigs": {TA: _table(searchBuilderConfig=sb)}}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    page.goto(f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={enc}")
    page.wait_for_selector(f"{BOX} .dataTables_scrollBody", state="attached", timeout=30000)
    until(page, "(box) => $(box + ' .dataTables_scrollBody table').DataTable().rows().count() === 50", BOX)
    assert page.evaluate("(box) => document.querySelector(box + ' .dtsb-criteria select.dtsb-value').value", BOX) == "Platelet", \
        "the condition keeps its value"
    assert _api(page, "dt.rows({search: 'applied'}).count()") == 0, "and shows no rows, as the link says"
    saved = page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig().searchBuilderConfig", TA)
    assert saved["criteria"][0]["value"] == ["Platelet"], saved
