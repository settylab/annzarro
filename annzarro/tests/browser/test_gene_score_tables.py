"""The `gene-score` source as a column of a Cell Table, in a real browser (step 6 of the plan).

A Cell Table takes a signature's score as a column through its column chooser (each signature's add row: a
method on a layer, decision 31), appears at once, and fills the column in place when the score arrives. The values live
in the score store as a Float32Array and are read by row; a link or a panel set keeps the column's
reference only. A filter on a score that is not ready holds the table's rows, and the plots and
panels that read the table wait with it.

The store and the score route are those of test_gene_score_plots.py (60 cells; the page's `fetch`
is replaced for the score route where a test needs a slow, refused or failed score).

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1 (set in CI).
"""
import json
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_gene_score_plots import (  # noqa: E402,F401
    INIT, N_OBS, RAMP, S, SIG, _save_set, UMAP_X, UMAP_Y, _cell, _finish, _frame, _new_page, _served, _set_subset, _sig, _slow, _url, served,
)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

T = '.tile[data-tile-id="cell-table-T"]'
TID = "cell-table-T"
BOX = f"#table-container-{TID}"
SCORE_COL = {"type": "gene-score", "key": SIG, "column": "zscore_mean", "label": "T cell score"}
MEAN_COL = {"type": "gene-score", "key": SIG, "column": "mean", "label": "T cell score"}
OBS = {"type": "obs", "key": "score", "column": ""}


@pytest.fixture
def page(served):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = _new_page(browser)
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            if os.environ.get("ANNZ_DEBUG"):
                page.on("console", lambda m: print("CONSOLE", m.type, m.text[:300]) if m.type in ("error", "warning") else None)
            yield page
            assert not errors, errors
        finally:
            browser.close()


def _table(columns=(SCORE_COL, OBS), **extra):
    return {"id": TID, "title": "Cell Table 1", "columns": list(columns), **extra}


def _open(page, served, table=None, plots=(), sig=True, sig_open=False, wait=True, table_open=True, extra=None, **view):
    """A link: the Cell Table (open unless table_open is False), plots (id, config), the signature closed."""
    open_ids = [TID] if table_open else []
    cfgs = {TID: table or _table()}
    for pid, cfg in plots:
        open_ids.append(pid)
        cfgs[pid] = cfg
    if sig:
        cfgs[SIG] = _sig() if sig is True else sig
        if sig_open:
            open_ids.insert(0, SIG)
    cfgs.update(extra or {})
    page.goto(_url(served, open_ids, cfgs, **view))
    if wait and table_open:
        page.wait_for_selector(f"{BOX} .dataTables_scrollBody", state="attached", timeout=30000)


AGG_MENU = "[data-popover='aggregation']"


def add_row_entries(page, group):
    """What the add row's aggregation button lists: [{v, off, title, sym, name}]; the menu is closed again."""
    page.click(f"{group} .az-score-add-agg")
    page.locator(AGG_MENU).wait_for(state="visible")
    rows = page.evaluate("""() => [...document.querySelectorAll("[data-popover='aggregation'] [data-agg]")].map(r => ({ v: r.dataset.agg,
        off: r.disabled, title: r.title, on: r.getAttribute('aria-checked') === 'true', sym: r.querySelector('.axis-agg-sym').textContent,
        name: r.querySelector('.axis-agg-name').textContent }))""")
    page.keyboard.press("Escape")
    page.locator(AGG_MENU).wait_for(state="hidden")
    return rows


def pick_add_method(page, group, method):
    """Choose a method in the add row's aggregation button."""
    page.click(f"{group} .az-score-add-agg")
    page.locator(AGG_MENU).wait_for(state="visible")
    page.click(f"{AGG_MENU} [data-agg='{method}']")


def _add_score(page, sig=SIG, method="zscore_mean", layer="X", tid=TID):
    """Tick a score column through the chooser's add row, `[layer] [aggregation button] [Add column]` (decision 31):
    the tab lists a source's ticked columns only, never every method x layer pair."""
    group = f"#gene-score-content-{tid} .az-score-group[data-entity='{sig}']"
    page.select_option(f"{group} .az-score-add-layer", layer)
    pick_add_method(page, group, method)
    page.click(f"{group} .az-score-add-btn")
    assert page.is_checked(f"#checkbox-gene-score-{sig}-{method}-of-{layer}-{tid}")


def _headers(page):
    return page.evaluate("""(box) => [...document.querySelectorAll(box + ' .dataTables_scrollHead th')].map(th => th.textContent.replace(/\\s+/g, ' ').trim())""", BOX)


def _column(page, index):
    return page.evaluate("""([box, i]) => [...document.querySelectorAll(box + ' .dataTables_scrollBody tbody tr')]
        .map(tr => (tr.children[i] || {}).textContent).map(t => (t || '').trim())""", [BOX, index])


def _notice(page):
    return page.evaluate("""(box) => {
        const el = document.querySelector(box + ' .score-notice');
        if (!el) return null;
        return { state: el.dataset.state, text: el.textContent.replace(/\\s+/g, ' ').trim(),
                 actions: [...el.querySelectorAll('[data-ps-action]')].map(b => b.dataset.psAction + '|' + b.textContent.trim()) };
    }""", BOX)


def _wait_notice(page, state):
    until(page, """([box, state]) => { const el = document.querySelector(box + ' .score-notice'); return !!el && el.dataset.state === state; }""", [BOX, state])
    return _notice(page)


def _wait_no_notice(page):
    until(page, "(box) => !document.querySelector(box + ' .score-notice')", BOX)


def _calls(page, kind=None):
    calls = page.evaluate("() => window.__scoreCalls")
    return [c for c in calls if kind is None or c["kind"] == kind]


def _api(page, expr):
    return page.evaluate(f"() => {{ const dt = $('{BOX} .dataTables_scrollBody table').DataTable(); return ({expr}); }}")


def _wait_ready(page, index=2):
    until(page, """([box, i]) => { const c = [...document.querySelectorAll(box + ' .dataTables_scrollBody tbody tr')].map(tr => tr.children[i].textContent.trim());
        return c.length > 0 && c.every(t => t !== '' && !t.includes('computing') && !t.includes('no score') && !t.includes('not computed')); }""", [BOX, index])


# -------------------------------------------------------------------------- tests

def test_f9_the_column_appears_at_once_and_fills_in_place(page, served):
    _slow(page, "auto", 3)
    _open(page, served)
    # the table is there with the column in its state, before the score exists
    heads = _headers(page)
    assert heads[:3] == ["Cell ID", "score", "T cell score (computing)"], heads
    assert set(_column(page, 2)) == {"computing…"}
    until(page, "() => window.__ctls.length === 1")
    note = _wait_notice(page, "computing")
    assert "Computing 'T cell score'" in note["text"] and "score-cancel|Cancel" in note["actions"]
    # state a user would have set up: search, a page of 10, sorted by the other column
    page.evaluate("""(box) => { const dt = $(box + ' .dataTables_scrollBody table').DataTable(); dt.page.len(10).draw(); dt.order([1, 'desc']).draw(); dt.page(2).draw('page'); }""", BOX)
    before = _column(page, 0)
    _finish(page, 0)
    _wait_ready(page)
    assert _headers(page)[2] == "T cell score"
    values = [float(v) for v in _column(page, 2)]
    assert len(values) == 10
    # the table was not rebuilt: same page, same order, same rows
    assert _api(page, "dt.page()") == 2
    assert _api(page, "dt.order()[0][0] + dt.order()[0][1]") == "1desc"
    assert _column(page, 0) == before
    _wait_no_notice(page)
    assert len(_calls(page)) == 2, "one estimate and one computation; the fill asked for nothing"


def _ready_table(page, served, values=None, **kw):
    """A table whose score is ready, with the values the test gives (the ramp by default)."""
    _slow(page, "auto", 3)
    _open(page, served, **kw)
    until(page, "() => window.__ctls.length === 1")
    _finish(page, 0, values)
    _wait_ready(page)
    _wait_no_notice(page)


def _col(page, name):
    return _headers(page).index(name)


def test_the_chooser_lists_each_signature_with_an_add_row_and_takes_several_at_once(page, served):
    _slow(page, "auto", 3)
    second = {"id": "gene-signature-U", "title": "Other score", "genes": ["GENE0010", "GENE0011"]}
    _open(page, served, table=_table(columns=[OBS]), extra={"gene-signature-U": second})
    assert _headers(page)[:2] == ["Cell ID", "score"]
    page.click(f"#gene-score-tab-{TID}")
    groups = page.evaluate("(id) => [...document.querySelectorAll('#gene-score-content-' + id + ' .az-score-group')].map(g => ({ title: g.querySelector('.az-score-group-title').textContent, subs: [...g.querySelectorAll('label')].map(l => l.textContent) }))", TID)
    assert sorted(g["title"] for g in groups) == ["Other score", "T cell score"]
    assert all(g["subs"] == [] for g in groups), "nothing ticked: no method x layer pair is listed"
    methods = [len(add_row_entries(page, f"#gene-score-content-{TID} .az-score-group[data-entity='{sig}']")) for sig in (SIG, "gene-signature-U")]
    assert methods == [6, 6], "every method, in each source's add row"
    for sig, sub in ((SIG, "zscore_mean"), (SIG, "mean"), ("gene-signature-U", "zscore_mean")):
        _add_score(page, sig, sub, "X")
    page.click(f"#apply-columns-{TID}")
    until(page, "(box) => document.querySelectorAll(box + ' .dataTables_scrollHead th').length === 5", BOX)
    heads = _headers(page)
    assert heads[2:] == ["T cell score (computing)", "T cell score · mean (computing)", "Other score (computing)"], heads
    cfg = page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig().columns", TID)
    assert [(c["type"], c["key"], c["column"]) for c in cfg[1:]] == [("gene-score", SIG, "zscore_mean"), ("gene-score", SIG, "mean"),
                                                                   ("gene-score", "gene-signature-U", "zscore_mean")]
    # three scores: the same signature with two aggregations is two requests
    until(page, "() => window.__scoreCalls.filter(c => c.kind === 'estimate').length === 3")


def _state(page, index=2):
    """What the score column says and allows: header, first cells, sort and export."""
    return page.evaluate("""([box, i]) => {
        const th = document.querySelectorAll(box + ' .dataTables_scrollHead th')[i];
        const cells = [...document.querySelectorAll(box + ' .dataTables_scrollBody tbody tr')].map(tr => tr.children[i].textContent.trim());
        const button = document.querySelector('[id^="export-csv-"]');
        return { header: th.textContent.replace(/\\s+/g, ' ').trim(), cells: [...new Set(cells)], sortOff: th.classList.contains('az-sort-off'),
                 exportOff: button.disabled, exportNote: button.title || '' };
    }""", [BOX, index])


def _try_sort(page, index=2):
    """Click the header of a column and say what the table's order is afterwards."""
    before = _api(page, "JSON.stringify(dt.order())")
    page.click(f"{BOX} .dataTables_scrollHead th:nth-child({index + 1})", force=True)
    # a click on a column that cannot sort changes no order; there is no event for that
    page.wait_for_timeout(150)
    return before, _api(page, "JSON.stringify(dt.order())")


def _tag(page):
    return page.evaluate("""() => { const el = document.querySelector('.tile[data-tile-id="cell-table-T"] .ps-tag[data-tag="score"]'); return el ? el.textContent.trim() : null; }""")


def test_a_score_that_is_computing_says_so_and_turns_sort_and_export_off(page, served):
    _slow(page, "auto", 3)
    _open(page, served)
    until(page, "() => window.__ctls.length === 1")
    _wait_notice(page, "computing")
    st = _state(page)
    assert st["header"] == "T cell score (computing)" and st["cells"] == ["computing…"]
    assert st["sortOff"] and st["exportOff"]
    assert st["exportNote"] == "Available when 'T cell score' is ready"
    before, after = _try_sort(page)
    assert before == after, "a click on a column with no values sorts nothing"
    # the other columns still sort
    page.click(f"{BOX} .dataTables_scrollHead th:nth-child(2)")
    until(page, "(box) => $(box + ' .dataTables_scrollBody table').DataTable().order()[0][0] === 1", BOX)
    assert _api(page, "dt.order()[0][0]") == 1
    assert _tag(page) == "Score computing"


def test_a_cancelled_score_says_no_score_and_offers_compute_and_remove(page, served):
    _slow(page, "auto", 3)
    _open(page, served)
    until(page, "() => window.__ctls.length === 1")
    _wait_notice(page, "computing")
    page.click(f"{BOX} .score-notice [data-ps-action='score-cancel']")
    note = _wait_notice(page, "cancelled")
    assert "'T cell score' was cancelled." in note["text"]
    assert "This plot has no color" not in note["text"]
    assert [a.split("|")[0] for a in note["actions"]] == ["score-compute", "score-remove"], note["actions"]
    st = _state(page)
    assert st["header"] == "T cell score (no score)" and st["cells"] == ["no score"] and st["sortOff"] and st["exportOff"]
    assert "has no score" in st["exportNote"]
    # Compute asks again, and the same table fills in
    page.click(f"{BOX} .score-notice [data-ps-action='score-compute']")
    until(page, "() => window.__ctls.length === 2")
    _finish(page, 1)
    _wait_ready(page)
    _wait_no_notice(page)
    assert _state(page)["exportOff"] is False


def test_a_failed_score_offers_retry_and_remove_and_remove_takes_the_column_out(page, served):
    _slow(page, "auto", 3)
    _open(page, served)
    until(page, "() => window.__ctls.length === 1")
    page.evaluate("() => window.__error(0, 'read_failed', 'Failed to read the dataset: the server stopped responding')")
    note = _wait_notice(page, "failed")
    assert "'T cell score' could not be computed: Failed to read the dataset: the server stopped responding." in note["text"]
    assert [a.split("|")[0] for a in note["actions"]] == ["score-retry", "score-open", "score-remove"], note["actions"]
    page.click(f"{BOX} .score-notice [data-ps-action='score-retry']")
    until(page, "() => window.__ctls.length === 2")
    page.evaluate("() => window.__error(1, 'read_failed', 'again')")
    _wait_notice(page, "failed")
    page.click(f"{BOX} .score-notice [data-ps-action='score-remove']")
    until(page, "(box) => ![...document.querySelectorAll(box + ' .dataTables_scrollHead th')].some(th => th.textContent.includes('T cell score'))", BOX)
    assert page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig().columns.map(c => c.type)", TID) == ["obs"]
    assert page.locator(f"{BOX} .score-notice").count() == 0
    assert page.evaluate(f"() => document.getElementById('checkbox-gene-score-{SIG}-zscore_mean-of-X-{TID}').checked") is False


def test_a_refused_score_and_one_that_asks_first(page, served):
    _slow(page, "refused", 1500, refuse="This score would take about 25 minutes; the limit is 10. Use fewer genes.")
    _open(page, served)
    note = _wait_notice(page, "refused")
    assert "'T cell score' was not run: it is estimated at about 25 minutes" in note["text"] and "Use fewer genes." in note["text"]
    assert [a.split("|")[0] for a in note["actions"]] == ["score-open", "score-remove"]
    assert _state(page)["header"] == "T cell score (no score)"
    page.goto("about:blank")
    _slow(page, "confirm", 130)
    _open(page, served)
    note = _wait_notice(page, "awaiting")
    assert "'T cell score' will take about 2 minutes." in note["text"]
    assert [a.split("|")[0] for a in note["actions"]] == ["score-compute"]
    st = _state(page)
    assert st["header"] == "T cell score (not computed)" and st["cells"] == ["not computed"] and st["exportOff"]
    assert len(_calls(page, "compute")) == 0, "nothing is computed without the click"
    page.click(f"{BOX} .score-notice [data-ps-action='score-compute']")
    until(page, "() => window.__ctls.length === 1")
    _finish(page, 0)
    _wait_ready(page)


def test_a_deleted_signature_says_deleted_and_keeps_its_column_until_removed(page, served):
    _ready_table(page, served, sig_open=True)
    page.evaluate("() => window.PanelManager.removePanel('gene-signature-S')")
    note = _wait_notice(page, "deleted")
    assert "Signature 'T cell score' was deleted." in note["text"]
    assert [a.split("|")[0] for a in note["actions"]] == ["score-remove"]
    st = _state(page)
    assert st["header"] == "T cell score (deleted)" and st["cells"] == ["no score"] and st["exportOff"]
    # the table keeps the column (and the chooser lists it) until the user removes it
    assert [c["type"] for c in page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig().columns", TID)] == ["obs", "gene-score"]
    page.click(f"{BOX} .score-notice [data-ps-action='score-remove']")
    until(page, "(box) => document.querySelectorAll(box + ' .dataTables_scrollHead th').length === 2", BOX)


def test_an_update_shows_the_previous_values_with_sort_on_and_export_off_until_it_is_done(page, served):
    _ready_table(page, served, sig_open=True)
    before = _column(page, 2)
    _slow(page, "auto", 1)
    page.evaluate("() => window.PanelManager.getPanel('gene-signature-S').addGenes(['GENE0100'])")
    until(page, "() => window.__ctls.length === 2")
    note = _wait_notice(page, "updating")
    assert "Showing the previous 'T cell score'. Updating." in note["text"]
    st = _state(page)
    assert st["header"] == "T cell score (updating)" and not st["sortOff"] and st["exportOff"]
    assert st["exportNote"] == "Available when 'T cell score' is updated"
    assert _column(page, 2) == before, "previous values stay"
    page.click(f"{BOX} .dataTables_scrollHead th:nth-child(3)")
    until(page, "(box) => $(box + ' .dataTables_scrollBody table').DataTable().order()[0][0] === 2", BOX)
    assert _api(page, "dt.order()[0][0]") == 2, "sort works on the previous values"
    _finish(page, 1, [float(v) * 2 for v in RAMP])
    until(page, "([box, b]) => { const v = [...document.querySelectorAll(box + ' .dataTables_scrollBody tbody tr')].map(tr => tr.children[2].textContent.trim()); return v.join() !== b.join() && !v.some(x => x.includes('comp')); }", [BOX, before])
    _wait_no_notice(page)
    assert _state(page)["header"] == "T cell score" and _state(page)["exportOff"] is False
    assert _api(page, "dt.order()[0][0]") == 2, "the sort stays through the update"


def test_sort_works_on_a_score_and_a_page_or_sort_change_asks_for_nothing(page, served):
    _ready_table(page, served, values=[float(i * 7 % 60) for i in range(N_OBS)])
    n = len(_calls(page))
    page.click(f"{BOX} .dataTables_scrollHead th:nth-child(3)")
    until(page, "(box) => document.querySelector(box + ' .dataTables_scrollHead th:nth-child(3)').classList.contains('sorting_asc')", BOX)
    up = [float(v) for v in _column(page, 2)]
    assert up == sorted(up) and up[0] == 0.0
    page.click(f"{BOX} .dataTables_scrollHead th:nth-child(3)")
    until(page, "(box) => document.querySelector(box + ' .dataTables_scrollHead th:nth-child(3)').classList.contains('sorting_desc')", BOX)
    down = [float(v) for v in _column(page, 2)]
    assert down == sorted(down, reverse=True) and down[0] == 59.0
    _api(page, "dt.page(1).draw('page')")
    _api(page, "dt.page.len(10).draw()")
    # time for a score request, were one going to; sorting and paging should ask for none
    page.wait_for_timeout(300)
    assert len(_calls(page)) == n, "sort, page and page length asked for no score"
    # the values cells show are the ones that came, by cell (row c0 has score 0 in the ramp)
    _api(page, "dt.order([0, 'asc']).page(0).draw()")
    first = _column(page, 0)[0]
    assert first == "c0"
    assert float(_column(page, 2)[0]) == 0.0
    assert float(_column(page, 2)[_column(page, 0).index("c1")]) == 7.0


def _criterion(op, value):
    return {"condition": op, "data": "T cell score", "origData": "gene-score_" + SIG + "_zscore_mean", "type": "num", "value": [str(value)]}


def test_a_score_filters_by_a_searchbuilder_condition_and_by_the_search_box(page, served):
    sb = {"logic": "AND", "criteria": [_criterion(">", 49.5)]}
    _slow(page, "auto", 3)
    _open(page, served, table=_table(searchBuilderConfig=sb))
    until(page, "() => window.__ctls.length === 1")
    # a filter on a score that is not ready holds the rows
    assert page.evaluate("(box) => document.querySelector(box).classList.contains('az-score-held')", BOX)
    note = page.inner_text(f"{BOX} .az-score-held-note")
    assert "Filter on 'T cell score' not applied yet." in note and "Rows appear when the score is ready." in note
    assert not page.locator(f"{BOX} .dataTables_info").is_visible(), "the Showing count is hidden"
    assert not page.locator(f"{BOX} .dataTables_scrollBody").is_visible(), "no rows are shown"
    _finish(page, 0)
    until(page, "(box) => !document.querySelector(box).classList.contains('az-score-held')", BOX)
    assert _api(page, "dt.rows({search: 'applied'}).count()") == 10     # 50..59
    assert "Showing 1 to 10 of 10 entries" in page.inner_text(f"{BOX} .dataTables_info")
    assert sorted(float(v) for v in _column(page, 2)) == [float(i) for i in range(50, 60)]
    # the search matches the score's text: of the column, and in the box (which spans every column)
    page.evaluate("(box) => { const dt = $(box + ' .dataTables_scrollBody table').DataTable(); dt.column(2).search('^57$', true, false).draw(); }", BOX)
    assert _api(page, "dt.rows({search: 'applied'}).count()") == 1
    assert _column(page, 2) == ["57"]
    page.evaluate("(box) => { const dt = $(box + ' .dataTables_scrollBody table').DataTable(); dt.column(2).search('').draw(); }", BOX)
    page.fill(f"{BOX} .dataTables_filter input", "c5")
    until(page, "(box) => $(box + ' .dataTables_scrollBody table').DataTable().rows({search: 'applied'}).count() === 10", BOX)
    assert _api(page, "dt.rows({search: 'applied'}).count()") == 10, "c50 to c59 pass both the score condition and the text"
    page.fill(f"{BOX} .dataTables_filter input", "57")
    until(page, "(box) => $(box + ' .dataTables_scrollBody table').DataTable().rows({search: 'applied'}).count() === 1", BOX)
    assert _api(page, "dt.rows({search: 'applied'}).count()") == 1


def test_export_writes_the_score_column_when_it_is_ready(page, served, tmp_path):
    _ready_table(page, served, values=[i / 3 for i in range(N_OBS)])
    with page.expect_download() as info:
        page.click(f"#export-csv-{TID}")
    path = tmp_path / "t.csv"
    info.value.save_as(str(path))
    lines = path.read_text().strip().splitlines()
    assert lines[0].replace('"', "") == "Cell ID,score,T cell score · z-score mean · X"
    row = {l.replace('"', "").split(",")[0]: l.replace('"', "").split(",") for l in lines[1:]}
    assert len(row) == N_OBS
    assert float(row["c3"][2]) == pytest.approx(1.0, abs=1e-6)
    assert row["c3"][2] == "1", "float32 noise is not written: " + row["c3"][2]
    assert float(row["c10"][2]) == pytest.approx(10 / 3, abs=1e-5)
    # the export is the DATA, not the display (what test_csv_export_uses_data_not_display protects): no markup in any
    # cell, every value a number, and not rounded to the 4 decimals the table shows
    assert "<" not in path.read_text() and "&lt;" not in path.read_text(), "no display HTML in the file"
    for cells in row.values():
        assert all(float(v) == float(v) for v in cells[1:]), cells
    assert len(row["c10"][2].split(".")[1]) > 4, "full precision, as the data has it: " + row["c10"][2]


def test_export_writes_two_score_columns_of_one_source_with_their_full_headers(page, served, tmp_path):
    counts = {**MEAN_COL, "layer": "counts"}
    _open(page, served, table=_table(columns=(SCORE_COL, counts)), sig=_sig(layers=["X", "counts"]))
    until(page, "(box) => { const th = [...document.querySelectorAll(box + ' .dataTables_scrollHead th')].map(t => t.textContent.trim());"
                " return th.length === 3 && !th.some(t => /computing|not computed|no score/.test(t)); }", BOX)
    with page.expect_download() as info:
        page.click(f"#export-csv-{TID}")
    path = tmp_path / "two.csv"
    info.value.save_as(str(path))
    lines = path.read_text().strip().splitlines()
    assert lines[0].replace('"', "") == "Cell ID,T cell score · z-score mean · X,T cell score · mean · counts"
    assert len(lines) == N_OBS + 1
    first = lines[1].replace('"', "").split(",")
    assert first[0] == "c0" and all(float(v) == float(v) for v in first[1:])
    assert first[1] != first[2], "two options, two different scores"


# ------------------------------------------------------------ the chain: plot <- table <- score

P = '.tile[data-tile-id="cell-plot-C"]'
PLAIN = {"type": "obs", "key": "score", "column": ""}
FILTERED = {"condition": ">", "data": "T cell score", "origData": "gene-score_" + SIG + "_zscore_mean", "type": "num", "value": ["49.5"]}


def _plot(table=TID, **extra):
    return ("cell-plot-C", _cell("cell-plot-C", color=PLAIN, tableFilter=table, removeNonTableEntries=True, **extra))


def _plot_state(page):
    return page.evaluate("""(P) => {
        const gd = document.querySelector(P + ' .js-plotly-plot');
        const names = gd && gd.data ? gd.data.flatMap(t => Array.from(t.customdata || [])).map(v => Array.isArray(v) ? v[0] : v).map(String) : null;
        const tag = document.querySelector(P + ' .ps-tag[data-tag="table-unresolved"]');
        const notice = document.querySelector(P + ' .filter-notice');
        return { names, tag: tag ? tag.textContent.trim() : null, state: notice ? notice.dataset.state : null,
                 text: notice ? notice.textContent.replace(/\\s+/g, ' ').trim() : null,
                 actions: [...document.querySelectorAll(P + ' .filter-notice [data-ps-action]')].map(b => b.dataset.psAction + '|' + b.textContent.trim()),
                 calls: window.__scoreCalls.length };
    }""", P)


def _wait_plot(page, n):
    until(page, """([P, n]) => { const gd = document.querySelector(P + ' .js-plotly-plot');
        if (!gd || !gd.data || document.querySelector(P + ' .filter-notice')) return false;
        return gd.data.flatMap(t => Array.from(t.customdata || [])).length === n; }""", [P, n])


def test_a_plot_filtered_by_a_table_whose_filter_waits_for_a_score_waits_and_draws_no_cells(page, served):
    sb = {"logic": "AND", "criteria": [FILTERED]}
    _slow(page, "auto", 3)
    _open(page, served, table=_table(searchBuilderConfig=sb), plots=(_plot(),))
    until(page, "() => window.__ctls.length === 1")
    page.wait_for_selector(f"{P} .filter-notice[data-state='unresolved']", timeout=30000)
    st = _plot_state(page)
    assert st["tag"] == "Waiting for score", st
    assert "Filtering by 'Cell Table 1' needs 'T cell score', which is not ready yet. No cells are drawn until it is." in st["text"]
    assert st["names"] in (None, []), "an unresolved filter draws no points, not the unfiltered cells"
    assert page.evaluate("(id) => window.PanelManager.getPanel(id).isReady()", TID) is False
    assert [a.split("|")[0] for a in st["actions"]][0] == "table-score-cancel"
    # the table holds its rows too
    assert page.evaluate("(box) => document.querySelector(box).classList.contains('az-score-held')", BOX)
    _finish(page, 0)
    _wait_plot(page, 10)
    st = _plot_state(page)
    assert sorted(st["names"]) == sorted(f"c{i}" for i in range(50, 60)), "the cells of the table's filter, and only those"
    assert st["tag"] is None and st["state"] is None
    assert page.evaluate("(id) => window.PanelManager.getPanel(id).isReady()", TID) is True
    assert len(_calls(page, "compute")) == 1


def test_a_failed_score_leaves_the_table_and_its_plot_not_applied_with_the_reason_and_a_way_out(page, served):
    sb = {"logic": "AND", "criteria": [FILTERED]}
    _slow(page, "auto", 3)
    _open(page, served, table=_table(searchBuilderConfig=sb), plots=(_plot(),))
    until(page, "() => window.__ctls.length === 1")
    page.evaluate("() => window.__error(0, 'read_failed', 'the server stopped responding')")
    page.wait_for_selector(f"{P} .filter-notice[data-state='unresolved']", timeout=30000)
    until(page, "(P) => { const t = document.querySelector(P + ' .ps-tag[data-tag=\"table-unresolved\"]'); return !!t && t.textContent.trim() === 'Filter not applied'; }", P)
    st = _plot_state(page)
    assert "'T cell score' could not be computed: the server stopped responding." in st["text"] and "No cells are drawn." in st["text"]
    assert [a.split("|")[0] for a in st["actions"]] == ["table-score-retry", "table-filter-off"], st["actions"]
    held = page.inner_text(f"{BOX} .az-score-held-note")
    assert "Filter on 'T cell score' not applied." in held and "could not be computed" in held
    assert st["names"] in (None, [])
    # Retry asks again, and everything resolves
    page.click(f"{P} .filter-notice [data-ps-action='table-score-retry']")
    until(page, "() => window.__ctls.length === 2")
    _finish(page, 1)
    _wait_plot(page, 10)


def test_a_score_that_asks_first_is_computed_by_a_click_in_the_plot(page, served):
    sb = {"logic": "AND", "criteria": [FILTERED]}
    _slow(page, "confirm", 130)
    _open(page, served, table=_table(searchBuilderConfig=sb), plots=(_plot(),))
    page.wait_for_selector(f"{P} .filter-notice[data-state='unresolved']", timeout=30000)
    st = _plot_state(page)
    assert "which has not been computed" in st["text"]
    assert [a.split("|")[0] for a in st["actions"]][0] == "table-score-compute"
    assert len(_calls(page, "compute")) == 0
    page.click(f"{P} .filter-notice [data-ps-action='table-score-compute']")
    until(page, "() => window.__ctls.length === 1")
    _finish(page, 0)
    _wait_plot(page, 10)


def test_a_closed_table_restored_from_a_link_resolves_its_score_first_then_its_filter(page, served):
    sb = {"logic": "AND", "criteria": [FILTERED]}
    _slow(page, "auto", 3)
    _open(page, served, table=_table(searchBuilderConfig=sb), plots=(_plot(),), table_open=False, wait=False)
    page.wait_for_selector(f"{P} .filter-notice[data-state='unresolved']", timeout=30000)
    until(page, "() => window.__ctls.length === 1")
    assert page.evaluate("() => window.PanelManager.getActivePanels().map(p => p.getId())") == ["cell-plot-C"], "the table is closed"
    until(page, "(P) => { const t = document.querySelector(P + ' .ps-tag[data-tag=\"table-unresolved\"]'); return !!t && t.textContent.trim() === 'Waiting for score'; }", P)
    st = _plot_state(page)
    assert st["names"] in (None, [])
    assert "Filtering by 'Cell Table 1' needs 'T cell score'" in st["text"]
    _finish(page, 0)
    _wait_plot(page, 10)
    st = _plot_state(page)
    assert sorted(st["names"]) == sorted(f"c{i}" for i in range(50, 60))
    # one estimate and one computation for the score; the table was never opened
    assert [c["kind"] for c in _calls(page)] == ["estimate", "compute"]
    assert page.evaluate("() => window.PanelManager.getActivePanels().map(p => p.getId())") == ["cell-plot-C"]
    # the selection is names (the closed table's), never the score's values
    sel = page.evaluate("(id) => { const c = window.PanelManager.getPanel(id).getConfig().closedSelection; return c ? Array.from(c.passing).length : null; }", TID)
    assert sel == 10


def test_a_closed_table_follows_an_edit_of_the_signature_it_filters_on(page, served):
    sb = {"logic": "AND", "criteria": [FILTERED]}
    _slow(page, "auto", 3)
    _open(page, served, table=_table(searchBuilderConfig=sb), plots=(_plot(),), table_open=False, sig_open=True, wait=False)
    until(page, "() => window.__ctls.length === 1")
    _finish(page, 0)
    _wait_plot(page, 10)
    # the edit makes a new score (the cells ranked the other way): the plot's cells change with it
    page.evaluate("() => window.PanelManager.getPanel('gene-signature-S').addGenes(['GENE0100'])")
    until(page, "() => window.__ctls.length === 2")
    _finish(page, 1, [float(N_OBS - 1 - i) for i in range(N_OBS)])
    until(page, """(P) => { const gd = document.querySelector(P + ' .js-plotly-plot'); if (!gd || !gd.data) return false;
        const n = gd.data.flatMap(t => Array.from(t.customdata || [])).map(v => Array.isArray(v) ? v[0] : v).map(String);
        return n.length === 10 && n.includes('c0') && n.includes('c9') && !n.includes('c59'); }""", P)


def test_a_cycle_through_a_table_with_a_score_filter_stops_resolution_and_computes_nothing(page, served):
    sb = {"logic": "AND", "criteria": [FILTERED]}
    other = {"id": "cell-table-U", "title": "Cell Table 2", "columns": [OBS], "tableFilter": TID}
    _slow(page, "auto", 3)
    _open(page, served, table=_table(searchBuilderConfig=sb, tableFilter="cell-table-U"), plots=(_plot(),), table_open=False,
          extra={"cell-table-U": other}, wait=False)
    page.wait_for_selector(f"{P} .filter-notice[data-state='unresolved']", timeout=30000)
    until(page, "(P) => { const t = document.querySelector(P + ' .ps-tag[data-tag=\"table-unresolved\"]'); return !!t && t.textContent.trim() === 'Filter not applied'; }", P)
    st = _plot_state(page)
    assert "'Cell Table 1' and 'Cell Table 2' depend on each other. No cells are drawn." in st["text"], st["text"]
    # time for a score request, were one going to; a cycle asks for none
    page.wait_for_timeout(500)
    assert page.evaluate("() => window.__scoreCalls.length") == 0, "a cycle asks for no score"
    assert page.evaluate("() => window.__ctls.length") == 0


def test_a_link_keeps_the_column_reference_and_no_value(page, served):
    sb = {"logic": "AND", "criteria": [FILTERED]}
    _ready_table(page, served, table=_table(searchBuilderConfig=sb))
    view = page.evaluate("() => (window.SessionManager || window.sessionManager).captureView()")
    text = json.dumps(view)
    cfg = view["layout"]["panelConfigs"][TID]
    assert [(c["type"], c["key"], c["column"]) for c in cfg["columns"]] == [("obs", "score", ""), ("gene-score", SIG, "zscore_mean")]
    assert cfg["searchBuilderConfig"]["criteria"][0]["origData"] == "gene-score_" + SIG + "_zscore_mean__of_X", "migrated with its column"
    assert "Float32" not in text and '"values"' not in text
    assert "currentEntries" not in text and "closedSelection" not in text
    assert len(text) < 5000, "sixty scores would be hundreds of digits more"
    # a new page opens it: the column is there and computes again; the values did not travel
    other = page.context.browser.new_page(viewport={"width": 1500, "height": 1000})
    other.add_init_script(INIT)
    other.add_init_script("window.__slow('auto', 3, {})")
    try:
        other.goto(page.url)
        other.wait_for_selector(f"{BOX} .dataTables_scrollBody", state="attached", timeout=30000)
        until(other, "() => window.__ctls.length === 1")
        assert _headers(other)[2] == "T cell score (computing)"
        assert [c["kind"] for c in _calls(other)] == ["estimate", "compute"]
        _finish(other, 0)
        _wait_ready(other)
        assert _api(other, "dt.rows({search: 'applied'}).count()") == 10
    finally:
        other.close()


def test_a_closed_table_with_a_score_column_comes_back_from_a_link_and_opens_with_its_column(page, served):
    sb = {"logic": "AND", "criteria": [FILTERED]}
    _slow(page, "auto", 3)
    _open(page, served, table=_table(searchBuilderConfig=sb), plots=(_plot(),))
    until(page, "() => window.__ctls.length === 1")
    _finish(page, 0)
    _wait_plot(page, 10)
    page.evaluate("(id) => window.PanelManager.closePanel(id)", TID)
    until(page, "(id) => !window.PanelManager.getActivePanels().some(p => p.getId() === id)", TID)
    view = page.evaluate("() => (window.SessionManager || window.sessionManager).captureView()")
    assert TID not in json.dumps(view["layout"]["hierarchy"]), "closed"
    cfg = view["layout"]["panelConfigs"][TID]
    assert cfg["columns"][1]["type"] == "gene-score" and "closedSelection" not in cfg
    # the link: the table is closed there too, and the plot resolves through the score, with no table open
    fresh = page.context.browser.new_page(viewport={"width": 1500, "height": 1000})
    fresh.add_init_script(INIT)
    fresh.add_init_script("window.__slow('auto', 3, {})")
    try:
        fresh.goto(page.url)
        fresh.wait_for_selector(f"{P} .filter-notice[data-state='unresolved']", timeout=30000)
        until(fresh, "() => window.__ctls.length === 1")
        _finish(fresh, 0)
        _wait_plot(fresh, 10)
        # opening it shows the column, filled from the score the plot already needed (one computation)
        fresh.evaluate("(id) => window.PanelManager.reopenClosedPanel(id, { nextTo: 'cell-plot-C' })", TID)
        fresh.wait_for_selector(f"{BOX} .dataTables_scrollBody", state="attached", timeout=30000)
        _wait_ready(fresh)
        assert len(_calls(fresh, "compute")) == 1
        assert _headers(fresh)[2] == "T cell score"
    finally:
        fresh.close()


def test_the_column_chooser_adds_the_score_to_a_cell_table_and_a_table_that_has_it_shows_it_ticked(page, served):
    _slow(page, "auto", 3)
    _open(page, served, table=_table(columns=[OBS]), sig_open=True)
    page.wait_for_selector(f"{S} .gsig-grid .gsig-row", timeout=30000)
    assert page.locator(f"{S} .gsig-usein").count() == 0, "the signature panel has no Use in menu"
    page.click(f"#gene-score-tab-{TID}")
    _add_score(page)
    page.click(f"#apply-columns-{TID}")
    until(page, "(box) => document.querySelectorAll(box + ' .dataTables_scrollHead th').length === 3", BOX)
    assert _headers(page)[2] == "T cell score (computing)"
    cfg = page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig().columns", TID)
    assert [(c["type"], c["key"], c["column"]) for c in cfg] == [("obs", "score", ""), ("gene-score", SIG, "zscore_mean")]
    until(page, "() => window.__ctls.length === 1")
    _finish(page, 0)
    _wait_ready(page)
    assert page.evaluate(f"() => document.getElementById('checkbox-gene-score-{SIG}-zscore_mean-of-X-{TID}').checked") is True


def test_new_cells_keep_the_table_and_the_column_asks_for_its_own_score(page, served):
    _ready_table(page, served)
    page.evaluate("""(box) => { const dt = $(box + ' .dataTables_scrollBody table').DataTable(); dt.page.len(10).draw(); dt.order([1, 'desc']).draw(); }""", BOX)
    _set_subset(page, True, 30)
    until(page, "() => window.__ctls.length === 2")
    until(page, "(box) => document.querySelectorAll(box + ' .dataTables_scrollBody tbody tr').length > 0", BOX)
    assert _api(page, "dt.rows().count()") == 30
    assert _headers(page)[2] == "T cell score (computing)", "the old score is for the other cells"
    assert set(_column(page, 2)) == {"computing\u2026"}
    assert _api(page, "dt.page.len()") == 10 and _api(page, "dt.order()[0][0]") == 1, "the table was kept, not rebuilt"
    computes = _calls(page, "compute")
    assert len(computes) == 2 and computes[1]["subset"] is not None and computes[0]["subset"] is None
    _finish(page, 1, [float(i) for i in range(30)])
    _wait_ready(page)
    assert max(float(v) for v in _column(page, 2)) <= 29.0


def test_added_panels_that_need_new_ids_keep_a_tables_score_column_and_its_condition_with_their_signature(page, served):
    sb = {"logic": "AND", "criteria": [FILTERED]}
    _ready_table(page, served, table=_table(searchBuilderConfig=sb))
    _save_set(page, "remap-table")
    page.click("#btn-load-session")
    page.locator(".session-card[data-session-name='remap-table'] .session-add-closed").first.click()
    page.wait_for_function("() => PanelManager.getAllPanels().length === 4", timeout=30000)
    got = page.evaluate("""() => PanelManager.getAllPanels().filter(p => p.getType() === 'cell-table').map(p => {
        const c = p.getConfig(); return [p.getId(), c.columns.filter(x => x.type === 'gene-score').map(x => x.key), JSON.stringify(c.searchBuilderConfig)]; })""")
    sigs = page.evaluate("() => PanelManager.getAllPanels().filter(p => p.getType() === 'gene-signature').map(p => p.getId())")
    assert len(sigs) == 2 and sigs[0] == SIG and sigs[1] != SIG
    old = [g for g in got if g[0] == TID][0]
    new = [g for g in got if g[0] != TID][0]
    assert old[1] == [SIG] and "gene-score_" + SIG + "_zscore_mean" in old[2]
    assert new[1] == [sigs[1]], "the added table uses the added signature"
    assert "gene-score_" + sigs[1] + "_zscore_mean" in new[2] and SIG not in new[2], "and its condition names that column"


# ------------------------------------------- a score of another length is never waited on in silence

def test_a_score_for_other_cells_is_asked_for_again_and_then_fails_with_retry_in_a_table(page, served):
    _slow(page, "auto", 3)
    _open(page, served)
    until(page, "() => window.__ctls.length === 1")
    _finish(page, 0, [float(i) for i in range(30)])             # 30 values for 60 cells
    until(page, "() => window.__ctls.length === 2")             # asked for again, once
    _finish(page, 1, [float(i) for i in range(30)])
    note = _wait_notice(page, "failed")
    assert "could not be computed: the score has 30 values for 60 cells." in note["text"]
    assert [a.split("|")[0] for a in note["actions"]][0] == "score-retry"
    st = _state(page)
    assert st["header"] == "T cell score (no score)" and st["cells"] == ["no score"] and st["exportOff"]
    page.click(f"{BOX} .score-notice [data-ps-action='score-retry']")
    until(page, "() => window.__ctls.length === 3")
    _finish(page, 2)
    _wait_ready(page)
    _wait_no_notice(page)


def test_a_score_for_other_cells_fails_with_retry_in_a_plot_too(page, served):
    _slow(page, "auto", 3)
    plot = _cell("cell-plot-C", color=SCORE_COLOUR)
    _open(page, served, table=_table(columns=[OBS]), plots=(("cell-plot-C", plot),))
    until(page, "() => window.__ctls.length === 1")
    _finish(page, 0, [1.0] * 30)
    until(page, "() => window.__ctls.length === 2")
    _finish(page, 1, [1.0] * 30)
    page.wait_for_selector(f"{P} .score-notice[data-state='failed']", timeout=30000)
    text = page.inner_text(f"{P} .score-notice")
    assert "the score has 30 values for 60 cells" in text and "Retry" in text


SCORE_COLOUR = {"type": "gene-score", "key": SIG, "label": "T cell score", "column": ""}


def test_a_subset_change_while_a_score_is_on_its_way_ends_with_the_score_of_the_new_cells(page, served):
    _slow(page, "auto", 3)
    _open(page, served)
    until(page, "() => window.__ctls.length === 1")             # the 60-cell score is in flight
    _set_subset(page, True, 30)
    until(page, "() => window.__ctls.length === 2")
    _finish(page, 1, [float(i) for i in range(30)])
    _wait_ready(page)
    assert len(_column(page, 2)) > 0 and max(float(v) for v in _column(page, 2)) <= 29.0
    # the late answer for the old cells changes nothing
    page.evaluate("() => { try { window.__finish(0, new Array(60).fill(7)); } catch (e) { /* aborted */ } }")
    # time for the late answer to change the table, were it going to; it must not
    page.wait_for_timeout(300)
    assert max(float(v) for v in _column(page, 2)) <= 29.0
    assert _headers(page)[2] == "T cell score"


# ------------------------------------------------------ the memory guard and a table with a score column

# The page's heap limit leaves room for `rows` rows of a Cell Table beside what is held now (the way
# test_memory_guard.py sets its limits): a table of 45 rows fits, one of the 60 cells does not (the offer is then half the cells).
SET_TABLE_ROWS_LIMIT = """async (rows) => {
    const { Config } = await import('/static/js/config.js');
    const g = await import('/static/js/utils/memory-guard-ui.js');
    const m = await import('/static/js/utils/memory-guard.js');
    const raw = m.panelCost({ kind: 'cell-table', n: rows }).peak.heap;
    const held = g.held(g.ledger.panels().map(e => e.id)).heap;
    Config.DEFAULTS.MEMORY = { ...(Config.DEFAULTS.MEMORY || {}), total_gb: 1e6, margin: 0.2,
        heap_gb: (held + raw * 1.2 + 1) / (m.GB * m.HEAP_USABLE_SHARE) };
    document.dispatchEvent(new CustomEvent(g.MEMORY_EVENT));
}"""


def test_a_score_column_on_a_table_the_memory_guard_refuses_asks_for_nothing_until_the_offer_is_taken(page, served):
    _slow(page, "auto", 3)
    _open(page, served, table=_table(columns=[OBS]))
    page.evaluate(SET_TABLE_ROWS_LIMIT, 45)
    # the column is added, in the chooser, to a table that no longer fits: the refusal is the table's answer
    page.click(f"#gene-score-tab-{TID}")
    _add_score(page)
    page.click(f"#apply-columns-{TID}")
    page.wait_for_selector(f"{BOX} .coverage-placeholder", timeout=30000)
    text = page.inner_text(f"{BOX} .coverage-placeholder")
    assert text.startswith("Not loaded: not enough JS memory"), text
    actions = [a.get_attribute("data-ps-action") for a in page.locator(f"{BOX} .coverage-placeholder [data-ps-action]").all()]
    assert "subset-half" in actions and "subset" in actions, actions
    assert "Half the cells" in text
    # time for a score request, were one going to; a refused table asks for none
    page.wait_for_timeout(500)
    assert _calls(page) == [], "a refused table makes no score request"
    assert page.evaluate("() => window.__ctls.length") == 0
    assert page.locator(f"{BOX} .score-notice").count() == 0
    # the column is still the table's, and the offer (half the cells) loads the table for 30 cells
    assert [c["type"] for c in page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig().columns", TID)] == ["obs", "gene-score"]
    page.click(f"{BOX} [data-ps-action='subset-half']")
    until(page, "() => window.__ctls.length === 1")
    assert _calls(page, "compute")[0]["subset"] is not None, "the score is asked for the 30 cells now shown"
    until(page, "(box) => document.querySelectorAll(box + ' .dataTables_scrollBody tbody tr').length > 0", BOX)
    assert _headers(page)[2] == "T cell score (computing)"
    _finish(page, 0, [float(i) for i in range(30)])
    _wait_ready(page)
    assert _api(page, "dt.rows().count()") == 30
    assert max(float(v) for v in _column(page, 2)) <= 29.0
    _wait_no_notice(page)


# ------------------------------------------------------------------ T1: the shared add row (table-chooser-080.md 3)

ADD_ROW = f"#gene-score-content-{TID} .az-score-group[data-entity='{SIG}']"
# METHOD_INFO's order, each with its symbol (utils/aggregation-symbols.js SCORE_SYMBOLS)
METHOD_SYMBOLS = [("zscore_mean", "z"), ("mean", "x"), ("sum", "Σ"), ("control_adjusted", "Δ"), ("fraction_of_genes", "g⁺"), ("fraction_of_total", "%")]


def test_add_row_is_layer_then_aggregation_button(page, served):
    """No method select: the layer select, then the shared aggregation button, then Add column; the button lists every
    method as symbol and name in METHOD_INFO's order, and a pair that cannot be computed is greyed with its reason."""
    _open(page, served, table=_table(columns=[OBS]))
    page.click(f"#gene-score-tab-{TID}")
    page.wait_for_selector(f"{ADD_ROW} .az-score-add-agg", timeout=10000)
    assert page.locator(f"{ADD_ROW} .az-score-add-method").count() == 0, "the method select is gone"
    assert page.locator(f"{ADD_ROW} .az-score-add-on").count() == 0, "so is the word 'on'"
    order = page.evaluate("(g) => [...document.querySelector(g + ' .az-score-add').children].map(e => e.className.split(' ').filter(c => c.startsWith('az-score-add-'))[0])", ADD_ROW)
    assert order == ["az-score-add-layer", "az-score-add-agg", "az-score-add-btn"], order
    entries = add_row_entries(page, ADD_ROW)
    assert [(e["v"], e["sym"]) for e in entries] == METHOD_SYMBOLS
    assert [e["name"] for e in entries] == ["Z-score mean", "Mean", "Sum", "Control-adjusted", "Fraction of genes", "% of total"]
    # on X the shares need counts: greyed with the reason, in the menu
    page.select_option(f"{ADD_ROW} .az-score-add-layer", "X")
    on_x = {e["v"]: e for e in add_row_entries(page, ADD_ROW)}
    assert on_x["fraction_of_genes"]["off"] and on_x["fraction_of_genes"]["title"], on_x["fraction_of_genes"]
    assert not on_x["mean"]["off"]
    # the button holds the chosen method's symbol and says it
    pick_add_method(page, ADD_ROW, "mean")
    assert page.inner_text(f"{ADD_ROW} .az-score-add-agg") == "x"
    assert "Mean" in page.get_attribute(f"{ADD_ROW} .az-score-add-agg", "aria-label")


def test_added_column_is_stored_as_before(page, served):
    """A link made before the shared add row loads (its column is ticked), and adding the same pair through the new
    row stores a column deep-equal to the old form."""
    old = {"type": "gene-score", "key": SIG, "column": "mean", "layer": "X", "label": "T cell score"}
    _open(page, served, table=_table(columns=[OBS, old]))
    page.click(f"#gene-score-tab-{TID}")
    assert page.is_checked(f"#checkbox-gene-score-{SIG}-mean-of-X-{TID}"), "the old column is listed as ticked"
    # remove it from the table, then add the same pair through the new row
    page.uncheck(f"#checkbox-gene-score-{SIG}-mean-of-X-{TID}")
    page.click(f"#apply-columns-{TID}")
    until(page, "(id) => !(window.PanelManager.getPanel(id).getConfig().columns || []).some(c => c.type === 'gene-score')", TID)
    page.click(f"#gene-score-tab-{TID}")
    _add_score(page, SIG, "mean", "X")
    page.click(f"#apply-columns-{TID}")
    until(page, "(id) => (window.PanelManager.getPanel(id).getConfig().columns || []).some(c => c.type === 'gene-score')", TID)
    cols = page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig().columns", TID)
    assert [c for c in cols if c["type"] == "gene-score"] == [old]


def test_ticked_row_shows_symbol(page, served):
    """A ticked row starts with the method's symbol, and a column just added gets its row with the symbol too."""
    mean = {"type": "gene-score", "key": SIG, "column": "mean", "layer": "X", "label": "T cell score"}
    _open(page, served, table=_table(columns=[OBS, mean]))
    page.click(f"#gene-score-tab-{TID}")
    label = f"{ADD_ROW} .form-check label"
    page.wait_for_selector(label)
    assert page.locator(label).count() == 1
    assert page.inner_text(f"{ADD_ROW} .form-check .az-score-sym") == "x"
    assert page.inner_text(label).strip() == "mean · X", "the label stays the column's words"
    _add_score(page, SIG, "zscore_mean", "X")
    rows = page.evaluate("(g) => [...document.querySelectorAll(g + ' .form-check')].map(d => [d.querySelector('.az-score-sym').textContent, d.querySelector('label').textContent.trim()])", ADD_ROW)
    assert [r[0] for r in rows] == ["x", "z"], rows
    assert page.locator(f"{ADD_ROW} .form-check .az-score-sym.agg-sym--over").count() == 2, "x and z carry their bar"


def test_add_row_survives_a_panels_changed_event_mid_pick(page, served):
    """A "panels changed" that changes nothing here leaves the tab as it is; one that does (the signature renamed) builds it
    again with the layer and aggregation chosen kept."""
    _open(page, served, table=_table(columns=[OBS]))
    page.click(f"#gene-score-tab-{TID}")
    page.wait_for_selector(f"{ADD_ROW} .az-score-add-agg", timeout=10000)
    layers = page.eval_on_selector_all(f"{ADD_ROW} .az-score-add-layer option", "os => os.filter(o => !o.disabled).map(o => o.value)")
    assert len(layers) > 1, layers
    page.select_option(f"{ADD_ROW} .az-score-add-layer", layers[-1])
    pick_add_method(page, ADD_ROW, "mean")
    read = """(g) => { const row = document.querySelector(g + ' .az-score-add');
        window.__addRow = window.__addRow || row;
        return { same: window.__addRow === row, layer: row.querySelector('.az-score-add-layer').value,
            agg: row.querySelector('.az-score-add-agg').getAttribute('aria-label') }; }"""
    page.evaluate(read, ADD_ROW)
    page.evaluate("() => document.dispatchEvent(new CustomEvent('annzarro:panels-changed'))")
    assert page.evaluate(read, ADD_ROW)["same"] is True
    page.evaluate("(id) => { window.PanelManager.getPanel(id).setTitle('Renamed score'); document.dispatchEvent(new CustomEvent('annzarro:panels-changed')); }", SIG)
    now = page.evaluate(read, f"#gene-score-content-{TID} .az-score-group[data-entity='{SIG}']")
    assert now["same"] is False and now["layer"] == layers[-1] and "Mean" in now["agg"], now


def test_cell_table_tab_order(page, served):
    """obs, obsm, obsp, layers, then Gene score, then Cell groupings."""
    _open(page, served, table=_table(columns=[OBS]))
    tabs = page.evaluate("(t) => [...document.querySelectorAll(t + ' .nav-tabs .nav-link')].map(b => b.textContent.trim())", T)
    assert tabs == ["obs", "obsm", "obsp", "layers", "Gene score", "Cell groupings"], tabs
