"""Three v0.4.0 findings on searching and the subset badge, in a real browser.

1. Table search, regular expression on with Smart Search on (the default):
   DataTables wrapped the term as ^(?=.*?TERM).*$, so `0001|0199` found
   only the first alternative. A regular expression is now searched as
   written: on cell and gene tables, in the CSV export and in the set a
   linked plot draws.
2. The Focused Cell picker never says "No cell matches" while a search is
   still running: under a subset, the shown cells' search answers at once
   and the dataset-wide one waits for the name index (about 30 s at 95.6M
   cells). It says it is searching, and building the name index when the
   server says so, then answers.
3. After Apply with a balance, the subset badge names the balance, not only
   its tooltip.

The store is the committed 200-cell fixture (cells cell_0000..cell_0199,
genes GENE000..).

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
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

from annzarro.tests.browser.test_memory_guard import STORE, _serve  # noqa: E402

CT = '.tile[data-tile-id="cell-table-C"]'
GT = '.tile[data-tile-id="gene-table-G"]'
PLOT = '.tile[data-tile-id="cell-plot-P"]'


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    root, proc = _serve(tmp_path_factory)
    yield root
    proc.terminate()
    proc.wait(10)


@pytest.fixture(scope="module")
def browser():
    with playwright.sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


def _link(root, subset=None, tiles=None, configs=None, focus=None):
    tiles = tiles or []

    def nest(ts):
        # a split holds two panes: three tiles are a tile beside a split
        if len(ts) == 1:
            return ts[0]
        return {"type": "split", "direction": "horizontal", "height": 900,
                "panes": [{"percentage": 100 / len(ts)}, {"percentage": 100 - 100 / len(ts)}],
                "children": [ts[0], nest(ts[1:])]}
    hierarchy = [nest(tiles)] if tiles else []
    view = {"v": 1, "subset": subset, "constants": {"focusedCell": focus} if focus else {},
            "layout": {"v": 1, "hierarchy": hierarchy, "controlState": {}, "panelConfigs": configs or {}}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={enc}"


def _until(page, js, timeout=30.0):
    for _ in range(int(timeout * 10)):
        value = page.evaluate(js)
        if value:
            return value
        page.wait_for_timeout(100)
    raise AssertionError(f"timed out waiting for: {js[:160]}")


ROWS = """(sel) => { const t = document.querySelector(sel + ' .dataTables_scrollBody table');
  if (!t || !window.jQuery) return null;
  const api = jQuery(t).DataTable();
  return api.rows({search: 'applied'}).data().toArray().map(r => Array.isArray(r) ? r[0] : Object.values(r)[0]); }"""


def _search(page, tile, term, regex):
    """Type `term` with the regular-expression button on or off; the Smart
    Search button stays as it is (on, the default)."""
    regex_btn = page.locator(f"{tile} button[id^=btnRegex_]")
    if ("active" in (regex_btn.get_attribute("class") or "")) != regex:
        regex_btn.click()
    box = page.locator(f"{tile} div.dataTables_filter input")
    box.fill(term)
    box.dispatch_event("input")
    page.wait_for_timeout(400)
    return page.evaluate(ROWS, tile)


def test_a_regex_alternation_finds_every_alternative(browser, server):
    configs = {
        "cell-table-C": {"id": "cell-table-C", "title": "cells"},
        "gene-table-G": {"id": "gene-table-G", "title": "genes"},
        "cell-plot-P": {"id": "cell-plot-P", "title": "umap", "z": None,
                        "x": {"type": "obsm", "key": "X_umap", "column": "0"},
                        "y": {"type": "obsm", "key": "X_umap", "column": "1"},
                        "color": {"type": "none", "key": "", "column": ""},
                        "tableFilter": "cell-table-C", "removeNonTableEntries": True}
    }
    tiles = [{"type": "tile", "id": "cell-table-C"}, {"type": "tile", "id": "gene-table-G"},
             {"type": "tile", "id": "cell-plot-P"}]
    context = browser.new_context(viewport={"width": 1800, "height": 1100}, accept_downloads=True)
    page = context.new_page()
    try:
        page.goto(_link(server, tiles=tiles, configs=configs))
        page.wait_for_selector(f"{CT} .dataTables_scrollBody tbody tr", timeout=60000)
        page.wait_for_selector(f"{GT} .dataTables_scrollBody tbody tr", timeout=60000)

        # cells: the second alternative does not start the row, so the
        # lookahead form found only the first
        alt = _search(page, CT, "0001|0199", regex=True)
        grouped = _search(page, CT, "(0001|0199)", regex=True)
        assert sorted(alt) == sorted(grouped) == ["cell_0001", "cell_0199"], (alt, grouped)
        assert page.locator(f"{CT} button[id^=btnSmart_]").is_disabled(), \
            "Smart Search does not apply to a regular expression, and says so"

        # the plot linked to the table draws the same two cells
        _search(page, CT, "0001|0199", regex=True)
        drawn = f"""() => {{ const g = document.querySelector('{PLOT} .js-plotly-plot');
            if (!g || !g._fullData) return null;
            return [...new Set(g._fullData.filter(t => !/Focused/.test(t.name || ''))
                .flatMap(t => Array.from(t.customdata || []).filter(c => typeof c === 'string')))].sort(); }}"""
        _until(page, f"() => JSON.stringify(({drawn})()) === JSON.stringify(['cell_0001', 'cell_0199'])")

        # the CSV export holds the rows the search shows
        with page.expect_download() as dl:
            page.click("button[id^=export-csv-cell-table-C]")
        lines = [ln for ln in open(dl.value.path(), encoding="utf-8").read().splitlines() if ln.strip()]
        assert len(lines) == 3 and any("cell_0001" in ln for ln in lines) and any("cell_0199" in ln for ln in lines), lines

        # genes, the same: GENE001 and GENE019
        genes = page.evaluate("""() => { const t = document.querySelector('.tile[data-tile-id="gene-table-G"] .dataTables_scrollBody table');
            return jQuery(t).DataTable().column(0).data().toArray(); }""")
        last = sorted(g for g in genes if g.startswith("GENE"))[-1]
        alt = _search(page, GT, f"001|{last[-3:]}", regex=True)
        grouped = _search(page, GT, f"(001|{last[-3:]})", regex=True)
        assert sorted(alt) == sorted(grouped) and len(alt) >= 2 and last in alt, (alt, grouped)

        # without the regex, smart search is as before: words, any order
        words = _search(page, CT, "cell 0001", regex=False)
        assert words == ["cell_0001"], words
        assert page.locator(f"{CT} button[id^=btnSmart_]").is_enabled()
    finally:
        context.close()


PICKER_STATUS = "() => (document.querySelector('#focused-cell ~ .name-picker-menu .name-picker-status') || {}).textContent"


def test_the_cell_picker_says_building_never_no_match_while_it_searches(browser, server):
    """Under a 50-cell subset, a cell outside it: the shown cells' search
    answers at once with nothing; the dataset-wide one is held back (as
    while a 95.6M-cell index builds) and the status route says 'building'."""
    context = browser.new_context(viewport={"width": 1500, "height": 900})
    page = context.new_page()
    held = []
    building = {"on": True}

    def dataset_names(route):
        if "scope=dataset" in route.request.url:
            held.append(route)
            return
        route.continue_()

    def status(route):
        state = "building" if building["on"] else "ready"
        route.fulfill(status=200, body=json.dumps({"state": state}), headers={"Content-Type": "application/json"})

    try:
        page.route("**/api/v1/data/names?*", dataset_names)
        page.route("**/api/v1/data/names/status?*", status)
        page.goto(_link(server, subset={"n": 50, "seed": 0}))
        page.wait_for_function("() => /Cells:\\s*50 of 200/.test(document.body.innerText)", timeout=60000)
        shown = page.evaluate(f"""async () => {{
            const r = await fetch('/api/v1/data/cells?dataset_path={urllib.parse.quote(STORE)}&subset=' +
                encodeURIComponent(JSON.stringify({{n: 50, seed: 0}})));
            return (await r.json()).cells; }}""")
        outside = next(f"cell_{i:04d}" for i in range(200) if f"cell_{i:04d}" not in shown)
        seen = []
        page.click("#focused-cell")
        page.fill("#focused-cell", outside)
        t0 = time.time()
        while time.time() - t0 < 4:
            seen.append(page.evaluate(PICKER_STATUS))
            page.wait_for_timeout(100)
        assert "No cell matches" not in seen, f"a running search said no match: {sorted(set(seen))}"
        assert seen[-1] == "Building the name index (first search of this dataset)…", sorted(set(seen))
        # the index is ready: the held searches answer, and the picker shows the cell
        building["on"] = False
        for route in held:
            route.continue_()
        page.wait_for_function(f"""() => [...document.querySelectorAll('.name-picker-option')]
            .some(li => li.firstChild && li.firstChild.textContent === '{outside}')""", timeout=20000)
        assert page.evaluate(PICKER_STATUS) == "1 match"
    finally:
        context.close()


def test_the_badge_names_the_balance_after_apply(browser, server):
    context = browser.new_context(viewport={"width": 1500, "height": 900})
    page = context.new_page()
    try:
        page.goto(_link(server))
        page.wait_for_selector("#subset-button:not([hidden])", timeout=60000)
        page.click("#subset-button")
        page.wait_for_selector("#subset-enabled", state="visible")
        if not page.is_checked("#subset-enabled"):
            page.click("#subset-enabled")
        if page.is_checked("#subset-n-all"):
            page.click("#subset-n-all")
        page.fill("#subset-n", "50")
        page.select_option("#subset-balance", "cell_type")
        page.click("#subset-apply")
        page.wait_for_selector("#subset-modal", state="hidden")
        page.wait_for_function("() => /balanced by/.test(document.getElementById('subset-button').textContent)",
                               timeout=30000)
        badge = page.text_content("#subset-button")
        assert badge == "Subset · seed 0 · balanced by cell_type", badge
        assert "balanced by cell_type" in page.get_attribute("#subset-button", "title")
        # narrow: still one line, the balance kept, "Subset" the first to go
        page.set_viewport_size({"width": 800, "height": 900})
        box = page.locator("#subset-button").bounding_box()
        assert box["height"] < 30, box
        assert page.evaluate("() => getComputedStyle(document.querySelector('#subset-button .sb-first')).display") == "none"
    finally:
        context.close()
