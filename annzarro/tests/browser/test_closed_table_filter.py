"""A plot filtered by a table that is closed, when the cells change.

Recorded on v030-preview (and kept by the first cleanup change): after the
table was closed, a subset or part change mapped the table's row indexes
onto the new cells, so the plot showed no cells or cells that never passed
the filter. Now a closed table's filter is kept by name (utils/closed-table.js):

1. every cell, then a smaller subset and the other part: exactly the new
   cells that passed, nothing out of date;
2. a 100-cell part, then the other part (equal size, cells the table never
   had): no cell shown, and the tag "Table filter from closed '<name>' is out
   of date: 100 cells were not in it" with Reopen table / Stop filtering;
   then every cell (larger): the passing cells it had, the same tag;
   Stop filtering shows every cell and drops the tag;
3. an open table on the same steps still filters by its own rows: the plot
   follows the table, with no tag;
4. a panel set restored with the table closed (registerClosedPanel) carries
   no row indexes or names; the plot says its filter is out of date for
   every cell. (A share link keeps no closed panels at all.)

Every case asserts that no cell outside the table's filter is ever shown.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import base64
import json
import os
import re
import urllib.parse

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_memory_guard import STORE, _serve, until  # noqa: E402

B = '.tile[data-tile-id="cell-plot-B"]'
A = '.tile[data-tile-id="cell-table-A"]'
PASS = re.compile(r"^cell_01\d\d$")       # the table's search "cell_01"


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    root, proc = _serve(tmp_path_factory)
    yield root
    proc.terminate()
    proc.wait(10)


@pytest.fixture
def page(server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1400, "height": 1000})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            yield page
            assert not errors, errors
        finally:
            browser.close()


def _link(root, subset, table_open=True):
    x = {"type": "obsm", "key": "X_umap", "column": "0"}
    y = {"type": "obsm", "key": "X_umap", "column": "1"}
    cfgs = {"cell-plot-B": {"id": "cell-plot-B", "x": x, "y": y, "z": None,
                            "color": {"type": "obs", "key": "cell_type", "column": ""},
                            "tableFilter": "cell-table-A", "removeNonTableEntries": True},
            "cell-table-A": {"id": "cell-table-A", "title": "Table 1",
                             "columns": [{"type": "obs", "key": "cell_type", "column": ""}]}}
    tiles = [{"type": "tile", "id": "cell-plot-B", "controlsVisible": True}]
    if table_open:
        tiles.append({"type": "tile", "id": "cell-table-A", "controlsVisible": True})
    hierarchy = tiles if len(tiles) == 1 else [{"type": "split", "direction": "horizontal",
                                                 "panes": [{"percentage": 60}, {"percentage": 40}], "children": tiles}]
    view = {"v": 1, "subset": subset, "layout": {"v": 1, "hierarchy": hierarchy,
            "controlState": {t["id"]: True for t in tiles}, "panelConfigs": cfgs}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={enc}"


SHOWN = """() => {
    const gd = document.querySelector('%s .js-plotly-plot');
    if (!gd || !gd.data) return null;
    const names = gd.data.flatMap(t => Array.from(t.customdata || [])).map(v => Array.isArray(v) ? v[0] : v).map(String);
    const tag = document.querySelector('%s .ps-tag[data-tag="table-stale"]');
    return { names, tag: tag ? tag.getAttribute('title') : null,
             summary: document.querySelector('%s .plot-status')?.getAttribute('data-summary') || '' };
}""" % (B, B, B)


def _state(page):
    return page.evaluate(SHOWN)


def _filter_table(page, text="cell_01"):
    page.wait_for_selector(f"{A} .dataTables_scrollBody tbody tr", timeout=30000)
    page.fill(f'{A} input[type="search"]', text)


def _subset(page, n=None, part_step=False):
    if part_step:
        page.click("#subset-part-next")
    else:
        page.click("#subset-button")
        page.wait_for_selector("#subset-apply", state="visible")
        if n is None:
            page.click("#subset-preset-all")
        else:
            page.click(f'#subset-presets button[data-n="{n}"]')
        page.wait_for_function("() => !document.getElementById('subset-apply').disabled")
        page.click("#subset-apply")
        page.wait_for_selector("#subset-modal", state="hidden")
    page.wait_for_timeout(500)
    until(page, """async () => {
        const g = await import('/static/js/utils/memory-guard-ui.js');
        const { DataManager } = await import('/static/js/data-manager.js');
        const e = g.ledger.get('cell-plot-B');
        return e && !g.ledger.pending.has('cell-plot-B') && e.n === DataManager.getCells().length;
    }""")
    page.wait_for_timeout(500)


def _cells_now(page):
    return page.evaluate("async () => Array.from((await import('/static/js/data-manager.js')).DataManager.getCells()).map(String)")


def _never_wrong(s, allowed):
    assert all(PASS.match(c) for c in s["names"]), [c for c in s["names"] if not PASS.match(c)][:5]
    assert set(s["names"]) <= set(allowed), sorted(set(s["names"]) - set(allowed))[:5]


def test_closed_on_every_cell_then_smaller_and_other_part(page, server):
    page.goto(_link(server, None))
    _filter_table(page)
    page.wait_for_function(f"() => /^100 of 200 cells shown/.test(document.querySelector('{B} .plot-status')?.getAttribute('data-summary') || '')",
                           timeout=20000)
    page.evaluate("() => window.PanelManager.closePanel('cell-table-A')")
    for step in ("smaller", "part"):
        if step == "smaller":
            _subset(page, 100)
        else:
            _subset(page, part_step=True)
        cells = _cells_now(page)
        s = _state(page)
        want = sorted(c for c in cells if PASS.match(c))
        assert sorted(s["names"]) == want, (step, len(s["names"]), len(want))
        assert s["tag"] is None, s["tag"]


def test_closed_on_a_part_then_other_part_and_larger(page, server):
    page.goto(_link(server, {"n": 100, "seed": 0}))
    _filter_table(page)
    page.wait_for_timeout(1500)
    part1 = _cells_now(page)
    passed1 = [c for c in part1 if PASS.match(c)]
    assert sorted(_state(page)["names"]) == sorted(passed1)
    page.evaluate("() => window.PanelManager.closePanel('cell-table-A')")

    # equal size, cells the table never had: none shown, out of date for all 100
    _subset(page, part_step=True)
    s = _state(page)
    assert s["names"] == []
    assert s["tag"] == "Table filter from closed 'Table 1' is out of date: 100 cells were not in it"

    # every cell: the passing cells it had, out of date for the 100 it never had
    _subset(page, None)
    s = _state(page)
    assert sorted(s["names"]) == sorted(passed1)
    _never_wrong(s, passed1)
    assert s["tag"] == "Table filter from closed 'Table 1' is out of date: 100 cells were not in it"
    # the tag's actions
    page.click(f'{B} .ps-tag[data-tag="table-stale"]')
    assert page.locator(f'{B} [data-ps-action="reopen-table"]').count() == 1
    page.click(f'{B} [data-ps-action="table-filter-off"]')
    page.wait_for_function(f"() => !document.querySelector('{B} .ps-tag[data-tag=\"table-stale\"]')", timeout=20000)
    page.wait_for_function(f"() => /^All 200 cells|^200 of 200|^200 cells/.test(document.querySelector('{B} .plot-status')?.getAttribute('data-summary') || '') || document.querySelector('{B} .js-plotly-plot').data.reduce((s, t) => s + (t.customdata ? t.customdata.length : 0), 0) === 200",
                           timeout=20000)


def test_open_table_still_filters_by_its_own_rows(page, server):
    page.goto(_link(server, {"n": 100, "seed": 0}))
    _filter_table(page)
    page.wait_for_timeout(1500)
    _subset(page, part_step=True)
    page.wait_for_timeout(1500)
    cells = _cells_now(page)
    s = _state(page)
    assert sorted(s["names"]) == sorted(c for c in cells if PASS.match(c))
    assert s["tag"] is None
    _subset(page, None)
    page.wait_for_timeout(1500)
    s = _state(page)
    assert sorted(s["names"]) == [f"cell_01{i:02d}" for i in range(100)]
    assert s["tag"] is None


def test_restored_closed_table_carries_no_rows(page, server):
    # a panel set with the table closed: session-manager registers it with
    # PanelManager.registerClosedPanel, from its saved config (no row indexes)
    page.goto(_link(server, None, table_open=False))
    page.wait_for_selector(f"{B} .js-plotly-plot", timeout=30000)
    page.evaluate("""async () => {
        window.PanelManager.registerClosedPanel('cell-table', { id: 'cell-table-A', title: 'Table 1',
            columns: [{ type: 'obs', key: 'cell_type', column: '' }] });
        const b = window.PanelManager.getPanel('cell-plot-B');
        b.setConfig({ tableFilter: 'cell-table-A', removeNonTableEntries: true });
        await b.refreshPlot();
    }""")
    page.wait_for_selector(f'{B} .ps-tag[data-tag="table-stale"]', state="attached", timeout=20000)
    s = _state(page)
    assert s["names"] == []
    assert s["tag"] == "Table filter from closed 'Table 1' is out of date: 200 cells were not in it"
    # the closed table's config holds no row indexes or names
    cfg = page.evaluate("() => JSON.stringify(window.PanelManager.getPanel('cell-table-A').getConfig())")
    assert '"closedSelection"' not in cfg
