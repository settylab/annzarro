"""The Gene Table has the same Undo as the Cell Table and the panels of 0.8.0 (table-utilities/table-undo.js).

Every change of its saved settings is one step: the filter, the rows per page, the search, the columns, and the Scores
offered it is a source of. Undo gives the settings before back and builds the table from them; the offer's readers follow.

1.  The button is disabled at the start; a Scores offered change and a filter change are steps; two undos return to the start.
2.  The rows per page is a step, and an undo returns the select to its default.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
from annzarro.tests.browser.test_gene_table_source import (  # noqa: E402,F401
    G, TAB, _filter, _open_table_link, _wait_coloured, page, served, until)

UNDO = f"{G} .table-undo"


def _enabled(page, title):
    until(page, "([s, t]) => { const b = document.querySelector(s); return !!b && !b.disabled && b.title === t; }", [UNDO, title])


def _empty(page):
    until(page, "(s) => { const b = document.querySelector(s); return !!b && b.disabled && b.title === 'Nothing to undo'; }", UNDO)


def _rows(page):
    """The genes the open table passes now."""
    return page.evaluate("""async (id) => { const { DataManager } = await import('/static/js/data-manager.js');
        const g = DataManager.getGenes(); return PanelManager.getPanel(id).getConfig().currentEntries.map(i => g[i]); }""", TAB)


def _config(page):
    return page.evaluate("(id) => { const c = PanelManager.getPanel(id).getConfig(); return { scoreOptions: c.scoreOptions || null, pageLength: c.pageLength || null }; }", TAB)


def test_the_gene_table_has_undo_for_its_offer_and_its_filter_and_two_undos_return_to_the_start(page, served):
    _open_table_link(page, served)
    _wait_coloured(page)
    page.wait_for_selector(UNDO)
    assert page.inner_text(UNDO) == "Undo" and page.is_disabled(UNDO)
    start_rows = _rows(page)
    # Scores offered: one box ticked is one step
    page.click(f"{G} .gsig-scoring__toggle")
    page.click(f"{G} [data-offer-method='detected']")
    _enabled(page, "Undo: change the scores offered")
    assert _config(page)["scoreOptions"] is not None
    # the filter
    _filter(page, 3)
    _enabled(page, "Undo: change the filter")
    assert len(_rows(page)) == 3
    page.click(UNDO)
    until(page, "(id) => PanelManager.getPanel(id).getConfig().currentEntries.length === %d" % len(start_rows), TAB)
    _enabled(page, "Undo: change the scores offered")
    assert _config(page)["scoreOptions"] is not None, "the offer stays while only the filter is undone"
    page.click(UNDO)
    until(page, "(id) => !PanelManager.getPanel(id).getConfig().scoreOptions", TAB)
    assert _rows(page) == start_rows
    _empty(page)


def test_the_rows_per_page_is_a_step_and_undo_returns_the_select(page, served):
    _open_table_link(page, served)
    _wait_coloured(page)
    page.wait_for_selector(UNDO)
    page.select_option(f"#table-length-{TAB}", "50")
    _enabled(page, "Undo: change the rows per page")
    assert _config(page)["pageLength"] == 50
    page.click(UNDO)
    until(page, "(id) => !PanelManager.getPanel(id).getConfig().pageLength", TAB)
    assert page.input_value(f"#table-length-{TAB}") == "25"
    _empty(page)
