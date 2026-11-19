"""Closed panels come back from links and panel sets, for every panel type.

Step 0b of the gene-signature plan. Recorded before this change:

* a share link wrote the configuration of every closed panel and opening it
  restored none of them: a plot filtered by a closed table silently lost
  its filter (the select went back to None);
* a panel set registered its closed panels AFTER the open ones were built,
  so the same reset could fire;
* a table's regex, smart and case toggles were local variables: a regex
  search restored from a link selected other rows.

Now closed panels are registered from their configuration alone BEFORE the
open panels are built (utils/closed-restore.js), for every panel type. A
plot filtered by a restored closed table keeps it selected, draws no points
and says so (a notice over the plot and the tag "Filter not applied yet");
opening the table computes its rows and the plot updates by itself. Back and
Forward put the closed panels of the entry on the page without adding history
entries. Large-plot mode applies no table filter, so there it draws every
cell under its "Large plot" tag.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
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

from annzarro.tests.browser.test_memory_guard import STORE, _serve, until  # noqa: E402

B = '.tile[data-tile-id="cell-plot-B"]'
A = '.tile[data-tile-id="cell-table-A"]'
PASS = re.compile(r"^cell_01\d\d$")
X = {"type": "obsm", "key": "X_umap", "column": "0"}
Y = {"type": "obsm", "key": "X_umap", "column": "1"}
CT = {"type": "obs", "key": "cell_type", "column": ""}

# one closed panel of every type, saved with settings that are not the defaults
CLOSED = {
    "cell-table-A": {"id": "cell-table-A", "title": "Table 1", "columns": [CT], "searchText": "cell_01"},
    "gene-table-E": {"id": "gene-table-E", "title": "Genes 1", "searchText": "Gene"},
    "cell-plot-C": {"id": "cell-plot-C", "title": "Closed cell plot", "x": X, "y": Y, "z": None, "color": CT},
    "gene-plot-D": {"id": "gene-plot-D", "title": "Closed gene plot"},
    "gene-set-F": {"id": "gene-set-F", "title": "Closed analysis"},
}
TYPES = {"cell-table-A": "cell-table", "gene-table-E": "gene-table", "cell-plot-C": "cell-plot",
         "gene-plot-D": "gene-plot", "gene-set-F": "gene-set"}


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


def _view(open_ids, configs, controls=True):
    tiles = [{"type": "tile", "id": i, "controlsVisible": True} for i in open_ids]
    hierarchy = tiles if len(tiles) == 1 else [{"type": "split", "direction": "horizontal",
                                                 "panes": [{"percentage": 60}, {"percentage": 40}], "children": tiles}]
    return {"v": 1, "layout": {"v": 1, "hierarchy": hierarchy,
                               "controlState": {i: controls for i in open_ids}, "panelConfigs": configs}}


def _url(root, view):
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={enc}"


def _plot_cfg(**extra):
    return {"id": "cell-plot-B", "x": X, "y": Y, "z": None, "color": CT, "tableFilter": "cell-table-A",
            "removeNonTableEntries": True, **extra}


def _link(root, closed=None, table_open=False, table_cfg=None, plot=None):
    cfgs = {"cell-plot-B": plot or _plot_cfg()}
    closed = dict(CLOSED if closed is None else closed)
    if "cell-table-A" in closed:
        closed["cell-table-A"] = {**closed["cell-table-A"], **(table_cfg or {})}
    cfgs.update(closed)
    open_ids = ["cell-plot-B"] + (["cell-table-A"] if table_open else [])
    return _url(root, _view(open_ids, cfgs))


SHOWN = """() => {
    const gd = document.querySelector('%s .js-plotly-plot');
    if (!gd || !gd.data) return null;
    const names = gd.data.flatMap(t => Array.from(t.customdata || [])).map(v => Array.isArray(v) ? v[0] : v).map(String);
    const xs = gd.data.reduce((s, t) => s + (t.x ? t.x.length : 0), 0);
    const tag = (k) => { const e = document.querySelector('%s .ps-tag[data-tag="' + k + '"]'); return e ? e.getAttribute('title') : null; };
    const sel = document.querySelector('%s select.table-filter-select');
    return { names, xs, unresolved: tag('table-unresolved'), stale: tag('table-stale'),
             notice: !!document.querySelector('%s .filter-notice[data-state="unresolved"]'),
             filter: sel ? sel.value : null,
             summary: document.querySelector('%s .plot-status')?.getAttribute('data-summary') || '' };
}""" % (B, B, B, B, B)

PANELS = """() => { const open = new Set(window.PanelManager.getActivePanels().map(p => p.getId()));
    return Object.fromEntries(window.PanelManager.getAllPanels().map(p => [p.getId(),
        { type: p.getType(), open: open.has(p.getId()), title: p.getTitle(), config: p.getConfig() }])); }"""


def _state(page):
    return page.evaluate(SHOWN)


def _panels(page):
    return page.evaluate(PANELS)


def _wait_plot(page, notice=True):
    page.wait_for_selector(f"{B} .js-plotly-plot", timeout=30000)
    if notice:
        page.wait_for_selector(f'{B} .filter-notice[data-state="unresolved"]', timeout=20000)


def _history_length(page):
    return page.evaluate("() => history.length")


def _captured_url(page, root):
    """The share link the app itself would copy, built from the view on screen."""
    payload = page.evaluate("""async () => {
        const { encodeViewPayload } = await import('/static/js/utils/deeplink.js');
        return await encodeViewPayload(window.sessionManager.captureView());
    }""")
    return f"{root}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={payload}"


# ---------------------------------------------------------------- round trips

def test_link_restores_a_closed_panel_of_every_type(page, server):
    page.goto(_link(server))
    _wait_plot(page)
    panels = _panels(page)
    for pid, type_ in TYPES.items():
        assert pid in panels, (pid, sorted(panels))
        assert panels[pid]["type"] == type_
        assert panels[pid]["open"] is False
        assert panels[pid]["title"] == CLOSED[pid]["title"]
    # configuration only: nothing computed, nothing from a DataTable
    table = panels["cell-table-A"]["config"]
    assert table["searchText"] == "cell_01"
    assert "closedSelection" not in table
    assert list(table["currentEntries"]) == []
    # the open plot kept its filter, and is in the chooser's closed list
    assert _state(page)["filter"] == "cell-table-A"
    closed = page.evaluate("() => [...document.querySelectorAll('.source-panel-option.closed-panel')].map(e => e.dataset.id)")
    assert set(TYPES) <= set(closed)


def test_link_round_trip_through_the_apps_own_share_link(page, server):
    page.goto(_link(server))
    _wait_plot(page)
    first = _panels(page)
    link = _captured_url(page, server)
    page.goto("about:blank")
    page.goto(link)
    _wait_plot(page)
    again = _panels(page)
    for pid in TYPES:
        assert pid in again, pid
        assert again[pid]["open"] is False
        for key in ("searchText", "title"):
            assert again[pid]["config"].get(key) == first[pid]["config"].get(key), (pid, key)
    assert _state(page)["filter"] == "cell-table-A"


def test_panel_set_round_trip_registers_closed_panels_before_the_plot(page, server):
    page.goto(_link(server))
    _wait_plot(page)
    name = f"closed-set-{int(time.time())}"
    saved = page.evaluate("(n) => window.sessionManager.saveSession(n)", name)
    assert saved["status"] == "success", saved
    page.goto(server)
    page.wait_for_function("() => window.sessionManager && window.PanelManager")
    loaded = page.evaluate("(n) => window.sessionManager.loadSession(n)", name)
    assert loaded["status"] == "success", loaded
    _wait_plot(page)
    panels = _panels(page)
    for pid, type_ in TYPES.items():
        assert pid in panels and panels[pid]["type"] == type_ and panels[pid]["open"] is False, (pid, panels.keys())
    # the plot found its table when it was built: the filter was never reset to None
    s = _state(page)
    assert s["filter"] == "cell-table-A"
    assert s["names"] == [] and s["notice"] and s["unresolved"]


def test_unknown_and_disabled_types_are_skipped_without_an_error(page, server):
    closed = dict(CLOSED)
    closed["widget-thing-9"] = {"id": "widget-thing-9", "title": "From the future"}
    closed["nodash"] = {"id": "nodash"}
    page.goto(_link(server, closed=closed))
    _wait_plot(page)
    panels = _panels(page)
    assert "widget-thing-9" not in panels and "nodash" not in panels
    assert set(TYPES) <= set(panels)


# ------------------------------------------------------- regex, smart and case

def test_a_regex_table_selects_the_same_rows_after_restore(page, server):
    page.goto(_url(server, _view(["cell-plot-B", "cell-table-A"], {
        "cell-plot-B": _plot_cfg(),
        "cell-table-A": {"id": "cell-table-A", "title": "Table 1", "columns": [CT]}})))
    page.wait_for_selector(f"{A} .dataTables_scrollBody tbody tr", timeout=30000)
    page.fill(f'{A} input[type="search"]', "^cell_010[0-4]$")
    page.click(f'{A} button[id^="btnRegex_"]')
    until(page, "() => window.PanelManager.getPanel('cell-table-A').getConfig().currentEntries.length === 5")
    cfg = page.evaluate("() => { const c = window.PanelManager.getPanel('cell-table-A').getConfig(); return {r: c.searchRegex, s: c.searchSmart, c: c.searchCaseInsensitive, t: c.searchText}; }")
    assert cfg == {"r": True, "s": True, "c": True, "t": "^cell_010[0-4]$"}
    open_rows = page.evaluate("() => Array.from(window.PanelManager.getPanel('cell-table-A').getConfig().currentEntries)")

    # open: the link keeps the toggles
    link_open = _captured_url(page, server)
    page.goto("about:blank")
    page.goto(link_open)
    page.wait_for_selector(f"{A} .dataTables_scrollBody tbody tr", timeout=30000)
    until(page, "() => window.PanelManager.getPanel('cell-table-A').getConfig().currentEntries.length > 0")
    assert page.evaluate("() => Array.from(window.PanelManager.getPanel('cell-table-A').getConfig().currentEntries)") == open_rows
    assert page.locator(f'{A} button[id^="btnRegex_"].active').count() == 1

    # closed, then opened: the same rows
    page.evaluate("() => window.PanelManager.closePanel('cell-table-A')")
    page.wait_for_timeout(300)
    link_closed = _captured_url(page, server)
    page.goto("about:blank")
    page.goto(link_closed)
    _wait_plot(page)
    page.click('.panel-closed-btn[data-id="cell-table-A"]')
    page.wait_for_selector(f"{A} .dataTables_scrollBody tbody tr", timeout=30000)
    until(page, "() => window.PanelManager.getPanel('cell-table-A').getConfig().currentEntries.length > 0")
    assert page.evaluate("() => Array.from(window.PanelManager.getPanel('cell-table-A').getConfig().currentEntries)") == open_rows
    assert page.locator(f'{A} button[id^="btnRegex_"].active').count() == 1


def test_case_and_smart_toggles_are_saved(page, server):
    page.goto(_url(server, _view(["cell-plot-B", "cell-table-A"], {
        "cell-plot-B": _plot_cfg(),
        "cell-table-A": {"id": "cell-table-A", "title": "Table 1", "columns": [CT],
                         "searchRegex": False, "searchSmart": False, "searchCaseInsensitive": False}})))
    page.wait_for_selector(f"{A} .dataTables_scrollBody tbody tr", timeout=30000)
    assert page.locator(f'{A} button[id^="btnCase_"].active').count() == 1       # case sensitive
    assert page.locator(f'{A} button[id^="btnSmart_"].active').count() == 0      # smart off
    page.click(f'{A} button[id^="btnSmart_"]')
    cfg = page.evaluate("() => window.PanelManager.getPanel('cell-table-A').getConfig()")
    assert cfg["searchSmart"] is True and cfg["searchCaseInsensitive"] is False and cfg["searchRegex"] is False


# --------------------------------------------------------- old links and sets

def test_an_old_link_with_a_filter_on_a_missing_table_still_opens(page, server):
    # as a v0.4 link: the plot names a table that no panelConfig carries
    page.goto(_url(server, _view(["cell-plot-B"], {"cell-plot-B": _plot_cfg()})))
    page.wait_for_selector(f"{B} .js-plotly-plot", timeout=30000)
    until(page, f"() => document.querySelector('{B} .js-plotly-plot')?.data?.length > 0")
    s = _state(page)
    assert s["notice"] is False and s["unresolved"] is None


def test_an_old_link_without_closed_panels_has_no_closed_panels(page, server):
    page.goto(_url(server, _view(["cell-plot-B", "cell-table-A"], {
        "cell-plot-B": _plot_cfg(), "cell-table-A": {"id": "cell-table-A", "title": "Table 1", "columns": [CT]}})))
    page.wait_for_selector(f"{A} .dataTables_scrollBody tbody tr", timeout=30000)
    panels = _panels(page)
    assert sorted(panels) == ["cell-plot-B", "cell-table-A"]
    assert all(p["open"] for p in panels.values())


# ---------------------------------------------------------------- the waiting

def test_a_filter_not_applied_yet_draws_no_points_in_either_mode_then_updates_on_open(page, server):
    for remove in (True, False):
        page.goto("about:blank")
        page.goto(_link(server, plot=_plot_cfg(removeNonTableEntries=remove)))
        _wait_plot(page)
        s = _state(page)
        # no points at all: not the grey of a filter that nothing passes
        assert s["names"] == [] and s["xs"] == 0, (remove, s["xs"])
        assert s["unresolved"] and s["stale"] is None
        assert s["filter"] == "cell-table-A"
        assert page.locator(f'{B} [data-ps-action="reopen-table"]').count() >= 1
        # the notice is a layer over the plot: it does not move or resize it
        plot_box = page.locator(f"{B} .js-plotly-plot").bounding_box()
        page.click(f'{B} .ps-tag[data-tag="table-unresolved"]')
        assert page.locator(f"{B} .js-plotly-plot").bounding_box() == plot_box
        # opened: its subset is computed and the plot updates by itself
        page.click('.panel-closed-btn[data-id="cell-table-A"]')
        page.wait_for_selector(f"{B} .filter-notice", state="detached", timeout=30000)
        until(page, f"() => document.querySelectorAll('{B} .ps-tag[data-tag=\"table-unresolved\"]').length === 0")
        until(page, f"() => document.querySelector('{B} .js-plotly-plot').data.some(t => t.customdata && t.customdata.length)")
        s = _state(page)
        assert s["filter"] == "cell-table-A"
        assert PASS.match(s["names"][0]) if remove else True
        if remove:
            assert len(s["names"]) == 100 and all(PASS.match(c) for c in s["names"])


def test_stop_filtering_ends_the_waiting_state(page, server):
    page.goto(_link(server))
    _wait_plot(page)
    page.click(f'{B} .filter-notice [data-ps-action="table-filter-off"]')
    page.wait_for_selector(f"{B} .filter-notice", state="detached", timeout=20000)
    until(page, f"() => document.querySelector('{B} .js-plotly-plot').data.some(t => t.customdata && t.customdata.length)")
    s = _state(page)
    assert s["filter"] == "none" and len(s["names"]) == 200 and s["unresolved"] is None


def test_large_plot_mode_draws_every_cell_and_never_waits(large_server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1400, "height": 1000})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(_link(large_server))
            page.wait_for_selector(f'{B} .plot-status .ps-tag[data-tag="large"]', timeout=60000)
            page.wait_for_timeout(1500)
            s = page.evaluate("""() => { const g = document.querySelector('%s .js-plotly-plot');
                return { points: g._fullData.filter(t => !/Focused/.test(t.name || '') && !(t.x && t.x.length === 1 && t.x[0] === null))
                    .reduce((s, t) => s + (t.x ? t.x.length : 0), 0),
                    notice: !!document.querySelector('%s .filter-notice'),
                    tag: !!document.querySelector('%s .ps-tag[data-tag="table-unresolved"]') }; }""" % (B, B, B))
            assert s == {"points": 200, "notice": False, "tag": False}, s
            assert not errors, errors
        finally:
            browser.close()


# -------------------------------------------------------- Back and Forward

def test_back_and_forward_bring_the_closed_panels_back_without_new_entries(page, server):
    page.goto(_link(server))
    _wait_plot(page)
    assert _state(page)["filter"] == "cell-table-A"
    page.wait_for_timeout(2500)
    before = _history_length(page)
    # the user empties the closed list of the table (Clear closed panels): the view changes, an entry is written
    page.evaluate("() => window.PanelManager.removePanel('cell-table-A')")
    until(page, "() => document.querySelector('%s select.table-filter-select')?.value === 'none'" % B)
    page.wait_for_timeout(2500)
    assert _history_length(page) == before + 1
    # Back: the entry lists the table closed, and the plot filtered by it
    page.go_back()
    page.wait_for_selector(f'{B} .filter-notice[data-state="unresolved"]', timeout=30000)
    panels = _panels(page)
    assert "cell-table-A" in panels and panels["cell-table-A"]["open"] is False
    assert panels["cell-table-A"]["config"]["searchText"] == "cell_01"
    assert _state(page)["filter"] == "cell-table-A"
    page.wait_for_timeout(3500)
    assert _history_length(page) == before + 1                      # no duplicate entry
    # Forward: no filter again; nothing is thrown away, nothing is added to the history
    page.go_forward()
    until(page, "() => document.querySelector('%s select.table-filter-select')?.value === 'none'" % B)
    page.wait_for_timeout(3500)
    assert _history_length(page) == before + 1
    assert _state(page)["filter"] == "none"


def test_back_and_forward_over_a_table_closed_by_the_user(page, server):
    page.goto(_link(server, table_open=True, table_cfg={"searchText": "cell_01"}))
    page.wait_for_selector(f"{A} .dataTables_scrollBody tbody tr", timeout=30000)
    until(page, f"() => document.querySelector('{B} .js-plotly-plot')?.data?.some(t => t.customdata && t.customdata.length)")
    page.wait_for_timeout(2500)
    before = _history_length(page)
    page.click(f"{A} .tile-close")
    page.wait_for_timeout(2500)
    assert _history_length(page) == before + 1
    page.go_back()
    page.wait_for_selector(f"{A} .dataTables_scrollBody tbody tr", timeout=30000)
    until(page, f"() => document.querySelector('{B} .js-plotly-plot')?.data?.some(t => t.customdata && t.customdata.length)")
    assert _state(page)["filter"] == "cell-table-A"
    page.go_forward()
    until(page, "() => !document.querySelector('%s')" % A)
    assert _panels(page)["cell-table-A"]["open"] is False
    page.wait_for_timeout(3500)
    assert _history_length(page) == before + 1
    assert _state(page)["filter"] == "cell-table-A"
