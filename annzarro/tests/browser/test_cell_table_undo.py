"""The Cell Table has the same Undo as the panels of 0.8.0 (static/js/panels/table-utilities/table-undo.js).

Every change of the table's saved settings is one step: the columns, the filter, the search, the rows per page, Methods ▾.
Undo gives the settings before back and builds the table from them. Not steps: scroll, page, sort (the DataTable's own, in no
saved view), the controls being shown or hidden.

1.  Two changes, two undos back to the start; the button is disabled at the start and says what it undoes.
2.  The filter and the rows per page are steps.
3.  A config that arrives from outside (Back and Forward) forgets the steps: Undo never goes to an unrelated state, and
    Back and Forward still work.
4.  Undo asks nothing of the server that a link would not.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
from annzarro.tests.browser.test_group_table_column import (  # noqa: E402,F401
    BOX, OBS_TYPE, SIZES, T, TA, TYPES, _headers, _open, _table, equals, key_of, page, served)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

UNDO = f"{T} .table-undo"


def _config(page):
    return page.evaluate("(id) => { const c = window.PanelManager.getPanel(id).getConfig(); return { columns: c.columns.map(x => x.key), searchText: c.searchText, pageLength: c.pageLength || null }; }", TA)


def _ready(page, columns=None):
    page.wait_for_selector(UNDO)
    until(page, "(box) => document.querySelectorAll(box + ' .dataTables_scrollBody tbody tr').length > 0", BOX)


def _tick_condition(page):
    page.evaluate("""(id) => { const b = document.querySelector('.tile[data-tile-id="' + id + '"] .column-checkbox[data-key="condition"]'); b.click(); }""", TA)
    page.click(f"#apply-columns-{TA}")
    until(page, "(box) => [...document.querySelectorAll(box + ' .dataTables_scrollHead th')].some(th => th.textContent.trim().startsWith('condition'))", BOX)


def _enabled(page, title):
    until(page, "([s, t]) => { const b = document.querySelector(s); return !!b && !b.disabled && b.title === t; }", [UNDO, title])


def _empty(page):
    until(page, "(s) => { const b = document.querySelector(s); return !!b && b.disabled && b.title === 'Nothing to undo'; }", UNDO)


def test_two_changes_two_undos_back_to_the_start_and_the_button_says_what_it_undoes(page, served):
    _open(page, served, {TA: _table([OBS_TYPE])})
    _ready(page)
    assert page.inner_text(UNDO) == "Undo"
    assert page.is_disabled(UNDO) and page.get_attribute(UNDO, "title") == "Nothing to undo"
    start = _config(page)
    _tick_condition(page)
    _enabled(page, "Undo: change the columns")
    page.fill(f'{T} input[type="search"]', "Monocyte")
    _enabled(page, "Undo: search")
    assert "condition" in _config(page)["columns"]
    assert _config(page)["searchText"] == "Monocyte"
    page.click(UNDO)
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().searchText === ''", TA)
    _enabled(page, "Undo: change the columns")
    assert "condition" in _config(page)["columns"], "the columns stay while only the search is undone"
    page.click(UNDO)
    until(page, "(box) => ![...document.querySelectorAll(box + ' .dataTables_scrollHead th')].some(th => th.textContent.trim().startsWith('condition'))", BOX)
    assert _config(page) == start
    _empty(page)


NK = {"logic": "AND", "criteria": [{"condition": "=", "data": "cell_type", "origData": "obs_cell_type_main", "type": "string", "value": ["NK cell"]}]}


def _rows(page):
    return page.evaluate("(box) => $(box + ' .dataTables_scrollBody table').DataTable().rows({search: 'applied'}).count()", BOX)


def test_a_filter_and_the_rows_per_page_are_steps(page, served):
    _open(page, served, {TA: _table([OBS_TYPE], searchBuilderConfig=NK)})
    _ready(page)
    until(page, "(box) => $(box + ' .dataTables_scrollBody table').DataTable().rows({search: 'applied'}).count() === %d" % SIZES["NK cell"], BOX)
    # the filter: the condition's value is another cell type
    page.evaluate("""(box) => { const sel = document.querySelector(box + ' .dtsb-criteria select.dtsb-value');
        sel.value = [...sel.options].find(o => o.textContent.trim() === 'Monocyte').value; $(sel).trigger('change'); }""", BOX)
    _enabled(page, "Undo: change the filter")
    until(page, "(box) => $(box + ' .dataTables_scrollBody table').DataTable().rows({search: 'applied'}).count() === %d" % SIZES["Monocyte"], BOX)
    # the rows per page
    page.select_option(f"#table-length-{TA}", "50")
    _enabled(page, "Undo: change the rows per page")
    assert _config(page)["pageLength"] == 50
    page.click(UNDO)
    until(page, "(id) => !window.PanelManager.getPanel(id).getConfig().pageLength || window.PanelManager.getPanel(id).getConfig().pageLength === 25", TA)
    _enabled(page, "Undo: change the filter")
    assert _rows(page) == SIZES["Monocyte"], "the filter stays while only the page length is undone"
    page.click(UNDO)
    until(page, "(box) => $(box + ' .dataTables_scrollBody table').DataTable().rows({search: 'applied'}).count() === %d" % SIZES["NK cell"], BOX)
    _empty(page)


def _history_index(page):
    return page.evaluate("() => (history.state && history.state.azIdx) || 0")


def test_back_and_forward_still_work_and_forget_the_steps_so_undo_never_jumps(page, served):
    """Back and Forward rebuild the panels from the view they step to: the new panel has no steps (its Undo is disabled), so
    Undo can never go to a state unrelated to the one on screen. An undo is a change like any other to the address: it makes
    its own entry, which Back goes back from."""
    _open(page, served, {TA: _table([OBS_TYPE])})
    _ready(page)
    _tick_condition(page)
    _enabled(page, "Undo: change the columns")
    page.fill(f'{T} input[type="search"]', "Monocyte")
    _enabled(page, "Undo: search")
    until(page, "() => (history.state && history.state.azIdx || 0) >= 2")
    at = _history_index(page)
    # Undo reaches the address like any other change, and Back goes back from it
    page.click(UNDO)
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().searchText === ''", TA)
    until(page, "(n) => (history.state && history.state.azIdx || 0) > n", at)
    page.go_back()
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().searchText === 'Monocyte'", TA)
    _empty(page)
    # a step taken now is the only one: Undo goes back to the state this panel was rebuilt in, not to an older one
    page.fill(f'{T} input[type="search"]', "B cell")
    _enabled(page, "Undo: search")
    page.click(UNDO)
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().searchText === 'Monocyte'", TA)
    _empty(page)
    assert "condition" in _config(page)["columns"]
    # Forward still works
    page.go_forward()
    until(page, "() => (history.state && history.state.azIdx || 0) >= 1")
    assert page.locator(UNDO).count() == 1
