"""The provider seam of the tables (F3d), in a real browser.

A fake CATEGORICAL provider with a table half is registered at run time, before the app reads anything, and no table
file knows it. It must work where a source works in a Cell Table: its tab in the column chooser, a column that is built
at once (its source may not be there yet) and fills in place when the source appears, its notice on the page's painter,
sorting, filtering (a search, and a condition of the filter), a held filter, and the link round trip. The Node half is
annzarro/tests/js/source-seam-table.test.mjs.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1 (set in CI).
"""
import json
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_gene_score_plots import N_OBS, _url, served  # noqa: E402,F401
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

TID = "cell-table-T"
BOX = f"#table-container-{TID}"
CATEGORIES = ["B cells", "T cells", "NK cells"]
OBS = {"type": "obs", "key": "score", "column": ""}
FAKE_COL = {"type": "fake-group", "key": "grp-1", "column": "", "label": "Grouping A"}
FAKE_KEY = "fake-group_grp-1_main"

# Registered before the app's first request: every fetch waits for it, so a link never reaches the table first.
# The source is missing until the test says it is there (`__fakePush`); the series is one category per row.
FAKE = """
window.__fakeSnap = { state: 'deleted', title: 'Grouping A' };
window.__fakeSinks = [];
window.__fakeEntities = [{ id: 'grp-1', title: 'Grouping A', open: true }];
window.__fakePush = (snap) => { window.__fakeSnap = snap; for (const f of window.__fakeSinks) f(snap); };
window.__fakeReadySnap = (extra) => {
  const codes = new Uint8Array(%d);
  for (let i = 0; i < codes.length; i++) codes[i] = i %% 10 === 9 ? 255 : i %% 3;
  return Object.assign({ state: 'ready', title: 'Grouping A', codes, categories: %s, MISSING: 255 }, extra || {});
};
window.__fakeReady = import('/static/js/utils/source-registry.js').then((R) => {
  R.registerSource({
    type: 'fake-group', label: 'fake groups', entity: 'cells', consumers: ['cell-plot', 'cell-table'], axes: ['x', 'y', 'color', 'column'],
    defaultSub: '', valueType: 'categorical',
    entities: () => window.__fakeEntities,
    keyEntries: (list) => list.map(e => ({ value: e.id, text: e.title })),
    subKeys: () => [],
    titleOf: (setting) => `grouping ${setting.label || setting.key}`,
    load: async () => { throw new Error('a table column is not a plot series'); },
    table: {
      tab: 'fake groups',
      watch: (column, { onChange }) => {
        window.__fakeSinks.push(onChange);
        return { read: () => window.__fakeSnap, release() {}, sharers: () => 1, compute: () => false, retry: () => false, cancel: () => false };
      },
      label: (column) => column.label || column.key,
      fullLabel: (column) => `${column.label || column.key} (fake)`,
      chooser: {
        layerOf: () => '', entityLabel: (e) => e.title, options: (e) => [{ column: '', text: e.title }],
        empty: { text: 'No groupings yet.', button: 'New grouping…' }
      }
    }
  });
});
const realFetch = window.fetch.bind(window);
window.fetch = async (url, init) => { await window.__fakeReady; return realFetch(url, init); };
""" % (N_OBS, json.dumps(CATEGORIES))


@pytest.fixture
def page(served):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1500, "height": 1000})
            page.add_init_script(FAKE)
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            yield page
            assert not errors, errors
        finally:
            browser.close()


def _open(page, served, columns=(OBS, FAKE_COL), **extra):
    cfg = {"id": TID, "title": "Cell Table 1", "columns": list(columns), **extra}
    page.goto(_url(served, [TID], {TID: cfg}))
    page.wait_for_selector(f"{BOX} .dataTables_scrollBody", state="attached", timeout=30000)


def _headers(page):
    return page.evaluate("""(box) => [...document.querySelectorAll(box + ' .dataTables_scrollHead th')].map(th => th.textContent.replace(/\\s+/g, ' ').trim())""", BOX)


def _column(page, index):
    return page.evaluate("""([box, i]) => [...document.querySelectorAll(box + ' .dataTables_scrollBody tbody tr')]
        .map(tr => (tr.children[i] || {}).textContent).map(t => (t || '').trim())""", [BOX, index])


def _notice(page):
    return page.evaluate("""(box) => {
        const el = document.querySelector(box + ' .score-notice');
        return el ? { state: el.dataset.state, text: el.textContent.replace(/\\s+/g, ' ').trim() } : null;
    }""", BOX)


def _api(page, expr):
    return page.evaluate(f"() => {{ const dt = $('{BOX} .dataTables_scrollBody table').DataTable(); return ({expr}); }}")


def _ready(page):
    page.evaluate("() => window.__fakePush(window.__fakeReadySnap())")
    until(page, """(box) => { const c = [...document.querySelectorAll(box + ' .dataTables_scrollBody tbody tr')].map(tr => tr.children[2].textContent.trim());
        return c.length > 0 && c.every(t => t !== '' && t !== 'no score'); }""", BOX)


def test_the_chooser_lists_the_provider_as_a_tab_with_its_entities(page, served):
    _open(page, served, columns=(OBS,))
    until(page, "(id) => !!document.querySelector('#fake-group-content-' + id + ' .column-checkbox')", TID)
    labels = page.evaluate("(id) => [...document.querySelectorAll('.table-panel .data-type-tabs .nav-tabs button')].map(b => b.textContent.trim())", TID)
    assert "fake groups" in labels, labels
    boxes = page.evaluate("""(id) => [...document.querySelectorAll('#fake-group-content-' + id + ' .column-checkbox')]
        .map(b => [b.dataset.type, b.dataset.key, b.dataset.column, b.checked])""", TID)
    assert boxes == [["fake-group", "grp-1", "", False]]


def test_a_column_of_a_source_that_is_missing_is_built_and_fills_in_place_when_it_appears(page, served):
    _open(page, served)
    # the table is there at once, the column says the source is not there
    assert _headers(page)[:3] == ["Cell ID", "score", "Grouping A (deleted)"], _headers(page)
    assert set(_column(page, 2)) == {"no score"}
    until(page, "(box) => { const el = document.querySelector(box + ' .score-notice'); return !!el && el.dataset.state === 'deleted'; }", BOX)
    assert "Remove column" in page.inner_text(f"{BOX} .score-notice")
    # a state the user set up: pages of 10, sorted by the other column, on page 2
    page.evaluate("""(box) => { const dt = $(box + ' .dataTables_scrollBody table').DataTable(); dt.page.len(10).draw(); dt.order([1, 'desc']).draw(); dt.page(2).draw('page'); }""", BOX)
    rows = _column(page, 0)
    _ready(page)
    assert _headers(page)[2] == "Grouping A"
    assert set(_column(page, 2)) <= set(CATEGORIES) | {"N/A"}
    assert _api(page, "dt.page()") == 2, "the table was not rebuilt"
    assert _column(page, 0) == rows
    until(page, "(box) => !document.querySelector(box + ' .score-notice')", BOX)


def test_the_column_sorts_filters_and_exports_by_its_labels(page, served):
    _open(page, served)
    _ready(page)
    page.evaluate("""(box) => { const dt = $(box + ' .dataTables_scrollBody table').DataTable(); dt.page.len(100).draw(); dt.order([2, 'asc']).draw(); }""", BOX)
    shown = [t for t in _column(page, 2) if t != "N/A"]
    assert shown == sorted(shown, key=str.lower), "sorted by label"
    assert shown[0] == "B cells" and shown[-1] == "T cells"
    # the table's search finds a label
    page.evaluate("""(box) => { $(box + ' .dataTables_scrollBody table').DataTable().search('NK').draw(); }""", BOX)
    got = _column(page, 2)
    assert got and set(got) == {"NK cells"}
    page.evaluate("""(box) => { $(box + ' .dataTables_scrollBody table').DataTable().search('').draw(); }""", BOX)
    # the export names the column in full, and writes labels
    assert page.evaluate("""(box) => $(box + ' .dataTables_scrollBody table').DataTable().column(2).header().dataset.exportTitle""", BOX) == "Grouping A (fake)"
    cell = page.evaluate("""(box) => { const dt = $(box + ' .dataTables_scrollBody table').DataTable(); return dt.cell(0, 2).render('export'); }""", BOX)
    assert cell in CATEGORIES or cell == ""


def test_a_condition_on_the_column_filters_and_holds_the_rows_while_it_is_not_ready(page, served):
    sb = {"logic": "AND", "criteria": [{"condition": "=", "data": "Grouping A", "origData": FAKE_KEY, "type": "string", "value": ["T cells"]}]}
    _open(page, served, searchBuilderConfig=sb)
    # the source is not there: the filter holds the rows and says so
    until(page, "(box) => !!document.querySelector(box + ' .az-score-held-note')", BOX)
    assert "Grouping A" in page.inner_text(f"{BOX} .az-score-held-note")
    _ready(page)
    until(page, "(box) => !document.querySelector(box + ' .az-score-held-note')", BOX)
    got = _column(page, 2)
    assert got and set(got) == {"T cells"}, got
    assert len(got) == 18, "every third row of sixty, none of the missing ones"


def test_the_link_keeps_the_reference_and_nothing_else_and_a_new_page_opens_it(page, served):
    _open(page, served)
    _ready(page)
    view = page.evaluate("() => (window.SessionManager || window.sessionManager).captureView()")
    cfg = view["layout"]["panelConfigs"][TID]
    assert [(c["type"], c["key"], c["column"]) for c in cfg["columns"]] == [("obs", "score", ""), ("fake-group", "grp-1", "")]
    text = json.dumps(view)
    assert "codes" not in text and "T cells" not in text, "a link holds the reference, never the values"
    other = page.context.browser.new_page(viewport={"width": 1500, "height": 1000})
    other.add_init_script(FAKE)
    try:
        root, store = served
        import base64
        import urllib.parse
        enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
        other.goto(f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={enc}")
        other.wait_for_selector(f"{BOX} .dataTables_scrollBody", state="attached", timeout=30000)
        assert _headers(other)[2] == "Grouping A (deleted)", "opened before its source is there"
        other.evaluate("() => window.__fakePush(window.__fakeReadySnap())")
        until(other, """(box) => { const c = [...document.querySelectorAll(box + ' .dataTables_scrollBody tbody tr')].map(tr => tr.children[2].textContent.trim());
            return c.length > 0 && c.every(t => t !== '' && t !== 'no score'); }""", BOX)
        assert _headers(other)[2] == "Grouping A"
    finally:
        other.close()
