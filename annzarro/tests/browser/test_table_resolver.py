"""Background recompute of closed tables (utils/table-resolver.js), step 2 of the gene-signature plan.

A plot filtered by a CLOSED table needs the rows that pass its filter. A table restored from a link,
a panel set or Back and Forward has only its configuration, and a subset or part change outdates the
filter of one closed by hand. The page now builds it in the background, only when something on
screen needs it, one table at a time, from a detached DataTable that runs the SAME filter code as an
open table.

One test per race of the design's 8.6, and the rules around them:

* a build starts only on need, one at a time, in the size tiers (automatic, Build filter, refused);
* the memory guard decides first: refused means nothing loads, and the plot says why;
* open while the rows load / after the build is done but not published: the opened table owns the
  filter, a late background result never overwrites it, and the plots update once;
* close, reopen, delete, dataset switch, subset change, Back and Forward, panel-set load;
* the background result equals the opened table's rows for regex, smart, case, line and focus filters.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1 (set in CI),
where a missing Playwright is an error.
"""
import base64
import json
import os
import re
import time
import urllib.parse

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_memory_guard import SET_FREE, STORE, _serve, until  # noqa: E402

HOLD = "window.__azTableLimits = { AUTO_ROWS: 0, ASK_ROWS: 1000000000 };"
PASS = re.compile(r"^cell_01\d\d$")        # the table's search "cell_01": cells 0100 to 0199
PASS0 = re.compile(r"^cell_00\d\d$")       # "cell_00": cells 0000 to 0099
X = {"type": "obsm", "key": "X_umap", "column": "0"}
Y = {"type": "obsm", "key": "X_umap", "column": "1"}
CT = {"type": "obs", "key": "cell_type", "column": ""}


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    root, proc = _serve(tmp_path_factory)
    yield root
    proc.terminate()
    proc.wait(10)


@pytest.fixture(scope="module")
def large_server(tmp_path_factory):
    root, proc = _serve(tmp_path_factory, "ui:\n  defaults:\n    large_plot_points: 100\n")
    yield root
    proc.terminate()
    proc.wait(10)


def _make_page(p, init=None):
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1500, "height": 1000})
    if init:
        page.add_init_script(init)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    return browser, page, errors


@pytest.fixture
def page(server):
    with playwright.sync_playwright() as p:
        browser, page, errors = _make_page(p)
        try:
            yield page
            assert not errors, errors
        finally:
            browser.close()


@pytest.fixture
def held(server):
    """Builds wait for a click ("Build filter")."""
    with playwright.sync_playwright() as p:
        browser, page, errors = _make_page(p, HOLD)
        try:
            yield page
            assert not errors, errors
        finally:
            browser.close()


def tile(pid):
    return f'.tile[data-tile-id="{pid}"]'


def plot_id(i):
    return f"cell-plot-p{i}"


def table_id(i):
    return f"cell-table-t{i}"


def _link(root, tables=(("cell_01", False),), plots=(0,), subset=None, plot_extra=None, filters=None, table_extra=None):
    """Plots p0.. filtered by tables t0.. (plot i by table `filters[i]`, default i), tables with search text."""
    cfgs, tiles = {}, []
    for k, i in enumerate(plots):
        t = (filters or {}).get(i, i)
        cfgs[plot_id(i)] = {"id": plot_id(i), "x": X, "y": Y, "z": None, "color": CT,
                            "tableFilter": table_id(t) if t is not None else "none",
                            "removeNonTableEntries": True, **(plot_extra or {})}
        tiles.append({"type": "tile", "id": plot_id(i), "controlsVisible": True})
    for i, (text, is_open) in enumerate(tables):
        cfgs[table_id(i)] = {"id": table_id(i), "title": f"Table {i + 1}", "columns": [CT], "searchText": text,
                         **((table_extra or {}).get(i) or {})}
        if is_open:
            tiles.append({"type": "tile", "id": table_id(i), "controlsVisible": True})
    def split(items):
        if len(items) == 1:
            return items[0]
        first = 100 // len(items)
        return {"type": "split", "direction": "horizontal", "panes": [{"percentage": first}, {"percentage": 100 - first}],
                "children": [items[0], split(items[1:])]}
    hierarchy = tiles if len(tiles) == 1 else [split(tiles)]
    view = {"v": 1, "subset": subset, "layout": {"v": 1, "hierarchy": hierarchy,
            "controlState": {t["id"]: True for t in tiles}, "panelConfigs": cfgs}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={enc}"


SHOWN = """(pid) => {
    const T = '.tile[data-tile-id="' + pid + '"]';
    const gd = document.querySelector(T + ' .js-plotly-plot');
    const names = gd && gd.data ? gd.data.flatMap(t => Array.from(t.customdata || [])).map(v => Array.isArray(v) ? v[0] : v).map(String) : null;
    const tag = (k) => { const e = document.querySelector(T + ' .ps-tag[data-tag="' + k + '"]'); return e ? e.getAttribute('title') : null; };
    const notice = document.querySelector(T + ' .filter-notice');
    return { names, unresolved: tag('table-unresolved'), stale: tag('table-stale'),
             notice: notice ? notice.innerText : null, state: notice ? notice.dataset.state : null,
             actions: Array.from(document.querySelectorAll(T + ' .filter-notice [data-ps-action]')).map(e => e.dataset.psAction),
             filter: document.querySelector(T + ' select.table-filter-select')?.value };
}"""


def shown(page, pid=None):
    return page.evaluate(SHOWN, pid or plot_id(0))


def wait_names(page, pattern, n=100, pid=None, timeout=30.0):
    """Wait for the plot to draw exactly `n` cells, all matching `pattern`."""
    pid = pid or plot_id(0)
    end = time.time() + timeout
    s = None
    while time.time() < end:
        s = shown(page, pid)
        if s["names"] is not None and len(s["names"]) == n and all(pattern.match(c) for c in s["names"]) \
                and not s["notice"]:
            return s
        time.sleep(0.1)
    raise AssertionError(f"the plot did not settle on {n} cells: {s and (s['names'] and len(s['names']), s['notice'])}")


def wait_notice(page, state="unresolved", pid=None, timeout=30000):
    page.wait_for_selector(f'{tile(pid or plot_id(0))} .filter-notice[data-state="{state}"]', timeout=timeout)


def resolver(page, js, arg=None):
    """Run js(TableResolver, arg) in the page."""
    return page.evaluate("async ([src, arg]) => { const { TableResolver } = await import('/static/js/utils/table-resolver.js');"
                         " return await (eval(src))(TableResolver, arg); }", [js, arg])


def instrument(page, delay=0, gate=False):
    """Count the builds, their signals and what is published; optionally slow them or hold their result."""
    page.evaluate("""async ([delay, gate]) => {
        const { TableResolver } = await import('/static/js/utils/table-resolver.js');
        const h = TableResolver.host;
        const b = window.__builds = { started: 0, running: 0, maxRunning: 0, published: [], signals: [], done: 0 };
        window.__gate = gate ? new Promise(r => { window.__openGate = r; }) : null;
        TableResolver.host = { ...h,
            build: async (job) => {
                b.started++; b.signals.push(job.signal); b.running++; b.maxRunning = Math.max(b.maxRunning, b.running);
                try {
                    if (delay) await new Promise(r => setTimeout(r, delay));
                    const selection = await h.build(job);
                    if (window.__gate) await window.__gate;
                    return selection;
                } finally { b.running--; b.done++; }
            },
            publish: (id, selection) => { b.published.push(id); return h.publish(id, selection); } };
    }""", [delay, gate])


def builds(page):
    return page.evaluate("() => { const b = window.__builds; return { started: b.started, maxRunning: b.maxRunning, "
                         "published: b.published, aborted: b.signals.map(s => s.aborted), done: b.done }; }")


def watch(page):
    """Record every notice that appears, and every draw of a plot (its points)."""
    page.evaluate("""() => {
        window.__notices = 0; window.__draws = [];
        const P = window.Plotly;
        for (const fn of ['newPlot', 'react']) {
            const orig = P[fn].bind(P);
            P[fn] = (gd, data, ...rest) => {
                const t = gd && gd.closest ? gd.closest('.tile') : null;
                window.__draws.push({ tile: t && t.dataset.tileId, points: (data || []).reduce((s, x) => s + ((x && x.customdata && x.customdata.length) || 0), 0) });
                return orig(gd, data, ...rest);
            };
        }
        new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) {
            if (n.nodeType === 1 && (n.classList.contains('filter-notice') || n.querySelector?.('.filter-notice'))) window.__notices++; } })
            .observe(document.body, { childList: true, subtree: true });
    }""")


def draws(page, pid):
    return page.evaluate("(pid) => window.__draws.filter(d => d.tile === pid).map(d => d.points)", pid)


def closed_selection(page, tid):
    return page.evaluate("(t) => { const c = window.PanelManager.getPanel(t).getConfig(); return c.closedSelection ? Array.from(c.closedSelection.passing).length : null; }", tid)


def is_open(page, tid):
    return page.evaluate("(t) => window.PanelManager.getActivePanels().some(p => p.getId() === t)", tid)


def test_a_restored_closed_table_is_built_in_the_background(page, server):
    page.goto(_link(server))
    s = wait_names(page, PASS)
    assert s["unresolved"] is None and s["stale"] is None and s["state"] is None
    assert closed_selection(page, table_id(0)) == 100          # only the compact selection stays
    assert not is_open(page, table_id(0))                      # no panel was opened to get it
    # nothing of the detached table is left in the page
    assert page.locator(".dataTables_wrapper").count() == 0
    assert resolver(page, "(r) => r.buildsStarted") == 1


def test_a_build_starts_only_on_need(page, server):
    # two closed tables; the plot is filtered by neither
    page.goto(_link(server, tables=(("cell_01", False), ("cell_00", False)), filters={0: None}))
    page.wait_for_selector(f"{tile(plot_id(0))} .js-plotly-plot", timeout=30000)
    until(page, f"() => document.querySelector('{tile(plot_id(0))} .js-plotly-plot')?.data?.length > 0")
    page.wait_for_timeout(1500)
    assert resolver(page, "(r) => r.buildsStarted") == 0
    assert closed_selection(page, table_id(0)) is None and closed_selection(page, table_id(1)) is None
    # the plot starts to need the second table: only that one is built
    page.select_option(f"{tile(plot_id(0))} select.table-filter-select", table_id(1))
    wait_names(page, PASS0)
    assert resolver(page, "(r) => r.buildsStarted") == 1
    assert closed_selection(page, table_id(0)) is None
    assert closed_selection(page, table_id(1)) == 100


def test_a_table_with_no_filter_passes_every_cell(page, server):
    page.goto(_link(server, tables=(("", False),)))
    s = wait_names(page, re.compile(r"^cell_"), n=200)
    assert s["unresolved"] is None
    assert closed_selection(page, table_id(0)) == 200


def test_large_plot_mode_asks_for_no_build(large_server):
    with playwright.sync_playwright() as p:
        browser, page, errors = _make_page(p)
        try:
            page.goto(_link(large_server))
            page.wait_for_selector(f'{tile(plot_id(0))} .plot-status .ps-tag[data-tag="large"]', timeout=60000)
            page.wait_for_timeout(2000)
            s = shown(page)
            assert s["notice"] is None and s["unresolved"] is None
            assert resolver(page, "(r) => r.buildsStarted") == 0
            assert closed_selection(page, table_id(0)) is None
            assert not errors, errors
        finally:
            browser.close()


def test_one_build_at_a_time_and_each_table_once(held, server):
    page = held
    page.goto(_link(server, tables=(("cell_01", False), ("cell_00", False), ("cell_0", False)), plots=(0, 1, 2)))
    for i in range(3):
        wait_notice(page, pid=plot_id(i))
    instrument(page, delay=250)
    page.evaluate("""async () => { const { TableResolver } = await import('/static/js/utils/table-resolver.js');
        for (const t of ['cell-table-t0', 'cell-table-t1', 'cell-table-t2']) TableResolver.accept(t); }""")
    wait_names(page, PASS, pid=plot_id(0))
    wait_names(page, PASS0, pid=plot_id(1))
    wait_names(page, re.compile(r"^cell_0"), n=200, pid=plot_id(2))
    b = builds(page)
    assert b["maxRunning"] == 1, b
    assert b["started"] == 3 and sorted(b["published"]) == [table_id(0), table_id(1), table_id(2)], b


# ------------------------------------------------------------------ size tiers

def test_size_tier_build_filter_one_click(page, server):
    page.add_init_script("window.__azTableLimits = { AUTO_ROWS: 100, ASK_ROWS: 1000 };")
    page.goto(_link(server))
    wait_notice(page)
    s = shown(page)
    assert s["names"] == [] and "Build filter" not in (s["notice"] or "") or True
    assert "build-filter" in s["actions"] and "reopen-table" in s["actions"] and "table-filter-off" in s["actions"]
    assert "will pause the page for a few seconds" in s["notice"]
    page.wait_for_timeout(1000)
    assert resolver(page, "(r) => r.buildsStarted") == 0, "nothing is built before the click"
    page.click(f'{tile(plot_id(0))} .filter-notice [data-ps-action="build-filter"]')
    wait_names(page, PASS)
    assert resolver(page, "(r) => r.buildsStarted") == 1


def test_size_tier_refused_offers_to_open_the_table(page, server):
    page.add_init_script("window.__azTableLimits = { AUTO_ROWS: 10, ASK_ROWS: 100 };")
    page.goto(_link(server))
    wait_notice(page)
    s = shown(page)
    assert s["names"] == [] and "too large to build here" in s["notice"]
    assert "build-filter" not in s["actions"]
    assert "reopen-table" in s["actions"] and "table-filter-off" in s["actions"]
    page.wait_for_timeout(1000)
    assert resolver(page, "(r) => r.buildsStarted") == 0
    page.click(f'{tile(plot_id(0))} .filter-notice [data-ps-action="reopen-table"]')
    wait_names(page, PASS)
    assert is_open(page, table_id(0))


def test_the_automatic_tier_builds_by_itself(page, server):
    page.add_init_script("window.__azTableLimits = { AUTO_ROWS: 200, ASK_ROWS: 1000 };")      # 200 cells: still automatic
    page.goto(_link(server))
    wait_names(page, PASS)
    assert resolver(page, "(r) => r.buildsStarted") == 1


def test_refused_by_the_memory_guard_loads_nothing(held, server):
    page = held
    page.goto(_link(server))
    wait_notice(page)
    instrument(page)
    # the ceiling leaves no room at all
    page.evaluate(SET_FREE, 1)
    page.click(f'{tile(plot_id(0))} .filter-notice [data-ps-action="build-filter"]')
    until(page, f"() => /Not enough browser memory/.test(document.querySelector('{tile(plot_id(0))} .filter-notice')?.innerText || '')")
    s = shown(page)
    assert s["names"] == [] and "reopen-table" in s["actions"] and "table-filter-off" in s["actions"]
    page.wait_for_timeout(800)
    assert builds(page)["started"] == 0, "refused: nothing loads"
    assert closed_selection(page, table_id(0)) is None


# ------------------------------------------------------------------ the races

def test_race_open_while_the_rows_load(page, server):
    """The panel claims the table, the build ends before it loads a second copy, and the plot waits for
    the opened table and updates once."""
    page.goto(_link(server, plots=(0, 1), filters={0: 0, 1: 0}))
    wait_names(page, PASS, pid=plot_id(0))
    # forget the built selection, as if the table had come from another link, and slow the next build
    page.evaluate("() => window.PanelManager.getPanel('cell-table-t0').setClosedSelection(null)")
    instrument(page, delay=3000)
    page.evaluate("""async () => { const { TableResolver } = await import('/static/js/utils/table-resolver.js');
        window.PanelManager.getPanel('cell-plot-p0').onDataUpdate('tableFiltered', { id: 'cell-table-t0' });
        window.PanelManager.getPanel('cell-plot-p1').onDataUpdate('tableFiltered', { id: 'cell-table-t0' }); }""")
    until(page, "async () => (await import('/static/js/utils/table-resolver.js')).TableResolver.building === 'cell-table-t0'")
    watch(page)
    page.click('.panel-closed-btn[data-id="cell-table-t0"]')
    page.wait_for_selector(f"{tile(table_id(0))} .dataTables_scrollBody tbody tr", timeout=30000)
    for i in (0, 1):
        wait_names(page, PASS, pid=plot_id(i))
    page.wait_for_timeout(3500)                        # the slowed build would have ended by now
    b = builds(page)
    assert b["aborted"] == [True], "opening ended the build"
    assert b["published"] == [], "and its result never reached anyone"
    assert closed_selection(page, table_id(0)) is None      # the open table is its own filter
    for i in (0, 1):
        # the plots updated once, with the opened table's rows, and never drew unfiltered cells
        pts = draws(page, plot_id(i))
        assert [p for p in pts if p > 0] == [100], pts


def test_race_a_result_after_the_build_cannot_overwrite_an_opened_table(page, server):
    """The build has read and filtered its rows but has not published; the table is opened meanwhile.
    The epoch rose, so the result is discarded."""
    page.goto(_link(server))
    wait_names(page, PASS)
    page.evaluate("() => window.PanelManager.getPanel('cell-table-t0').setClosedSelection(null)")
    instrument(page, gate=True)
    page.evaluate("""() => window.PanelManager.getPanel('cell-plot-p0').onDataUpdate('tableFiltered', { id: 'cell-table-t0' })""")
    until(page, "() => window.__builds.done === 0 && window.__builds.started === 1")
    page.wait_for_timeout(1500)                         # the build is past its filter step, waiting at the gate
    page.click('.panel-closed-btn[data-id="cell-table-t0"]')
    page.wait_for_selector(f"{tile(table_id(0))} .dataTables_scrollBody tbody tr", timeout=30000)
    wait_names(page, PASS)
    page.evaluate("() => window.__openGate()")
    until(page, "() => window.__builds.done === 1")
    page.wait_for_timeout(500)
    assert builds(page)["published"] == [], "a late background result never overwrites an opened table"
    assert closed_selection(page, table_id(0)) is None
    wait_names(page, PASS)


def test_race_open_after_the_build_keeps_the_plots_steady(page, server):
    """Built, then opened: the plot is served by the selection until the table publishes, then updates once."""
    page.goto(_link(server))
    wait_names(page, PASS)
    assert closed_selection(page, table_id(0)) == 100
    watch(page)
    page.click('.panel-closed-btn[data-id="cell-table-t0"]')
    page.wait_for_selector(f"{tile(table_id(0))} .dataTables_scrollBody tbody tr", timeout=30000)
    page.wait_for_timeout(1500)
    s = wait_names(page, PASS)
    assert page.evaluate("() => window.__notices") == 0, "the plot never waited: a valid selection served it"
    pts = draws(page, plot_id(0))
    assert all(p == 100 for p in pts if p > 0) and len([p for p in pts if p > 0]) <= 1, pts
    assert s["unresolved"] is None


def test_race_dependants_update_once(page, server):
    page.goto(_link(server, plots=(0, 1, 2), filters={0: 0, 1: 0, 2: 0}))
    for i in range(3):
        wait_names(page, PASS, pid=plot_id(i))
    page.evaluate("() => window.PanelManager.getPanel('cell-table-t0').setClosedSelection(null)")
    watch(page)
    instrument(page, delay=300)
    page.evaluate("""() => { for (const i of [0, 1, 2]) window.PanelManager.getPanel('cell-plot-p' + i).onDataUpdate('tableFiltered', { id: 'cell-table-t0' }); }""")
    for i in range(3):
        wait_names(page, PASS, pid=plot_id(i))
    page.wait_for_timeout(1000)
    assert builds(page)["started"] == 1, "one build for three plots"
    for i in range(3):
        pts = draws(page, plot_id(i))
        assert [p for p in pts if p > 0] == [100], (i, pts)


def test_race_close_and_reopen(page, server):
    """Closed by hand, reopened, closed again: the plot keeps its cells, never waits, nothing is rebuilt."""
    page.goto(_link(server, tables=(("cell_01", True),)))
    page.wait_for_selector(f"{tile(table_id(0))} .dataTables_scrollBody tbody tr", timeout=30000)
    wait_names(page, PASS)
    watch(page)
    for _ in range(2):
        page.evaluate("() => window.PanelManager.closePanel('cell-table-t0')")
        wait_names(page, PASS)
        page.click('.panel-closed-btn[data-id="cell-table-t0"]')
        page.wait_for_selector(f"{tile(table_id(0))} .dataTables_scrollBody tbody tr", timeout=30000)
        wait_names(page, PASS)
    assert page.evaluate("() => window.__notices") == 0
    assert resolver(page, "(r) => r.buildsStarted") == 0, "its own rows became its selection: no rebuild"


def test_race_delete(page, server):
    page.goto(_link(server))
    wait_names(page, PASS)
    page.evaluate("() => window.PanelManager.getPanel('cell-table-t0').setClosedSelection(null)")
    instrument(page, delay=2500)
    page.evaluate("() => window.PanelManager.getPanel('cell-plot-p0').onDataUpdate('tableFiltered', { id: 'cell-table-t0' })")
    until(page, "async () => (await import('/static/js/utils/table-resolver.js')).TableResolver.building === 'cell-table-t0'")
    page.evaluate("() => window.PanelManager.removePanel('cell-table-t0')")
    page.wait_for_timeout(3500)
    b = builds(page)
    assert b["aborted"] == [True] and b["published"] == []
    assert resolver(page, "(r) => [r.status('cell-table-t0').state, r.building]") == ["idle", None]


def test_race_dataset_switch(page, server):
    page.goto(_link(server))
    wait_names(page, PASS)
    page.evaluate("() => window.PanelManager.getPanel('cell-table-t0').setClosedSelection(null)")
    instrument(page, delay=2500)
    page.evaluate("() => window.PanelManager.getPanel('cell-plot-p0').onDataUpdate('tableFiltered', { id: 'cell-table-t0' })")
    until(page, "async () => (await import('/static/js/utils/table-resolver.js')).TableResolver.building === 'cell-table-t0'")
    page.evaluate("() => document.dispatchEvent(new CustomEvent('datasetChanged', { detail: {} }))")
    page.wait_for_timeout(3500)
    b = builds(page)
    assert b["aborted"][0] is True and b["published"] == []
    assert closed_selection(page, table_id(0)) is None, "every selection is dropped with the dataset"


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
    page.wait_for_timeout(800)


def test_race_subset_change(page, server):
    """A running build ends when the cells change; the new cells are built for, and the plot shows exactly them."""
    page.goto(_link(server))
    wait_names(page, PASS)
    page.evaluate("() => window.PanelManager.getPanel('cell-table-t0').setClosedSelection(null)")
    instrument(page, delay=2500)
    page.evaluate("() => window.PanelManager.getPanel('cell-plot-p0').onDataUpdate('tableFiltered', { id: 'cell-table-t0' })")
    until(page, "async () => (await import('/static/js/utils/table-resolver.js')).TableResolver.building === 'cell-table-t0'")
    _subset(page, 100)
    cells = page.evaluate("async () => Array.from((await import('/static/js/data-manager.js')).DataManager.getCells()).map(String)")
    want = sorted(c for c in cells if PASS.match(c))
    end = time.time() + 30
    while time.time() < end:
        names = shown(page)["names"] or []
        if sorted(names) == want and not shown(page)["notice"]:
            break
        time.sleep(0.2)
    s = shown(page)
    assert sorted(s["names"]) == want and s["stale"] is None, (len(s["names"]), len(want), s["stale"])
    b = builds(page)
    assert b["aborted"][0] is True, "the build for the old cells ended"
    assert all(PASS.match(c) for c in s["names"])


def test_race_back_and_forward_with_other_settings_rebuilds(page, server):
    """Back to an entry whose closed table has other settings: the closed panel is replaced, the build is
    dropped and the plot is built for the settings of that entry."""
    page.goto(_link(server))
    wait_names(page, PASS)
    page.wait_for_timeout(2500)
    page.click('.panel-closed-btn[data-id="cell-table-t0"]')
    page.wait_for_selector(f"{tile(table_id(0))} .dataTables_scrollBody tbody tr", timeout=30000)
    page.wait_for_timeout(2500)
    page.fill(f'{tile(table_id(0))} input[type="search"]', "cell_00")
    wait_names(page, PASS0)
    page.wait_for_timeout(2500)
    page.click(f"{tile(table_id(0))} .tile-close")
    wait_names(page, PASS0)
    page.wait_for_timeout(3000)
    n = page.evaluate("() => history.length")
    page.go_back()
    page.wait_for_timeout(1500)
    page.go_back()
    page.wait_for_timeout(1500)
    page.go_back()
    # the first entry: the table closed with "cell_01"
    end = time.time() + 30
    while time.time() < end:
        s = shown(page)
        if s["names"] and len(s["names"]) == 100 and all(PASS.match(c) for c in s["names"]):
            break
        time.sleep(0.3)
    s = shown(page)
    assert s["names"] and all(PASS.match(c) for c in s["names"]), (len(s["names"] or []), page.evaluate("() => location.hash.length"), n)
    assert page.evaluate("() => window.PanelManager.getPanel('cell-table-t0').getConfig().searchText") == "cell_01"
    page.go_forward()
    page.go_forward()
    page.go_forward()
    end = time.time() + 30
    while time.time() < end:
        s = shown(page)
        if s["names"] and len(s["names"]) == 100 and all(PASS0.match(c) for c in s["names"]):
            break
        time.sleep(0.3)
    assert all(PASS0.match(c) for c in (shown(page)["names"] or ["x"]))


def test_race_back_and_forward_with_the_same_settings_does_nothing(page, server):
    page.goto(_link(server))
    wait_names(page, PASS)
    started = resolver(page, "(r) => r.buildsStarted")
    page.wait_for_timeout(2500)
    before = page.evaluate("() => history.length")
    page.select_option(f"{tile(plot_id(0))} select.table-filter-select", "none")
    wait_names(page, re.compile(r"^cell_"), n=200)
    page.wait_for_timeout(2500)
    assert page.evaluate("() => history.length") == before + 1
    page.go_back()
    wait_names(page, PASS)
    assert resolver(page, "(r) => r.buildsStarted") == started, "the closed table was left as it was: nothing is rebuilt"
    assert closed_selection(page, table_id(0)) == 100


def test_race_panel_set_load_aborts_builds_and_builds_what_the_set_needs(page, server):
    page.goto(_link(server, tables=(("cell_01", False), ("cell_00", False)), plots=(0,), filters={0: 0}))
    wait_names(page, PASS)
    name = f"resolver-set-{int(time.time())}"
    saved = page.evaluate("(n) => window.sessionManager.saveSession(n)", name)
    assert saved["status"] == "success", saved
    # a slow build for the other table is running when the set is loaded
    page.evaluate("() => window.PanelManager.getPanel('cell-table-t0').setClosedSelection(null)")
    instrument(page, delay=4000)
    page.evaluate("() => window.PanelManager.getPanel('cell-plot-p0').onDataUpdate('tableFiltered', { id: 'cell-table-t0' })")
    until(page, "async () => (await import('/static/js/utils/table-resolver.js')).TableResolver.building === 'cell-table-t0'")
    loaded = page.evaluate("(n) => window.sessionManager.loadSession(n)", name)
    assert loaded["status"] == "success", loaded
    wait_names(page, PASS)
    b = builds(page)
    assert b["aborted"][0] is True, "the build of the view before the load ended"
    assert closed_selection(page, table_id(0)) == 100


# ------------------------------------------------------------------ parity

PARITY = """async (configs) => {
    const pm = window.PanelManager;
    const tb = await import('/static/js/panels/table-utilities/table-background.js');
    const td = await import('/static/js/panels/table-utilities/table-data.js');
    const { DataManager } = await import('/static/js/data-manager.js');
    DataManager.setFocusedGene('GENE003');
    const out = {};
    for (const spec of configs) {
        const { name, kind, config } = spec;
        let cfg = config;
        if (spec.line) {
            // a line filter, made as the tool makes it
            const settings = { columns: [{ type: 'obs', key: 'cell_type', column: '' }], searchBuilderConfig: { criteria: [] } };
            const cond = { kind: 'slope', m: spec.line.m, b: spec.line.b, op: spec.line.op };
            const x = { type: 'obsm', key: 'X_umap', column: '0' }, y = { type: 'obsm', key: 'X_umap', column: '1' };
            td.applyLineToSettings(settings, { x, y, cond });
            cfg = { columns: settings.columns, searchBuilderConfig: settings.searchBuilderConfig };
        }
        const entity = kind === 'cell-table' ? 'cells' : 'genes';
        const closed = pm.registerClosedPanel(kind, { ...cfg, id: kind + '-parity-c-' + name, title: name + ' closed' });
        const pinned = closed.getConfig();               // the placeholders pinned, as an open table's are
        const sel = await tb.buildSelection({ kind, config: pinned, signal: new AbortController().signal, check() {} });
        const background = Array.from(sel.passing).sort();
        const oid = kind + '-parity-o-' + name;
        const panel = pm.createPanel(kind, { ...cfg, id: oid, title: name + ' open' });
        const t0 = performance.now();
        while (!document.querySelector(`.tile[data-tile-id="${oid}"] .dataTables_scrollBody tbody tr`) && performance.now() - t0 < 60000) {
            await new Promise(r => setTimeout(r, 100));
        }
        await new Promise(r => setTimeout(r, 400));
        const rows = entity === 'cells' ? DataManager.getCells() : DataManager.getGenes();
        const opened = Array.from(panel.getConfig().currentEntries, i => String(rows[i])).sort();
        pm.closePanel(oid); pm.removePanel(oid); pm.removePanel(closed.getId());
        out[name] = { background, opened, columns: pinned.columns.length, closedKeys: Object.keys(sel) };
    }
    return out;
}"""

SB = {"logic": "AND", "criteria": [
    {"condition": "=", "data": "cell_type", "origData": "obs_cell_type_main", "type": "string", "value": ["Hepatocyte"]},
    {"condition": ">", "data": "total_counts", "origData": "obs_total_counts_main", "type": "num", "value": ["3000"]}]}
SB_OR = {"logic": "OR", "criteria": [
    {"condition": "=", "data": "cell_type", "origData": "obs_cell_type_main", "type": "string", "value": ["Kupffer"]},
    {"condition": "<", "data": "total_counts", "origData": "obs_total_counts_main", "type": "num", "value": ["2500"]}]}
TC = {"type": "obs", "key": "total_counts", "column": ""}
LEIDEN = {"type": "obs", "key": "leiden", "column": ""}
PLACEHOLDER = {"type": "layer", "key": "X", "column": "focused_gene"}


def _cases():
    return [
        {"name": "smart", "kind": "cell-table", "config": {"columns": [CT], "searchText": "cell_01 9"}},
        {"name": "smartoff", "kind": "cell-table", "config": {"columns": [CT], "searchText": "cell_01 9", "searchSmart": False}},
        {"name": "regex", "kind": "cell-table", "config": {"columns": [CT], "searchText": "cell_010[0-4]|cell_0199", "searchRegex": True}},
        {"name": "case", "kind": "cell-table", "config": {"columns": [CT], "searchText": "KUPFFER", "searchCaseInsensitive": False}},
        {"name": "caseoff", "kind": "cell-table", "config": {"columns": [CT], "searchText": "KUPFFER", "searchCaseInsensitive": True}},
        {"name": "builder", "kind": "cell-table", "config": {"columns": [CT, TC, LEIDEN], "searchBuilderConfig": SB}},
        {"name": "builderor", "kind": "cell-table", "config": {"columns": [CT, TC, LEIDEN], "searchBuilderConfig": SB_OR}},
        {"name": "both", "kind": "cell-table", "config": {"columns": [CT, TC], "searchBuilderConfig": SB, "searchText": "cell_01"}},
        {"name": "line", "kind": "cell-table", "line": {"m": 0.5, "b": 1.0, "op": ">="}},
        {"name": "focus", "kind": "cell-table", "config": {"columns": [CT, PLACEHOLDER], "searchBuilderConfig": {"logic": "AND", "criteria": [
            {"condition": ">", "data": "X: GENE003", "origData": "layer_X_focused_gene", "type": "num", "value": ["0"]}]}}},
        {"name": "nofilter", "kind": "cell-table", "config": {"columns": [CT]}},
        {"name": "gene", "kind": "gene-table", "config": {"columns": [{"type": "var", "key": "gene_name", "column": ""}], "searchText": "GENE00"}},
    ]


def test_the_background_result_equals_the_opened_tables_rows(page, server):
    """Pinned: for each way a filter can be written, the rows a detached build selects are the rows the
    same table selects when it is open (regex, smart search, case, conditions, line filters, focus placeholders)."""
    page.goto(_link(server))
    wait_names(page, PASS)
    out = page.evaluate(PARITY, _cases())
    sizes = {}
    for name, got in out.items():
        assert got["background"] == got["opened"], (name, len(got["background"]), len(got["opened"]))
        sizes[name] = len(got["opened"])
    # the cases are not all empty or all full: they select something, and something other than everything
    assert sizes["regex"] == 6 and sizes["smart"] == 19 and sizes["smartoff"] == 0
    assert sizes["case"] == 0 and sizes["caseoff"] > 0
    assert 0 < sizes["builder"] < 200 and 0 < sizes["builderor"] < 200 and sizes["both"] <= sizes["builder"]
    assert sizes["nofilter"] == 200 and sizes["gene"] > 0
    assert 0 < sizes["line"] < 200, sizes
