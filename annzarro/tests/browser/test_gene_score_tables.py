"""The `gene-score` source as a column of a Cell Table, in a real browser (step 6 of the plan).

A Cell Table takes a signature's score as a column through its column chooser (signature, then
aggregation), appears at once, and fills the column in place when the score arrives. The values live
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
    INIT, N_OBS, RAMP, SIG, UMAP_X, UMAP_Y, _cell, _finish, _frame, _new_page, _served, _sig, _slow, _url, served,
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


def test_the_chooser_offers_signature_then_aggregation_and_several_at_once(page, served):
    _slow(page, "auto", 3)
    second = {"id": "gene-signature-U", "title": "Other score", "genes": ["GENE0010", "GENE0011"]}
    _open(page, served, table=_table(columns=[OBS]), extra={"gene-signature-U": second})
    assert _headers(page)[:2] == ["Cell ID", "score"]
    page.click(f"#gene-score-tab-{TID}")
    groups = page.evaluate("(id) => [...document.querySelectorAll('#gene-score-content-' + id + ' .az-score-group')].map(g => ({ title: g.querySelector('.az-score-group-title').textContent, subs: [...g.querySelectorAll('label')].map(l => l.textContent) }))", TID)
    assert sorted(g["title"] for g in groups) == ["Other score", "T cell score"]
    assert all(g["subs"] == ["z-score mean", "mean"] for g in groups), groups
    for sig, sub in ((SIG, "zscore_mean"), (SIG, "mean"), ("gene-signature-U", "zscore_mean")):
        page.check(f"#checkbox-gene-score-{sig}-{sub}-{TID}")
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
    page.wait_for_timeout(150)
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
    assert "This plot has no colour" not in note["text"]
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
    assert page.evaluate(f"() => document.getElementById('checkbox-gene-score-{SIG}-zscore_mean-{TID}').checked") is False


def test_a_refused_score_and_one_that_asks_first(page, served):
    _slow(page, "refused", 1500, refuse="This score would take about 25 minutes; the limit is 10. Use fewer genes.")
    _open(page, served)
    note = _wait_notice(page, "refused")
    assert "'T cell score' would take about 25 minutes, so it was not run." in note["text"] and "Use fewer genes." in note["text"]
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
    page.wait_for_timeout(150)
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
    page.wait_for_timeout(200)
    assert _api(page, "dt.rows({search: 'applied'}).count()") == 10, "c50 to c59 pass both the score condition and the text"
    page.fill(f"{BOX} .dataTables_filter input", "57")
    page.wait_for_timeout(200)
    assert _api(page, "dt.rows({search: 'applied'}).count()") == 1


def test_export_writes_the_score_column_when_it_is_ready(page, served, tmp_path):
    _ready_table(page, served, values=[i / 3 for i in range(N_OBS)])
    with page.expect_download() as info:
        page.click(f"#export-csv-{TID}")
    path = tmp_path / "t.csv"
    info.value.save_as(str(path))
    lines = path.read_text().strip().splitlines()
    assert lines[0].replace('"', "") == "Cell ID,score,T cell score"
    row = {l.replace('"', "").split(",")[0]: l.replace('"', "").split(",") for l in lines[1:]}
    assert len(row) == N_OBS
    assert float(row["c3"][2]) == pytest.approx(1.0, abs=1e-6)
    assert row["c3"][2] == "1", "float32 noise is not written: " + row["c3"][2]
    assert float(row["c10"][2]) == pytest.approx(10 / 3, abs=1e-5)
